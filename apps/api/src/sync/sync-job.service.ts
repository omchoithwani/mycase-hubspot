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

  async markSuccess(jobId: string, result: SyncResult): Promise<void> {
    const update: Partial<SyncJob> = {
      status: 'success',
      destinationId: result.destinationId ?? null,
      completedAt: new Date(),
    };

    if (result.syncedData) {
      update.payloadSnapshot = result.syncedData;

      // Compute which fields changed vs the previous successful sync for this record
      const current = await this.repo.findOneBy({ id: jobId });
      if (current) {
        const prev = await this.repo.findOne({
          where: {
            installationId: current.installationId,
            sourceId: current.sourceId,
            direction: current.direction,
            status: 'success',
          },
          order: { createdAt: 'DESC' },
        });

        if (prev?.payloadSnapshot) {
          const allKeys = new Set([
            ...Object.keys(prev.payloadSnapshot),
            ...Object.keys(result.syncedData),
          ]);
          update.changedFields = [...allKeys].filter(
            (k) =>
              JSON.stringify((prev.payloadSnapshot as Record<string, unknown>)[k]) !==
              JSON.stringify((result.syncedData as Record<string, unknown>)[k]),
          );
        } else {
          // First-ever sync for this record — all fields are "new"
          update.changedFields = Object.keys(result.syncedData);
        }
      }
    }

    await this.repo.update(jobId, update as any);
  }

  async delete(jobId: string): Promise<void> {
    await this.repo.delete(jobId);
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
    options: { status?: string; objectType?: string; limit?: number; offset?: number; search?: string } = {},
  ): Promise<[SyncJob[], number]> {
    if (options.search) {
      const pattern = `%${options.search}%`;
      const qb = this.repo
        .createQueryBuilder('j')
        .where('j.installation_id = :installationId', { installationId })
        .andWhere('(j.source_id ILIKE :p OR j.destination_id ILIKE :p)', { p: pattern })
        .orderBy('j.created_at', 'DESC')
        .take(options.limit ?? 50)
        .skip(options.offset ?? 0);
      if (options.status) qb.andWhere('j.status = :status', { status: options.status });
      if (options.objectType) qb.andWhere('j.object_type = :objectType', { objectType: options.objectType });
      return qb.getManyAndCount();
    }

    const where: Record<string, unknown> = { installationId };
    if (options.status) where['status'] = options.status;
    if (options.objectType) where['objectType'] = options.objectType;

    return this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
  }

  async stats(installationId: string): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('j')
      .select('j.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('j.installation_id = :installationId', { installationId })
      .groupBy('j.status')
      .getRawMany();

    const result: Record<string, number> = { success: 0, failed: 0, skipped: 0, processing: 0 };
    for (const row of rows) {
      result[row.status] = Number(row.count);
    }
    result['total'] = Object.values(result).reduce((a, b) => a + b, 0);
    return result;
  }
}
