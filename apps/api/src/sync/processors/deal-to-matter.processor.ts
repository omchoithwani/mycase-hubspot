import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { McMatterInput } from '../../mycase/dto/matter.dto';

@Injectable()
export class DealToMatterProcessor extends BaseProcessor {
  readonly objectType = 'deal' as const;
  readonly direction = 'hs_to_mc' as const;

  private readonly logger = new Logger(DealToMatterProcessor.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    private readonly syncRecords: SyncRecordService,
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch deal from HubSpot
    const deal = await this.hubspot.getDeal(
      installation.hubspotPortalId,
      installationId,
      sourceId,
    );

    const props = deal.properties;

    // Resolve linked MyCase client via the associated contact's mycase_client_id
    // (Phase 4 will make this more robust; for now we look up via stored sync record)
    const contactSyncRecord = await this.resolveLinkedClient(
      installationId,
      installation.hubspotPortalId,
      sourceId,
    );

    if (!contactSyncRecord) {
      return this.skip(
        'No linked MyCase client found for this deal — sync the associated contact first',
      );
    }

    // 2. Build matter payload (Phase 4 replaces with FieldMappingService + StageMappingService)
    const matterData: McMatterInput = {
      name: props.dealname ?? 'Untitled Matter',
      client_id: contactSyncRecord,
      status: 'Open', // Phase 4: resolve from StageMappingService
      close_date: props.closedate
        ? new Date(Number(props.closedate)).toISOString().split('T')[0]
        : undefined,
      rate: props.amount ? Math.round(parseFloat(props.amount) * 100) : undefined,
    };

    // 3. Change detection
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'deal',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, matterData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 4. Create or update
    let mycaseId = existing?.mycaseObjectId;
    let action: 'created' | 'updated';

    if (!mycaseId) {
      const created = await this.mycase.createMatter(installationId, matterData);
      mycaseId = created.id;
      action = 'created';
      this.logger.log(`Created MyCase matter ${mycaseId} from HubSpot deal ${sourceId}`);
    } else {
      await this.mycase.updateMatter(installationId, mycaseId, matterData);
      action = 'updated';
    }

    // 5. Upsert sync record + write back matter ID to HubSpot
    await this.syncRecords.upsert({
      installationId,
      objectType: 'deal',
      hubspotObjectId: sourceId,
      mycaseObjectId: mycaseId,
      payload: matterData as any,
      direction: 'hs_to_mc',
    });

    try {
      await this.hubspot.updateDeal(
        installation.hubspotPortalId,
        installationId,
        sourceId,
        { mycase_matter_id: mycaseId },
      );
    } catch {
      this.logger.warn(`Could not write mycase_matter_id back to deal ${sourceId}`);
    }

    return { success: true, action, destinationId: mycaseId };
  }

  /** Find the MyCase client ID linked to any HubSpot contact associated with this deal */
  private async resolveLinkedClient(
    installationId: string,
    _portalId: string,
    _dealId: string,
  ): Promise<string | null> {
    // Phase 4 will look up the deal's associated contacts via HubSpot associations API.
    // For now, return null (deals without an associated synced contact are skipped).
    return null;
  }
}
