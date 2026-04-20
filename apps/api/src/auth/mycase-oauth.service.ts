import { Injectable, Logger, UnauthorizedException, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { TokenStoreService } from './token-store.service';
import { InstallationService } from '../installation/installation.service';
import { Installation } from '@mycase-hubspot/db';

const MYCASE_AUTH_URL = 'https://auth.mycase.com/login_sessions/new';
const MYCASE_TOKEN_URL = 'https://auth.mycase.com/tokens';

@Injectable()
export class MyCaseOAuthService {
  private readonly logger = new Logger(MyCaseOAuthService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStoreService,
    private readonly installationService: InstallationService,
  ) {}

  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.getOrThrow('MYCASE_CLIENT_ID'),
      redirect_uri: this.config.getOrThrow('MYCASE_REDIRECT_URI'),
      response_type: 'code',
      state,
    });
    return `${MYCASE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
  }> {
    try {
      const response = await axios.post<{
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
        firm_uuid?: string;
      }>(
        MYCASE_TOKEN_URL,
        {
          grant_type: 'authorization_code',
          client_id: this.config.getOrThrow('MYCASE_CLIENT_ID'),
          client_secret: this.config.getOrThrow('MYCASE_CLIENT_SECRET'),
          redirect_uri: this.config.getOrThrow('MYCASE_REDIRECT_URI'),
          code,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const { access_token, refresh_token, expires_in } = response.data;
      this.logger.log(
        `MyCase token response: access_token=${!!access_token}, refresh_token=${!!refresh_token}, expires_in=${expires_in}`,
      );

      if (!access_token) {
        this.logger.error(
          `MyCase token response missing access_token: ${JSON.stringify(response.data)}`,
        );
        throw new InternalServerErrorException('MyCase token response missing access_token');
      }

      const expiresAt = new Date(Date.now() + (expires_in || 86400) * 1000);
      return {
        accessToken: this.tokenStore.encrypt(access_token),
        refreshToken: refresh_token ? this.tokenStore.encrypt(refresh_token) : null,
        expiresAt,
      };
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      const axiosErr = err as AxiosError;
      this.logger.error(
        `MyCase token exchange failed — status: ${axiosErr.response?.status}, body: ${JSON.stringify(axiosErr.response?.data)}`,
      );
      throw new InternalServerErrorException(
        `MyCase token exchange failed: status=${axiosErr.response?.status ?? axiosErr.message} body=${JSON.stringify(axiosErr.response?.data)}`,
      );
    }
  }

  async refreshTokens(installation: Installation): Promise<Installation> {
    try {
      const refreshToken = this.tokenStore.decrypt(
        installation.mycaseRefreshToken!,
      );

      const response = await axios.post<{
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      }>(
        MYCASE_TOKEN_URL,
        {
          grant_type: 'refresh_token',
          client_id: this.config.getOrThrow('MYCASE_CLIENT_ID'),
          client_secret: this.config.getOrThrow('MYCASE_CLIENT_SECRET'),
          refresh_token: refreshToken,
        },
        { headers: { 'Content-Type': 'application/json' } },
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const expiresAt = new Date(Date.now() + (expires_in || 86400) * 1000);

      return this.installationService.updateMyCaseTokens(installation.id, {
        accessToken: this.tokenStore.encrypt(access_token),
        refreshToken: refresh_token ? this.tokenStore.encrypt(refresh_token) : null,
        expiresAt,
      });
    } catch (err) {
      this.logger.error(
        `Failed to refresh MyCase token for installation ${installation.id}`,
        err,
      );
      throw new UnauthorizedException('MyCase token refresh failed');
    }
  }

  async getValidAccessToken(installation: Installation): Promise<string> {
    if (!installation.mycaseAccessToken || !installation.mycaseConnected) {
      throw new UnauthorizedException('MyCase not connected');
    }

    const expiresAt = installation.mycaseTokenExpiresAt;
    const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);

    if (expiresAt && expiresAt < fiveMinutesFromNow) {
      installation = await this.refreshTokens(installation);
    }

    return this.tokenStore.decrypt(installation.mycaseAccessToken!);
  }
}
