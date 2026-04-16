import {
  Controller,
  Get,
  Query,
  Redirect,
  Logger,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { randomBytes } from 'crypto';
import { HubSpotOAuthService } from './hubspot-oauth.service';
import { MyCaseOAuthService } from './mycase-oauth.service';
import { InstallationService } from '../installation/installation.service';

const CSRF_TTL_SECONDS = 600; // 10 minutes

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly hubspotOAuth: HubSpotOAuthService,
    private readonly mycaseOAuth: MyCaseOAuthService,
    private readonly installationService: InstallationService,
    private readonly config: ConfigService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  // ─── HubSpot Install ──────────────────────────────────────────────────────

  @Get('hubspot/install')
  @Redirect()
  async hubspotInstall() {
    const state = randomBytes(16).toString('hex');
    await this.redis.setex(`csrf:hs:${state}`, CSRF_TTL_SECONDS, '1');
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

    // CSRF check
    const valid = await this.redis.get(`csrf:hs:${state}`);
    if (!valid) {
      throw new BadRequestException('Invalid or expired state parameter');
    }
    await this.redis.del(`csrf:hs:${state}`);

    // Exchange code for tokens
    const tokens = await this.hubspotOAuth.exchangeCode(code);

    // Persist installation
    const installation = await this.installationService.upsertFromHubSpot({
      portalId: tokens.portalId,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    // Subscribe webhooks + create custom properties (best effort)
    const rawToken = this.config.getOrThrow('HUBSPOT_CLIENT_SECRET'); // placeholder; real token from decrypt
    try {
      const accessToken = await this.hubspotOAuth.getValidAccessToken(
        installation,
      );
      await Promise.all([
        this.hubspotOAuth.subscribeWebhooks(accessToken),
        this.hubspotOAuth.createCustomProperties(accessToken),
      ]);
    } catch (err) {
      this.logger.warn('Non-fatal: webhook/property setup failed', err);
    }

    // Store installation ID in Redis for the MyCase connect step
    await this.redis.setex(
      `install:pending:${installation.hubspotPortalId}`,
      3600,
      installation.id,
    );

    const webUrl = this.config.get<string>('NEXT_PUBLIC_API_URL') || 'http://localhost:3000';
    return {
      url: `${webUrl}/install/connect-mycase?portalId=${installation.hubspotPortalId}`,
    };
  }

  // ─── MyCase Connect ───────────────────────────────────────────────────────

  @Get('mycase/connect')
  @Redirect()
  async mycaseConnect(@Query('installationId') installationId: string) {
    if (!installationId) {
      throw new BadRequestException('installationId is required');
    }

    const state = `${installationId}:${randomBytes(12).toString('hex')}`;
    await this.redis.setex(`csrf:mc:${state}`, CSRF_TTL_SECONDS, installationId);

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

    // CSRF check — state contains installationId
    const installationId = await this.redis.get(`csrf:mc:${state}`);
    if (!installationId) {
      throw new BadRequestException('Invalid or expired state parameter');
    }
    await this.redis.del(`csrf:mc:${state}`);

    const tokens = await this.mycaseOAuth.exchangeCode(code);

    await this.installationService.updateMyCaseTokens(installationId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    const webUrl = this.config.get<string>('NEXT_PUBLIC_API_URL') || 'http://localhost:3000';
    return { url: `${webUrl}/settings/field-mapping?installationId=${installationId}` };
  }
}
