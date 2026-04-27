import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InstallationService } from '../installation/installation.service';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTIONS } from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

@Injectable()
export class InitialSyncService {
  private readonly logger = new Logger(InitialSyncService.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    @InjectQueue(QUEUE_HS_TO_MC) private readonly hsToMcQueue: Queue,
    @InjectQueue(QUEUE_MC_TO_HS) private readonly mcToHsQueue: Queue,
  ) {}

  async triggerSingleRecord(
    installationId: string,
    objectType: 'contact' | 'deal',
    recordId: string,
    direction: 'hs_to_mc' | 'mc_to_hs',
  ): Promise<void> {
    const queue = direction === 'hs_to_mc' ? this.hsToMcQueue : this.mcToHsQueue;
    const sourceSystem = direction === 'hs_to_mc' ? 'hubspot' : 'mycase';
    await queue.add(
      'sync',
      {
        installationId,
        objectType,
        direction,
        sourceId: recordId,
        sourceSystem,
        triggeredBy: 'manual',
      } as SyncJobPayload,
      {
        ...SYNC_JOB_OPTIONS,
        jobId: `force:${objectType}:${recordId}:${Date.now()}`,
      },
    );
    this.logger.log(`Force-sync enqueued: ${direction} ${objectType}/${recordId}`);
  }

  async triggerForInstallation(installationId: string): Promise<{ enqueued: number }> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    const portalId = installation.hubspotPortalId;
    let enqueued = 0;

    enqueued += await this.enqueueHubSpotObjects(portalId, installationId, 'contact');
    enqueued += await this.enqueueHubSpotObjects(portalId, installationId, 'deal');
    enqueued += await this.enqueueMyCaseClients(installationId);
    enqueued += await this.enqueueMyCaseMatters(installationId);

    this.logger.log(
      `Initial sync triggered for installation ${installationId}: ${enqueued} jobs enqueued`,
    );
    return { enqueued };
  }

  private async enqueueHubSpotObjects(
    portalId: string,
    installationId: string,
    objectType: 'contact' | 'deal',
  ): Promise<number> {
    let after: string | undefined;
    let count = 0;

    do {
      const page =
        objectType === 'contact'
          ? await this.hubspot.listContactsPage(portalId, installationId, after)
          : await this.hubspot.listDealsPage(portalId, installationId, after);

      if (page.results.length > 0) {
        await this.hsToMcQueue.addBulk(
          page.results.map((obj) => ({
            name: 'sync',
            data: {
              installationId,
              objectType,
              direction: 'hs_to_mc',
              sourceId: obj.id,
              sourceSystem: 'hubspot',
              triggeredBy: 'manual',
            } as SyncJobPayload,
            opts: {
              ...SYNC_JOB_OPTIONS,
              jobId: `initial:${objectType}:${obj.id}`,
            },
          })),
        );
        count += page.results.length;
      }

      after = page.nextAfter;
    } while (after);

    return count;
  }

  private async enqueueMyCaseClients(installationId: string): Promise<number> {
    const clients = await this.mycase.listClients(installationId);
    if (clients.length === 0) return 0;

    await this.mcToHsQueue.addBulk(
      clients.map((c) => ({
        name: 'sync',
        data: {
          installationId,
          objectType: 'contact',
          direction: 'mc_to_hs',
          sourceId: String(c.id),
          sourceSystem: 'mycase',
          triggeredBy: 'manual',
        } as SyncJobPayload,
        opts: {
          ...SYNC_JOB_OPTIONS,
          jobId: `initial:mc_client:${c.id}`,
        },
      })),
    );
    return clients.length;
  }

  private async enqueueMyCaseMatters(installationId: string): Promise<number> {
    const matters = await this.mycase.listMatters(installationId);
    if (matters.length === 0) return 0;

    await this.mcToHsQueue.addBulk(
      matters.map((m) => ({
        name: 'sync',
        data: {
          installationId,
          objectType: 'deal',
          direction: 'mc_to_hs',
          sourceId: String(m.id),
          sourceSystem: 'mycase',
          triggeredBy: 'manual',
        } as SyncJobPayload,
        opts: {
          ...SYNC_JOB_OPTIONS,
          jobId: `initial:mc_matter:${m.id}`,
        },
      })),
    );
    return matters.length;
  }
}
