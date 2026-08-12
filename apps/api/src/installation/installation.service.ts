import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Installation, PollingCursor } from '@mycase-hubspot/db';

@Injectable()
export class InstallationService {
  constructor(
    @InjectRepository(Installation)
    private readonly repo: Repository<Installation>,
    @InjectRepository(PollingCursor)
    private readonly cursorRepo: Repository<PollingCursor>,
  ) {}

  async findByPortalId(portalId: string): Promise<Installation | null> {
    return this.repo.findOne({ where: { hubspotPortalId: portalId } });
  }

  async findById(id: string): Promise<Installation | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIdOrFail(id: string): Promise<Installation> {
    const installation = await this.findById(id);
    if (!installation) {
      throw new NotFoundException(`Installation ${id} not found`);
    }
    return installation;
  }

  async upsertFromHubSpot(data: {
    portalId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
  }): Promise<Installation> {
    let installation = await this.findByPortalId(data.portalId);

    if (!installation) {
      installation = this.repo.create({
        hubspotPortalId: data.portalId,
        hubspotAccessToken: data.accessToken,
        hubspotRefreshToken: data.refreshToken,
        hubspotTokenExpiresAt: data.expiresAt,
        syncEnabled: false,
      });
    } else {
      installation.hubspotAccessToken = data.accessToken;
      installation.hubspotRefreshToken = data.refreshToken;
      installation.hubspotTokenExpiresAt = data.expiresAt;
    }

    return this.repo.save(installation);
  }

  async updateMyCaseTokens(
    id: string,
    data: {
      accessToken: string;
      refreshToken: string | null;
      expiresAt: Date;
      baseUrl?: string | null;
    },
  ): Promise<Installation> {
    const installation = await this.findByIdOrFail(id);
    installation.mycaseAccessToken = data.accessToken;
    installation.mycaseRefreshToken = data.refreshToken;
    installation.mycaseTokenExpiresAt = data.expiresAt;
    installation.mycaseConnected = true;
    // undefined = don't touch (token refresh); null = explicit clear; string = set new value
    if (data.baseUrl !== undefined) {
      installation.mycaseBaseUrl = data.baseUrl;
    }
    return this.repo.save(installation);
  }

  async updateMyCaseWebBaseUrl(id: string, webBaseUrl: string): Promise<void> {
    await this.repo.update(id, { mycaseWebBaseUrl: webBaseUrl });
  }

  async updateMyCaseBaseUrl(id: string, baseUrl: string): Promise<void> {
    await this.repo.update(id, { mycaseBaseUrl: baseUrl });
  }

  async setMyCaseDisconnected(id: string): Promise<void> {
    await this.repo.update(id, { mycaseConnected: false });
  }

  async updateHubSpotTokens(
    id: string,
    data: {
      accessToken: string;
      refreshToken: string;
      expiresAt: Date;
    },
  ): Promise<Installation> {
    const installation = await this.findByIdOrFail(id);
    installation.hubspotAccessToken = data.accessToken;
    installation.hubspotRefreshToken = data.refreshToken;
    installation.hubspotTokenExpiresAt = data.expiresAt;
    return this.repo.save(installation);
  }

  async setSyncEnabled(id: string, enabled: boolean): Promise<Installation> {
    const installation = await this.findByIdOrFail(id);
    installation.syncEnabled = enabled;
    const saved = await this.repo.save(installation);
    // Always reset cursors when enabling sync so the poller starts from the
    // correct point (now if syncHistoricalData=false, epoch if true).
    // Stale cursors from a previous session would otherwise replay old data.
    if (enabled) {
      await this.cursorRepo.delete({ installationId: id });
    }
    return saved;
  }

  async setSyncHistoricalData(id: string, syncHistoricalData: boolean): Promise<Installation> {
    const installation = await this.findByIdOrFail(id);
    installation.syncHistoricalData = syncHistoricalData;
    const saved = await this.repo.save(installation);
    // Reset cursors so the next poll starts from the right anchor point.
    await this.cursorRepo.delete({ installationId: id });
    return saved;
  }

  async findAllActive(): Promise<Installation[]> {
    return this.repo.find({
      where: { syncEnabled: true, mycaseConnected: true },
    });
  }
}
