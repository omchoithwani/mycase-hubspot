import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { HsContactInput } from '../../hubspot/dto/contact.dto';

@Injectable()
export class ClientToContactProcessor extends BaseProcessor {
  readonly objectType = 'contact' as const;
  readonly direction = 'mc_to_hs' as const;

  private readonly logger = new Logger(ClientToContactProcessor.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    private readonly syncRecords: SyncRecordService,
    private readonly fieldMapping: FieldMappingService,
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch full client from MyCase
    const client = await this.mycase.getClient(installationId, sourceId);

    // 2. Apply configured field mapping
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'contact',
      'mc_to_hs',
      client as unknown as Record<string, unknown>,
    );

    // 3. Build HubSpot contact payload (mapped fields + required fallbacks)
    const contactData: HsContactInput = {
      firstname: (mapped['firstname'] as string) ?? client.first_name,
      lastname: (mapped['lastname'] as string) ?? client.last_name,
      email: (mapped['email'] as string) ?? client.email,
      phone: (mapped['phone'] as string) ?? client.phone_numbers?.[0]?.number,
      company: (mapped['company'] as string) ?? client.company_name,
      mycase_client_id: sourceId,
    };

    // 4. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'contact',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, contactData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 5. Create or update in HubSpot
    let hubspotId = existing?.hubspotObjectId;
    let action: 'created' | 'updated';

    if (!hubspotId) {
      const created = await this.hubspot.createContact(
        installation.hubspotPortalId,
        installationId,
        contactData,
      );
      hubspotId = created.id;
      action = 'created';
      this.logger.log(`Created HubSpot contact ${hubspotId} from MyCase client ${sourceId}`);
    } else {
      await this.hubspot.updateContact(
        installation.hubspotPortalId,
        installationId,
        hubspotId,
        contactData,
      );
      action = 'updated';
      this.logger.log(`Updated HubSpot contact ${hubspotId} from MyCase client ${sourceId}`);
    }

    // 6. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'contact',
      hubspotObjectId: hubspotId,
      mycaseObjectId: sourceId,
      payload: contactData as any,
      direction: 'mc_to_hs',
    });

    return { success: true, action, destinationId: hubspotId };
  }
}
