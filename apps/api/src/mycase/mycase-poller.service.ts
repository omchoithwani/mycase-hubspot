import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';
import { InstallationService } from '../installation/installation.service';
import { MyCaseClientService } from './mycase-client.service';
import {
  QUEUE_MC_TO_HS,
  SYNC_JOB_OPTIONS,
} from '../queue/queue.constants';

@Injectable()
export class MyCasePollerService {
  private readonly logger = new Logger(MyCasePollerService.name);
  private isRunning = false;

  constructor(
    @InjectQueue(QUEUE_MC_TO_HS) private readonly queue: Queue<SyncJobPayload>,
    @InjectRepository(PollingCursor)
    private readonly cursorRepo: Repository<PollingCursor>,
    private readonly installationService: InstallationService,
    private readonly mycaseClient: MyCaseClientService,
  ) {}

  @Cron('*/2 * * * *') // every 2 minutes
  async poll(): Promise<void> {
    // Prevent overlapping runs
    if (this.isRunning) {
      this.logger.verbose('Poll already running — skipping this tick');
      return;
    }
    this.isRunning = true;

    try {
      const installations = await this.installationService.findAllActive();
      this.logger.debug(`Polling MyCase for ${installations.length} installation(s)`);

      for (const installation of installations) {
        await this.pollInstallation(installation.id);
      }
    } catch (err: any) {
      this.logger.error(`MyCase poll error: ${err.message}`, err.stack);
    } finally {
      this.isRunning = false;
    }
  }

  private async pollInstallation(installationId: string): Promise<void> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    await Promise.all([
      this.pollObjectType(installationId, 'client', 'contact', installation.syncHistoricalData),
      this.pollObjectType(installationId, 'matter', 'deal', installation.syncHistoricalData),
    ]);
  }

  private async pollObjectType(
    installationId: string,
    mycaseType: 'client' | 'matter',
    syncObjectType: 'contact' | 'deal',
    syncHistoricalData = false,
  ): Promise<void> {
    const cursor = await this.getOrCreateCursor(installationId, mycaseType, syncHistoricalData);
    const since = cursor.lastPolledAt;
    const pollStart = new Date();

    try {
      let records: Array<{ id: string | number }>;

      if (mycaseType === 'client') {
        records = await this.mycaseClient.listClients(installationId, since);
      } else {
        records = await this.mycaseClient.listMatters(installationId, since);
      }

      for (const record of records) {
        const payload: SyncJobPayload = {
          installationId,
          direction: 'mc_to_hs',
          objectType: syncObjectType,
          sourceId: String(record.id),
          sourceSystem: 'mycase',
          triggeredBy: 'poll',
        };

        await this.queue.add(`${syncObjectType}-${record.id}`, payload, {
          ...SYNC_JOB_OPTIONS,
          jobId: `mc.poll.${installationId}.${syncObjectType}.${record.id}.${pollStart.getTime()}`,
        });
      }

      if (records.length > 0) {
        this.logger.log(
          `Enqueued ${records.length} MyCase ${mycaseType}(s) for installation ${installationId}`,
        );
      }

      // Advance cursor to poll start time (not now, to avoid missing records
      // created during the poll window)
      await this.cursorRepo.save({
        ...cursor,
        lastPolledAt: pollStart,
      });
    } catch (err: any) {
      this.logger.error(
        `Failed polling MyCase ${mycaseType} for installation ${installationId}: ${err.message}`,
      );
      // Don't update cursor on failure — we'll retry next tick
    }
  }

  private async getOrCreateCursor(
    installationId: string,
    objectType: string,
    syncHistoricalData = false,
  ): Promise<PollingCursor> {
    let cursor = await this.cursorRepo.findOne({
      where: { installationId, objectType },
    });

    if (!cursor) {
      // If syncHistoricalData is enabled, start from epoch to pull all records.
      // Otherwise start from now so only new changes are picked up.
      const lastPolledAt = syncHistoricalData
        ? new Date(0)
        : new Date();
      cursor = this.cursorRepo.create({ installationId, objectType, lastPolledAt });
      cursor = await this.cursorRepo.save(cursor);
    }

    return cursor;
  }
}
