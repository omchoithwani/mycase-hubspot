import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { McClientInput } from '../../mycase/dto/client.dto';

@Injectable()
export class ContactToClientProcessor extends BaseProcessor {
  readonly objectType = 'contact' as const;
  readonly direction = 'hs_to_mc' as const;

  private readonly logger = new Logger(ContactToClientProcessor.name);

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

    // 1. Fetch full contact from HubSpot
    const contact = await this.hubspot.getContact(
      installation.hubspotPortalId,
      installationId,
      sourceId,
    );

    const props = contact.properties;

    // 2. Build MyCase client payload (Phase 4 will replace with FieldMappingService)
    const clientData: McClientInput = {
      first_name: props.firstname ?? '',
      last_name: props.lastname ?? '',
      email: props.email,
      phone_numbers: props.phone
        ? [{ number: props.phone, type: 'work' }]
        : undefined,
      company_name: props.company,
    };

    // 3. Change detection — skip if payload unchanged
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'contact',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, clientData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 4. Create or update in MyCase
    let mycaseId = existing?.mycaseObjectId;
    let action: 'created' | 'updated';

    if (!mycaseId) {
      const created = await this.mycase.createClient(installationId, clientData);
      mycaseId = created.id;
      action = 'created';
      this.logger.log(`Created MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
    } else {
      await this.mycase.updateClient(installationId, mycaseId, clientData);
      action = 'updated';
      this.logger.log(`Updated MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
    }

    // 5. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'contact',
      hubspotObjectId: sourceId,
      mycaseObjectId: mycaseId,
      payload: clientData as any,
      direction: 'hs_to_mc',
    });

    // 6. Write mycase_client_id back to HubSpot contact (best effort)
    try {
      await this.hubspot.updateContact(
        installation.hubspotPortalId,
        installationId,
        sourceId,
        { mycase_client_id: mycaseId },
      );
    } catch {
      this.logger.warn(`Could not write mycase_client_id back to contact ${sourceId}`);
    }

    return { success: true, action, destinationId: mycaseId };
  }
}
