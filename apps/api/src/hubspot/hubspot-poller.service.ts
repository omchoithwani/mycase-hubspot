import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PollingCursor } from '@mycase-hubspot/db';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';
import { InstallationService } from '../installation/installation.service';
import { HubSpotClientService } from './hubspot-client.service';
import { QUEUE_HS_TO_MC, SYNC_JOB_OPTIONS } from '../queue/queue.constants';

@Injectable()
export class HubSpotPollerService {
  private readonly logger = new Logger(HubSpotPollerService.name);
  private isRunning = false;

  constructor(
    @InjectQueue(QUEUE_HS_TO_MC) private readonly queue: Queue<SyncJobPayload>,
    @InjectRepository(PollingCursor)
    private readonly cursorRepo: Repository<PollingCursor>,
    private readonly installationService: InstallationService,
    private readonly hubspotClient: HubSpotClientService,
  ) {}

  @Cron('*/2 * * * *')
  async poll(): Promise<void> {
    if (this.isRunning) {
      this.logger.verbose('HubSpot poll already running — skipping');
      return;
    }
    this.isRunning = true;

    try {
      const installations = await this.installationService.findAllActive();
      this.logger.debug(`Polling HubSpot for ${installations.length} installation(s)`);

      for (const installation of installations) {
        // Sequential — search API has a tighter per-second limit than the overall bucket;
        // firing all three in parallel causes 429 bursts.
        await this.pollObjectType(installation.id, installation.hubspotPortalId, 'contact');
        await this.pollObjectType(installation.id, installation.hubspotPortalId, 'deal');
        await this.pollObjectType(installation.id, installation.hubspotPortalId, 'note');
      }
    } catch (err: any) {
      this.logger.error(`HubSpot poll error: ${err.message}`, err.stack);
    } finally {
      this.isRunning = false;
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

        await this.queue.add(`${objectType}-${record.id}`, payload, {
          ...SYNC_JOB_OPTIONS,
          jobId: `hs.poll.${installationId}.${objectType}.${record.id}.${pollStart.getTime()}`,
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
