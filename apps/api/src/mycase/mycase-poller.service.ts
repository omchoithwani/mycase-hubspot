import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';
import { InstallationService } from '../installation/installation.service';
import { MyCaseClientService } from './mycase-client.service';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_MC_TO_HS, SYNC_JOB_OPTS } from '../queue/queue.constants';

@Injectable()
export class MyCasePollerService {
  private readonly logger = new Logger(MyCasePollerService.name);
  private isRunning = false;

  constructor(
    private readonly pgBoss: PgBossService,
    @InjectRepository(PollingCursor)
    private readonly cursorRepo: Repository<PollingCursor>,
    private readonly installationService: InstallationService,
    private readonly mycaseClient: MyCaseClientService,
  ) {}

  @Cron('*/2 * * * *') // every 2 minutes
  async poll(): Promise<void> {
    // Prevent overlapping runs
    if (this.isRunning) {
      this.logger.log('MyCase poll already running — skipping this tick');
      return;
    }
    this.isRunning = true;

    try {
      const installations = await this.installationService.findAllActive();
      this.logger.log(`MyCase poller tick — ${installations.length} active installation(s)`);

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
      let records: Array<{ id: string | number; updated_at?: string; created_at?: string }>;

      if (mycaseType === 'client') {
        records = await this.mycaseClient.listClients(installationId, since);
      } else {
        records = await this.mycaseClient.listMatters(installationId, since);
      }

      // MyCase filter[updated_after] is now used correctly — trust the API result.
      // Log for visibility.
      this.logger.log(
        `MyCase ${mycaseType} poll [${installationId.slice(0, 8)}]: fetched=${records.length} cursor=${since.toISOString()}`,
      );

      for (const record of records) {
        const payload: SyncJobPayload = {
          installationId,
          direction: 'mc_to_hs',
          objectType: syncObjectType,
          sourceId: String(record.id),
          sourceSystem: 'mycase',
          triggeredBy: 'poll',
        };

        await this.pgBoss.send(QUEUE_MC_TO_HS, payload as object, {
          ...SYNC_JOB_OPTS,
          singletonKey: `mc.poll.${installationId}.${syncObjectType}.${record.id}.${pollStart.getTime()}`,
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
      const lastPolledAt = syncHistoricalData
        ? new Date(0)
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      try {
        cursor = this.cursorRepo.create({ installationId, objectType, lastPolledAt });
        cursor = await this.cursorRepo.save(cursor);
      } catch (err: any) {
        if (err?.code === '23505') {
          // Another instance inserted concurrently — fetch the winner's row
          cursor = await this.cursorRepo.findOneOrFail({ where: { installationId, objectType } });
        } else {
          throw err;
        }
      }
    }

    return cursor;
  }
}
