import { Injectable, Logger } from '@nestjs/common';
import { InstallationService } from '../installation/installation.service';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_HS_TO_MC, QUEUE_MC_TO_HS, SYNC_JOB_OPTS } from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

@Injectable()
export class InitialSyncService {
  private readonly logger = new Logger(InitialSyncService.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    private readonly pgBoss: PgBossService,
  ) {}

  async triggerSingleRecord(
    installationId: string,
    objectType: 'contact' | 'deal',
    recordId: string,
    direction: 'hs_to_mc' | 'mc_to_hs',
    force = false,
  ): Promise<void> {
    const queueName = direction === 'hs_to_mc' ? QUEUE_HS_TO_MC : QUEUE_MC_TO_HS;
    const sourceSystem = direction === 'hs_to_mc' ? 'hubspot' : 'mycase';
    await this.pgBoss.send(
      queueName,
      {
        installationId,
        objectType,
        direction,
        sourceId: recordId,
        sourceSystem,
        triggeredBy: 'manual',
        force,
      } as SyncJobPayload,
      {
        ...SYNC_JOB_OPTS,
        singletonKey: `force.${objectType}.${recordId}.${Date.now()}`,
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
        await this.pgBoss.insert(
          page.results.map((obj) => ({
            name: QUEUE_HS_TO_MC,
            data: {
              installationId,
              objectType,
              direction: 'hs_to_mc',
              sourceId: obj.id,
              sourceSystem: 'hubspot',
              triggeredBy: 'manual',
            } as SyncJobPayload,
            ...SYNC_JOB_OPTS,
            singletonKey: `initial:${objectType}:${obj.id}`,
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

    await this.pgBoss.insert(
      clients.map((c) => ({
        name: QUEUE_MC_TO_HS,
        data: {
          installationId,
          objectType: 'contact',
          direction: 'mc_to_hs',
          sourceId: String(c.id),
          sourceSystem: 'mycase',
          triggeredBy: 'manual',
        } as SyncJobPayload,
        ...SYNC_JOB_OPTS,
        singletonKey: `initial:mc_client:${c.id}`,
      })),
    );
    return clients.length;
  }

  private async enqueueMyCaseMatters(installationId: string): Promise<number> {
    const matters = await this.mycase.listMatters(installationId);
    if (matters.length === 0) return 0;

    await this.pgBoss.insert(
      matters.map((m) => ({
        name: QUEUE_MC_TO_HS,
        data: {
          installationId,
          objectType: 'deal',
          direction: 'mc_to_hs',
          sourceId: String(m.id),
          sourceSystem: 'mycase',
          triggeredBy: 'manual',
        } as SyncJobPayload,
        ...SYNC_JOB_OPTS,
        singletonKey: `initial:mc_matter:${m.id}`,
      })),
    );
    return matters.length;
  }
}
