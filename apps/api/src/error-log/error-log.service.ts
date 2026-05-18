import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ErrorLog } from '@mycase-hubspot/db';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTS } from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

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
    private readonly pgBoss: PgBossService,
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

    const payload: SyncJobPayload = {
      installationId: log.installationId,
      objectType: log.objectType as any,
      direction: log.direction as any,
      sourceId: log.sourceId,
      sourceSystem: log.direction === 'hs_to_mc' ? 'hubspot' : 'mycase',
      triggeredBy: 'manual',
    };

    const queueName = log.direction === 'hs_to_mc' ? QUEUE_HS_TO_MC : QUEUE_MC_TO_HS;
    await this.pgBoss.send(queueName, payload as object, {
      ...SYNC_JOB_OPTS,
      singletonKey: `retry:${log.id}:${Date.now()}`,
    });

    await this.repo.update({ id }, {
      retryCount: log.retryCount + 1,
      nextRetryAt: new Date(),
    });
  }
}
