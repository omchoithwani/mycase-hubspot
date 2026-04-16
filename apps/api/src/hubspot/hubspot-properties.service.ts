import { Injectable, Logger } from '@nestjs/common';
import { HubSpotClientService } from './hubspot-client.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { HubSpotOAuthService } from '../auth/hubspot-oauth.service';
import { InstallationService } from '../installation/installation.service';
import { HsProperty } from './dto/webhook-payload.dto';
import { HsPipeline } from './dto/deal.dto';
import axios from 'axios';

const HS_BASE = 'https://api.hubapi.com';

@Injectable()
export class HubSpotPropertiesService {
  private readonly logger = new Logger(HubSpotPropertiesService.name);

  // In-memory cache: portalId -> { properties, fetchedAt }
  private readonly cache = new Map<
    string,
    { data: HsProperty[]; fetchedAt: number }
  >();

  private readonly CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    private readonly installationService: InstallationService,
    private readonly oauthService: HubSpotOAuthService,
    private readonly rateLimiter: HubSpotRateLimiterService,
  ) {}

  private async getToken(installationId: string): Promise<string> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    return this.oauthService.getValidAccessToken(installation);
  }

  async getContactProperties(
    portalId: string,
    installationId: string,
  ): Promise<HsProperty[]> {
    return this.fetchProperties(portalId, installationId, 'contacts');
  }

  async getDealProperties(
    portalId: string,
    installationId: string,
  ): Promise<HsProperty[]> {
    return this.fetchProperties(portalId, installationId, 'deals');
  }

  async getNoteProperties(
    portalId: string,
    installationId: string,
  ): Promise<HsProperty[]> {
    return this.fetchProperties(portalId, installationId, 'notes');
  }

  async getPipelines(
    portalId: string,
    installationId: string,
  ): Promise<HsPipeline[]> {
    await this.rateLimiter.acquire(portalId);
    const token = await this.getToken(installationId);

    const response = await axios.get(`${HS_BASE}/crm/v3/pipelines/deals`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.results ?? [];
  }

  async fetchProperties(
    portalId: string,
    installationId: string,
    objectType: string,
  ): Promise<HsProperty[]> {
    const cacheKey = `${portalId}:${objectType}`;
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL_MS) {
      return cached.data;
    }

    await this.rateLimiter.acquire(portalId);
    const token = await this.getToken(installationId);

    const response = await axios.get(
      `${HS_BASE}/crm/v3/properties/${objectType}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const properties: HsProperty[] = response.data.results ?? [];
    this.cache.set(cacheKey, { data: properties, fetchedAt: Date.now() });
    return properties;
  }

  invalidateCache(portalId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${portalId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
