import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
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
private readonly syncCriteria: SyncCriteriaService,
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch full client from MyCase — skip if deleted
    let client: Awaited<ReturnType<typeof this.mycase.getClient>>;
    try {
      client = await this.mycase.getClient(installationId, sourceId);
    } catch (err) {
      if (err instanceof NotFoundException) return this.skip('MyCase client not found (deleted)');
      throw err;
    }

    // 2. Evaluate sync criteria
    const eligible = await this.syncCriteria.evaluate(
      installationId,
      'contact',
      'mycase',
      client as unknown as Record<string, unknown>,
    );
    if (!eligible) return this.skip('Record does not meet sync criteria');

    // 3. Apply configured field mapping
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'contact',
      'mc_to_hs',
      client as unknown as Record<string, unknown>,
    );

    // 4. Build HubSpot contact payload (mapped fields + required fallbacks)
    const contactData: HsContactInput = {
      firstname: (mapped['firstname'] as string) ?? client.first_name,
      lastname: (mapped['lastname'] as string) ?? client.last_name,
      email: (mapped['email'] as string) ?? client.email,
      phone: (mapped['phone'] as string) ?? client.cell_phone_number ?? client.home_phone_number,
      my_case_id: sourceId,
    };

    // 5. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'contact',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, contactData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 6. mc_to_hs only updates — never create a new HubSpot contact from MyCase.
    //    Contacts originate in HubSpot; MyCase changes only propagate back to existing records.
    const hubspotId = existing?.hubspotObjectId;

    if (!hubspotId) {
      return this.skip('No linked HubSpot contact — mc_to_hs only updates existing records (create in HubSpot first)');
    }

    await this.hubspot.updateContact(
      installation.hubspotPortalId,
      installationId,
      hubspotId,
      contactData,
    );
    const action = 'updated';
    this.logger.log(`Updated HubSpot contact ${hubspotId} from MyCase client ${sourceId}`);

    // 7. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'contact',
      hubspotObjectId: hubspotId,
      mycaseObjectId: sourceId,
      payload: contactData as any,
      direction: 'mc_to_hs',
    });

    return { success: true, action, destinationId: hubspotId, syncedData: contactData as Record<string, unknown> };
  }
}
