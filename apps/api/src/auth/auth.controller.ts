import {
  Controller,
  Get,
  Query,
  Redirect,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
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

  // In-memory CSRF store: key → expiresAt (epoch ms)
  private readonly csrfStore = new Map<string, number>();

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
    const state = randomBytes(16).toString('hex');
    this.setCsrf(`csrf:hs:${state}`, state);
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

    this.checkAndDeleteCsrf(`csrf:hs:${state}`);

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

    const state = `${installationId}:${randomBytes(12).toString('hex')}`;
    this.setCsrf(`csrf:mc:${state}`, installationId);

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

    // State was set as `installationId:nonce`
    const installationId = state.split(':')[0];
    this.checkAndDeleteCsrf(`csrf:mc:${state}`);

    if (!installationId) {
      throw new BadRequestException('Invalid or expired state parameter');
    }

    const tokens = await this.mycaseOAuth.exchangeCode(code);

    await this.installationService.updateMyCaseTokens(installationId, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });

    try {
      const firmWebBase = await this.mycase.getFirmWebBaseUrl(installationId);
      if (firmWebBase) {
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
        const webhookBase = `${apiUrl}/webhooks/mycase/${installationId}`;
        await Promise.all([
          this.mycase.createWebhookSubscription(installationId, 'case', webhookBase, ['created', 'updated']),
          this.mycase.createWebhookSubscription(installationId, 'client', webhookBase, ['created', 'updated']),
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

  private setCsrf(key: string, _value: string): void {
    // Periodically prune expired entries to avoid unbounded growth
    if (this.csrfStore.size > 1000) {
      const now = Date.now();
      for (const [k, exp] of this.csrfStore) {
        if (exp <= now) this.csrfStore.delete(k);
      }
    }
    this.csrfStore.set(key, Date.now() + CSRF_TTL_MS);
  }

  private checkAndDeleteCsrf(key: string): void {
    const expiresAt = this.csrfStore.get(key);
    this.csrfStore.delete(key);
    if (!expiresAt || Date.now() > expiresAt) {
      throw new BadRequestException('Invalid or expired state parameter');
    }
  }
}
