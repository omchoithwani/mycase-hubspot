import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ErrorLog } from '@mycase-hubspot/db';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTIONS } from '../queue/queue.constants';

export interface ErrorLogInput {
  installationId: string;
  syncJobId?: string | null;
  objectType: string;
  direction: string;
  sourceId: string;
  errorCode: string;
  errorMessage: string;
  rawResponse?: Record<string, unknown> | null;
}

@Injectable()
export class ErrorLogService {
  constructor(
    @InjectRepository(ErrorLog)
    private readonly repo: Repository<ErrorLog>,
    @InjectQueue(QUEUE_HS_TO_MC)
    private readonly hsToMcQueue: Queue,
    @InjectQueue(QUEUE_MC_TO_HS)
    private readonly mcToHsQueue: Queue,
  ) {}

  async log(data: ErrorLogInput): Promise<ErrorLog> {
    const entry = this.repo.create({
      installationId: data.installationId,
      syncJobId: data.syncJobId ?? null,
      objectType: data.objectType,
      direction: data.direction,
      sourceId: data.sourceId,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      rawResponse: data.rawResponse ?? null,
      resolved: false,
      retryCount: 0,
    });
    return this.repo.save(entry);
  }

  async list(
    installationId: string,
    options: { resolved?: boolean; objectType?: string; limit?: number; offset?: number } = {},
  ): Promise<[ErrorLog[], number]> {
    const where: Record<string, unknown> = { installationId };
    if (options.resolved !== undefined) where['resolved'] = options.resolved;
    if (options.objectType) where['objectType'] = options.objectType;

    return this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: options.limit ?? 50,
      skip: options.offset ?? 0,
    });
  }

  /** Log a non-blocking warning (field mismatch etc.) — marked resolved so it
   *  doesn't appear as an actionable error but is still queryable. */
  async logWarning(data: ErrorLogInput): Promise<ErrorLog> {
    const entry = this.repo.create({
      installationId: data.installationId,
      syncJobId: data.syncJobId ?? null,
      objectType: data.objectType,
      direction: data.direction,
      sourceId: data.sourceId,
      errorCode: data.errorCode,
      errorMessage: data.errorMessage,
      rawResponse: data.rawResponse ?? null,
      resolved: false,
      retryCount: 0,
    });
    return this.repo.save(entry);
  }

  /** Returns unresolved FIELD_MISMATCH warnings for a specific record. */
  async findMismatchesBySourceId(
    installationId: string,
    sourceId: string,
  ): Promise<ErrorLog[]> {
    return this.repo.find({
      where: { installationId, sourceId, errorCode: 'FIELD_MISMATCH', resolved: false },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  /** Clears all FIELD_MISMATCH warnings for a record (called when a clean sync succeeds). */
  async clearMismatches(installationId: string, sourceId: string): Promise<void> {
    await this.repo.update(
      { installationId, sourceId, errorCode: 'FIELD_MISMATCH' },
      { resolved: true },
    );
  }

  async resolve(id: string, installationId: string): Promise<void> {
    await this.repo.update({ id, installationId }, { resolved: true });
  }

  async retry(id: string, installationId: string): Promise<void> {
    const log = await this.repo.findOneOrFail({ where: { id, installationId } });

    const payload = {
      installationId: log.installationId,
      objectType: log.objectType,
      direction: log.direction,
      sourceId: log.sourceId,
    };

    const queue = log.direction === 'hs_to_mc' ? this.hsToMcQueue : this.mcToHsQueue;
    await queue.add('sync', payload, {
      ...SYNC_JOB_OPTIONS,
      jobId: `retry:${log.id}:${Date.now()}`,
    });

    await this.repo.update({ id }, {
      retryCount: log.retryCount + 1,
      nextRetryAt: new Date(),
    });
  }
}
