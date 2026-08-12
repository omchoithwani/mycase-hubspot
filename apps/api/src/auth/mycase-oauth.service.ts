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
  // Dedup concurrent refresh requests per installation so only one token exchange
  // goes out at a time — prevents "refresh token already used" 401s under load.
  private readonly _refreshLock = new Map<string, Promise<Installation>>();

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
      prompt: 'login',
    });
    return `${MYCASE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string | null;
    expiresAt: Date;
    firmUuid: string | undefined;
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

      const { access_token, refresh_token, expires_in, firm_uuid } = response.data;
      this.logger.log(
        `MyCase token response: access_token=${!!access_token}, refresh_token=${!!refresh_token}, expires_in=${expires_in}, firm_uuid=${firm_uuid}`,
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
        firmUuid: firm_uuid,
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
    const key = installation.id;

    // If another caller is already refreshing this installation's token, wait for
    // that result rather than firing a second exchange (which would invalidate the
    // first refresh token and cause a 401 for both callers).
    const inflight = this._refreshLock.get(key);
    if (inflight) {
      this.logger.debug(`Token refresh for ${key} already in flight — waiting for result`);
      return inflight;
    }

    const promise = this._doRefreshTokens(installation).finally(() => {
      this._refreshLock.delete(key);
    });
    this._refreshLock.set(key, promise);
    return promise;
  }

  private async _doRefreshTokens(installation: Installation): Promise<Installation> {
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
    } catch (err: any) {
      const status: number | undefined = err?.response?.status;
      const body = err?.response?.data;
      this.logger.error(
        `Failed to refresh MyCase token for installation ${installation.id} — status=${status ?? 'network'} body=${JSON.stringify(body)}`,
        err,
      );
      // Only mark disconnected on definitive auth failures (401/403).
      // Network errors or server errors are transient — don't force a reconnect.
      if (status === 401 || status === 403) {
        await this.installationService.setMyCaseDisconnected(installation.id);
      }
      throw new UnauthorizedException('MyCase token refresh failed — please reconnect MyCase');
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
