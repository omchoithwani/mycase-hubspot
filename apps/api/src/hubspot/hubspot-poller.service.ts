import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';
import { InstallationService } from '../installation/installation.service';
import { HubSpotClientService } from './hubspot-client.service';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_HS_TO_MC, SYNC_JOB_OPTS } from '../queue/queue.constants';

@Injectable()
export class HubSpotPollerService {
  private readonly logger = new Logger(HubSpotPollerService.name);
  private readonly running = { contact: false, deal: false, note: false };

  constructor(
    private readonly pgBoss: PgBossService,
    @InjectRepository(PollingCursor)
    private readonly cursorRepo: Repository<PollingCursor>,
    private readonly installationService: InstallationService,
    private readonly hubspotClient: HubSpotClientService,
  ) {}

  @Cron('*/3 * * * *')
  async pollContacts(): Promise<void> {
    await this.runPoll('contact');
  }

  @Cron('1/3 * * * *')
  async pollDeals(): Promise<void> {
    await this.runPoll('deal');
  }

  @Cron('2/3 * * * *')
  async pollNotes(): Promise<void> {
    await this.runPoll('note');
  }

  private async runPoll(objectType: 'contact' | 'deal' | 'note'): Promise<void> {
    if (this.running[objectType]) {
      this.logger.verbose(`HubSpot ${objectType} poll already running — skipping`);
      return;
    }
    this.running[objectType] = true;

    try {
      const installations = await this.installationService.findAllActive();
      for (const installation of installations) {
        await this.pollObjectType(installation.id, installation.hubspotPortalId, objectType);
      }
    } catch (err: any) {
      this.logger.error(`HubSpot ${objectType} poll error: ${err.message}`, err.stack);
    } finally {
      this.running[objectType] = false;
    }
  }

  private async pollObjectType(
    installationId: string,
    portalId: string,
    objectType: 'contact' | 'deal' | 'note',
  ): Promise<void> {
    const cursorKey = `hs_${objectType}`;
    const cursor = await this.getOrCreateCursor(installationId, cursorKey);
    const since = cursor.lastPolledAt;
    const pollStart = new Date();

    try {
      let records: Array<{ id: string }>;

      if (objectType === 'contact') {
        records = await this.hubspotClient.listContactsModifiedSince(portalId, installationId, since);
      } else if (objectType === 'deal') {
        records = await this.hubspotClient.listDealsModifiedSince(portalId, installationId, since);
      } else {
        records = await this.hubspotClient.listNotesModifiedSince(portalId, installationId, since);
      }

      for (const record of records) {
        const payload: SyncJobPayload = {
          installationId,
          direction: 'hs_to_mc',
          objectType,
          sourceId: record.id,
          sourceSystem: 'hubspot',
          triggeredBy: 'poll',
        };

        await this.pgBoss.send(QUEUE_HS_TO_MC, payload as object, {
          ...SYNC_JOB_OPTS,
          singletonKey: `hs.poll.${installationId}.${objectType}.${record.id}.${pollStart.getTime()}`,
        });
      }

      if (records.length > 0) {
        this.logger.log(
          `Enqueued ${records.length} HubSpot ${objectType}(s) for installation ${installationId}`,
        );
      }

      await this.cursorRepo.save({ ...cursor, lastPolledAt: pollStart });
    } catch (err: any) {
      this.logger.error(
        `Failed polling HubSpot ${objectType} for installation ${installationId}: ${err.message}`,
      );
    }
  }

  private async getOrCreateCursor(
    installationId: string,
    objectType: string,
  ): Promise<PollingCursor> {
    let cursor = await this.cursorRepo.findOne({ where: { installationId, objectType } });

    if (!cursor) {
      cursor = this.cursorRepo.create({
        installationId,
        objectType,
        lastPolledAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      });
      cursor = await this.cursorRepo.save(cursor);
    }

    return cursor;
  }
}
