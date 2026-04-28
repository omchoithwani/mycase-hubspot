import { Injectable, Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { TokenStoreService } from './token-store.service';
import { InstallationService } from '../installation/installation.service';
import { Installation } from '@mycase-hubspot/db';

const HS_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HS_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HS_WEBHOOK_URL = 'https://api.hubapi.com/webhooks/v3';

@Injectable()
export class HubSpotOAuthService {
  private readonly logger = new Logger(HubSpotOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
    private readonly installationService: InstallationService,
  ) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow('HUBSPOT_CLIENT_ID'),
      redirect_uri: `${this.config.getOrThrow('APP_URL')}/auth/hubspot/callback`,
      scope: this.config.getOrThrow('HUBSPOT_SCOPES'),
      state,
    });
    return `${HS_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    portalId: string;
  }> {
    try {
      const response = await axios.post(
        HS_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.getOrThrow('HUBSPOT_CLIENT_ID'),
          client_secret: this.config.getOrThrow('HUBSPOT_CLIENT_SECRET'),
          redirect_uri: `${this.config.getOrThrow('APP_URL')}/auth/hubspot/callback`,
          code,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const { access_token, refresh_token, expires_in, hub_id } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      return {
        accessToken: this.tokenStore.encrypt(access_token),
        refreshToken: this.tokenStore.encrypt(refresh_token),
        expiresAt,
        portalId: String(hub_id),
      };
    } catch (err) {
      const axiosErr = err as AxiosError;
      this.logger.error(
        `HubSpot token exchange failed — status: ${axiosErr.response?.status}, body: ${JSON.stringify(axiosErr.response?.data)}`,
      );
      throw new InternalServerErrorException(
        `HubSpot token exchange failed: status=${axiosErr.response?.status ?? axiosErr.message} body=${JSON.stringify(axiosErr.response?.data)}`,
      );
    }
  }

  async refreshTokens(installation: Installation): Promise<Installation> {
    try {
      const refreshToken = this.tokenStore.decrypt(
        installation.hubspotRefreshToken,
      );

      const response = await axios.post(
        HS_TOKEN_URL,
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.config.getOrThrow('HUBSPOT_CLIENT_ID'),
          client_secret: this.config.getOrThrow('HUBSPOT_CLIENT_SECRET'),
          refresh_token: refreshToken,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      return this.installationService.updateHubSpotTokens(installation.id, {
        accessToken: this.tokenStore.encrypt(access_token),
        refreshToken: this.tokenStore.encrypt(refresh_token),
        expiresAt,
      });
    } catch (err) {
      this.logger.error(
        `Failed to refresh HubSpot token for installation ${installation.id}`,
        err,
      );
      throw new UnauthorizedException('HubSpot token refresh failed');
    }
  }

  async getValidAccessToken(installation: Installation): Promise<string> {
    const expiresAt = installation.hubspotTokenExpiresAt;
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (expiresAt < fiveMinutesFromNow) {
      this.logger.debug(
        `Proactively refreshing HubSpot token for installation ${installation.id}`,
      );
      installation = await this.refreshTokens(installation);
    }

    return this.tokenStore.decrypt(installation.hubspotAccessToken);
  }

  async subscribeWebhooks(_accessToken: string): Promise<void> {
    // HubSpot webhook subscriptions for public OAuth apps must be configured
    // in the HubSpot developer portal (developers.hubspot.com → Apps → Webhooks).
    // The portal user's OAuth token cannot manage app-level webhook subscriptions.
    //
    // Required setup in HubSpot developer portal:
    //   Webhook URL: <APP_URL>/webhooks/hubspot
    //   Subscriptions: contact.creation, contact.propertyChange,
    //                  deal.creation, deal.propertyChange,
    //                  contact_note.creation, contact_note.propertyChange
    this.logger.log(
      'Reminder: HubSpot webhook subscriptions must be configured manually in the developer portal at developers.hubspot.com',
    );
  }

  async createCustomProperties(accessToken: string): Promise<void> {
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    };

    const properties = [
      {
        objectType: 'contacts',
        property: {
          name: 'my_case_id',
          label: 'MyCase Client ID',
          type: 'string',
          fieldType: 'text',
          groupName: 'contactinformation',
          description: 'Internal: MyCase client ID for sync tracking',
          hidden: true,
        },
      },
      {
        objectType: 'deals',
        property: {
          name: 'my_case_id',
          label: 'MyCase Matter ID',
          type: 'string',
          fieldType: 'text',
          groupName: 'dealinformation',
          description: 'Internal: MyCase matter ID for sync tracking',
          hidden: true,
        },
      },
    ];

    for (const { objectType, property } of properties) {
      try {
        await axios.post(
          `https://api.hubapi.com/crm/v3/properties/${objectType}`,
          property,
          { headers },
        );
        this.logger.log(`Created HubSpot property: ${property.name}`);
      } catch (err: any) {
        // 409 means property already exists
        if (err?.response?.status !== 409) {
          this.logger.warn(
            `Failed to create property ${property.name}: ${err?.message}`,
          );
        }
      }
    }
  }
}
