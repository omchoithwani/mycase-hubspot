import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { StageMappingService } from '../../stage-mapping/stage-mapping.service';
import { HsDealInput } from '../../hubspot/dto/deal.dto';

@Injectable()
export class MatterToDealProcessor extends BaseProcessor {
  readonly objectType = 'deal' as const;
  readonly direction = 'mc_to_hs' as const;

  private readonly logger = new Logger(MatterToDealProcessor.name);

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

    // 1. Fetch matter from MyCase
    const matter = await this.mycase.getMatter(installationId, sourceId);

    // 2. Resolve linked HubSpot contact
    const contactRecord = matter.client_id
      ? await this.syncRecords.findByMyCaseId(installationId, 'contact', matter.client_id)
      : null;

    // 3. Apply configured field mapping
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'deal',
      'mc_to_hs',
      matter as unknown as Record<string, unknown>,
    );

    // 4. Resolve MyCase status → HubSpot stage
    const hsStage = matter.status
      ? await this.stageMapping.toHubSpotStage(installationId, matter.status)
      : null;

    // 5. Compose final deal payload
    const dealData: HsDealInput = {
      dealname: (mapped['dealname'] as string) ?? matter.name,
      mycase_matter_id: sourceId,
      closedate:
        (mapped['closedate'] as string) ??
        (matter.close_date ? String(new Date(matter.close_date).getTime()) : undefined),
      amount:
        (mapped['amount'] as string) ??
        (matter.rate != null ? String(matter.rate / 100) : undefined),
      dealstage: hsStage?.stageId,
      pipeline: hsStage?.pipelineId,
    };

    // 6. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'deal',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, dealData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 7. Create or update in HubSpot
    let hubspotId = existing?.hubspotObjectId;
    let action: 'created' | 'updated';

    if (!hubspotId) {
      const created = await this.hubspot.createDeal(
        installation.hubspotPortalId,
        installationId,
        dealData,
      );
      hubspotId = created.id;
      action = 'created';

      // Associate deal with HubSpot contact (best effort)
      if (contactRecord) {
        try {
          await this.hubspot.associateDealWithContact(
            installation.hubspotPortalId,
            installationId,
            hubspotId,
            contactRecord.hubspotObjectId,
          );
        } catch {
          this.logger.warn(
            `Could not associate deal ${hubspotId} with contact ${contactRecord.hubspotObjectId}`,
          );
        }
      }

      this.logger.log(`Created HubSpot deal ${hubspotId} from MyCase matter ${sourceId}`);
    } else {
      await this.hubspot.updateDeal(
        installation.hubspotPortalId,
        installationId,
        hubspotId,
        dealData,
      );
      action = 'updated';
    }

    // 8. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'deal',
      hubspotObjectId: hubspotId,
      mycaseObjectId: sourceId,
      payload: dealData as any,
      direction: 'mc_to_hs',
    });

    return { success: true, action, destinationId: hubspotId };
  }
}
