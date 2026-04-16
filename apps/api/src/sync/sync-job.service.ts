import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SyncJob } from '@mycase-hubspot/db';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';

@Injectable()
export class SyncJobService {
  constructor(
    @InjectRepository(SyncJob)
    private readonly repo: Repository<SyncJob>,
  ) {}

  async create(payload: SyncJobPayload, bullJobId?: string): Promise<SyncJob> {
    const job = this.repo.create({
      installationId: payload.installationId,
      bullJobId: bullJobId ?? null,
      objectType: payload.objectType,
      direction: payload.direction,
      sourceId: payload.sourceId,
      status: 'processing',
      attemptCount: payload.attempt ?? 1,
      payloadSnapshot: payload.rawPayload ?? null,
      startedAt: new Date(),
    });
    return this.repo.save(job);
  }

  async markSuccess(
    jobId: string,
    result: SyncResult,
  ): Promise<void> {
    await this.repo.update(jobId, {
      status: 'success',
      destinationId: result.destinationId ?? null,
      completedAt: new Date(),
    });
  }

  async markSkipped(jobId: string, reason: string): Promise<void> {
    await this.repo.update(jobId, {
      status: 'skipped',
      errorMessage: reason,
      completedAt: new Date(),
    });
  }

  async markFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.repo.update(jobId, {
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    });
  }

  async list(
    installationId: string,
    limit = 50,
    offset = 0,
  ): Promise<[SyncJob[], number]> {
    return this.repo.findAndCount({
      where: { installationId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }
}
