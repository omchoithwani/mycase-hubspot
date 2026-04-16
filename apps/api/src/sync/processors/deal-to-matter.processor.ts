import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { StageMappingService } from '../../stage-mapping/stage-mapping.service';
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
    private readonly fieldMapping: FieldMappingService,
    private readonly stageMapping: StageMappingService,
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

    // 2. Resolve linked MyCase client via HubSpot associations API
    const mycaseClientId = await this.resolveLinkedClient(
      installationId,
      installation.hubspotPortalId,
      sourceId,
    );

    if (!mycaseClientId) {
      return this.skip(
        'No linked MyCase client found — sync the associated contact first',
      );
    }

    // 3. Apply field mapping (replaces hardcoded mapping from Phase 3)
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'deal',
      'hs_to_mc',
      props as Record<string, unknown>,
    );

    // 4. Resolve deal stage → MyCase status
    const mycaseStatus = props.dealstage && props.pipeline
      ? await this.stageMapping.toMyCaseStatus(
          installationId,
          props.pipeline,
          props.dealstage,
        )
      : null;

    // 5. Compose final matter payload
    const matterData: McMatterInput = {
      name: (mapped['name'] as string) ?? props.dealname ?? 'Untitled Matter',
      client_id: mycaseClientId,
      status: mycaseStatus ?? 'Open',
      close_date: mapped['close_date'] as string | undefined,
      rate: mapped['rate'] as number | undefined,
    };

    // 6. Change detection
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'deal',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, matterData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 7. Create or update
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

    // 8. Upsert sync record + write back matter ID
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

  private async resolveLinkedClient(
    installationId: string,
    portalId: string,
    dealId: string,
  ): Promise<string | null> {
    const contactIds = await this.hubspot.getDealContactIds(
      portalId,
      installationId,
      dealId,
    );

    for (const contactId of contactIds) {
      const record = await this.syncRecords.findByHubSpotId(
        installationId,
        'contact',
        contactId,
      );
      if (record) return record.mycaseObjectId;
    }
    return null;
  }
}
