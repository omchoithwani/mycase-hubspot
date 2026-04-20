import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Installation } from '@mycase-hubspot/db';

@Injectable()
export class InstallationService {
  constructor(
    @InjectRepository(Installation)
    private readonly repo: Repository<Installation>,
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
      baseUrl?: string;
    },
  ): Promise<Installation> {
    const installation = await this.findByIdOrFail(id);
    installation.mycaseAccessToken = data.accessToken;
    installation.mycaseRefreshToken = data.refreshToken ?? undefined;
    installation.mycaseTokenExpiresAt = data.expiresAt;
    installation.mycaseConnected = true;
    if (data.baseUrl) {
      installation.mycaseBaseUrl = data.baseUrl;
    }
    return this.repo.save(installation);
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
    return this.repo.save(installation);
  }

  async findAllActive(): Promise<Installation[]> {
    return this.repo.find({
      where: { syncEnabled: true, mycaseConnected: true },
    });
  }
}
