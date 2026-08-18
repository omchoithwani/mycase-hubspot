import {
  Controller,
  Get,
  Query,
  Redirect,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { HubSpotOAuthService } from './hubspot-oauth.service';
import { MyCaseOAuthService } from './mycase-oauth.service';
import { InstallationService } from '../installation/installation.service';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';
import { FieldMappingService } from '../field-mapping/field-mapping.service';
import { StageMappingService } from '../stage-mapping/stage-mapping.service';

const CSRF_TTL_MS = 600_000; // 10 minutes

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly hubspotOAuth: HubSpotOAuthService,
    private readonly mycaseOAuth: MyCaseOAuthService,
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    private readonly fieldMapping: FieldMappingService,
    private readonly stageMapping: StageMappingService,
    private readonly config: ConfigService,
  ) {}

  // ─── HubSpot Install ──────────────────────────────────────────────────────

  @Get('hubspot/install')
  @Redirect()
  async hubspotInstall() {
    const state = this.signState(randomBytes(16).toString('hex'));
    const url = this.hubspotOAuth.buildAuthUrl(state);
    return { url };
  }

  @Get('hubspot/callback')
  @Redirect()
  async hubspotCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
  ) {
    if (error) {
      this.logger.warn(`HubSpot OAuth denied: ${error}`);
      throw new BadRequestException(`OAuth denied: ${error}`);
    }

    this.verifyState(state);

    const tokens = await this.hubspotOAuth.exchangeCode(code);

    const installation = await this.installationService.upsertFromHubSpot({
      portalId: tokens.portalId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    try {
      const accessToken = await this.hubspotOAuth.getValidAccessToken(installation);
      await Promise.all([
        this.hubspotOAuth.subscribeWebhooks(accessToken),
        this.hubspotOAuth.createCustomProperties(accessToken),
      ]);
    } catch (err) {
      this.logger.warn('Non-fatal: webhook/property setup failed', err);
    }

    try {
      const pipelines = await this.hubspot.getPipelines(
        installation.hubspotPortalId,
        installation.id,
      );
      await this.stageMapping.seedDefaults(installation.id, pipelines);
    } catch (err) {
      this.logger.warn('Non-fatal: stage mapping seed failed', err);
    }

    const webUrl = this.config.get<string>('WEB_URL') || 'http://localhost:3000';
    return { url: `${webUrl}/install?installationId=${installation.id}` };
  }

  // ─── MyCase Connect ───────────────────────────────────────────────────────

  @Get('mycase/connect')
  @Redirect()
  async mycaseConnect(@Query('installationId') installationId: string) {
    if (!installationId) {
      throw new BadRequestException('installationId is required');
    }

    const state = this.signState(`${installationId}:${randomBytes(12).toString('hex')}`);

    const url = this.mycaseOAuth.buildAuthUrl(state);
    return { url };
  }

  @Get('mycase/callback')
  @Redirect()
  async mycaseCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
  ) {
    if (error) {
      throw new BadRequestException(`MyCase OAuth denied: ${error}`);
    }

    if (!code) {
      this.logger.warn(`MyCase callback missing code param — state=${state}`);
      throw new BadRequestException('Missing authorization code from MyCase');
    }

    // State is signed as `installationId:nonce:timestamp:mac`
    this.verifyState(state);
    const installationId = state.split(':')[0];

    if (!installationId) {
      throw new BadRequestException('Invalid or expired state parameter');
    }

    const tokens = await this.mycaseOAuth.exchangeCode(code);

    // Store tokens and clear stale base URL override
    await this.installationService.updateMyCaseTokens(installationId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      baseUrl: null,
    });

    // Store firm UUID from OAuth exchange (informational; Bearer token already scopes all API calls)
    if (tokens.firmUuid) {
      await this.installationService.updateMyCaseFirmUuid(installationId, tokens.firmUuid);
      this.logger.log(`Stored MyCase firm UUID: ${tokens.firmUuid}`);
    }

    try {
      const firmWebBase = await this.mycase.getFirmWebBaseUrl(installationId);
      if (firmWebBase) {
        // Store web URL for CRM card links only — not used as API base
        await this.installationService.updateMyCaseWebBaseUrl(installationId, firmWebBase);
        this.logger.log(`Stored MyCase web base URL: ${firmWebBase}`);
      }
    } catch (err: any) {
      this.logger.warn(`Non-fatal: could not fetch MyCase firm web URL: ${err.message}`);
    }

    try {
      await this.fieldMapping.seedDefaults(installationId);
    } catch (err) {
      this.logger.warn('Non-fatal: field mapping seed failed', err);
    }

    try {
      const apiUrl = this.config.get<string>('API_URL') ?? '';
      if (apiUrl) {
        // Delete all stale subscriptions first to avoid duplicates from reconnects
        const existing = await this.mycase.listWebhookSubscriptions(installationId);
        await Promise.allSettled(
          existing.map((s) => this.mycase.deleteWebhookSubscription(installationId, s.id)),
        );
        const webhookBase = `${apiUrl}/webhooks/mycase/${installationId}`;
        await Promise.all([
          this.mycase.createWebhookSubscription(installationId, 'case', webhookBase, ['created', 'updated']),
          this.mycase.createWebhookSubscription(installationId, 'client', webhookBase, ['created', 'updated']),
          this.mycase.createWebhookSubscription(installationId, 'note', webhookBase, ['created', 'updated']),
        ]);
        this.logger.log(`Subscribed MyCase webhooks for installation ${installationId}`);
      } else {
        this.logger.warn('API_URL not set — skipping MyCase webhook subscription');
      }
    } catch (err: any) {
      this.logger.warn(`Non-fatal: MyCase webhook subscription failed: ${err.message}`);
    }

    const webUrl = this.config.get<string>('WEB_URL') || 'http://localhost:3000';
    return { url: `${webUrl}/install?installationId=${installationId}&step=done` };
  }

  // ─── CSRF helpers ─────────────────────────────────────────────────────────

  private signState(payload: string): string {
    const timestamp = Date.now().toString();
    const msg = `${payload}:${timestamp}`;
    const mac = createHmac('sha256', this.config.getOrThrow<string>('ENCRYPTION_KEY'))
      .update(msg)
      .digest('hex')
      .slice(0, 16);
    return `${msg}:${mac}`;
  }

  private verifyState(state: string): void {
    const parts = state.split(':');
    if (parts.length < 3) {
      throw new BadRequestException('Invalid or expired state parameter');
    }
    const mac = parts[parts.length - 1];
    const timestamp = parts[parts.length - 2];
    const msg = parts.slice(0, parts.length - 1).join(':');
    const expectedMac = createHmac('sha256', this.config.getOrThrow<string>('ENCRYPTION_KEY'))
      .update(msg)
      .digest('hex')
      .slice(0, 16);
    let valid = false;
    try {
      valid = timingSafeEqual(Buffer.from(mac), Buffer.from(expectedMac));
    } catch {
      valid = false;
    }
    if (!valid || Date.now() - parseInt(timestamp, 10) > CSRF_TTL_MS) {
      throw new BadRequestException('Invalid or expired state parameter');
    }
  }
}
