import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
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
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch matter from MyCase
    const matter = await this.mycase.getMatter(installationId, sourceId);

    // 2. Resolve linked HubSpot contact
    const contactRecord = await this.syncRecords.findByMyCaseId(
      installationId,
      'contact',
      matter.client_id,
    );

    // 3. Build deal payload (Phase 4 replaces with full mapping + stage resolution)
    const dealData: HsDealInput = {
      dealname: matter.name,
      mycase_matter_id: sourceId,
      // Phase 4: dealstage resolved from StageMappingService
      closedate: matter.close_date
        ? String(new Date(matter.close_date).getTime())
        : undefined,
      amount: matter.rate != null ? String(matter.rate / 100) : undefined,
    };

    // 4. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'deal',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, dealData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 5. Create or update in HubSpot
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

      // Associate deal with HubSpot contact if we have the mapping
      if (contactRecord) {
        // Phase 4 will add proper association via HubSpot associations API
        this.logger.debug(
          `TODO Phase 4: associate deal ${hubspotId} with contact ${contactRecord.hubspotObjectId}`,
        );
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

    // 6. Upsert sync record
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
