import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { DuplicateDetectorService } from '../../duplicate/duplicate-detector.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
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
    private readonly fieldMapping: FieldMappingService,
    private readonly duplicateDetector: DuplicateDetectorService,
    private readonly syncCriteria: SyncCriteriaService,
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

    // 2. Evaluate sync criteria
    const eligible = await this.syncCriteria.evaluate(
      installationId,
      'contact',
      'hubspot',
      contact.properties as Record<string, unknown>,
    );
    if (!eligible) return this.skip('Record does not meet sync criteria');

    // 3. Apply configured field mapping
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'contact',
      'hs_to_mc',
      contact.properties as Record<string, unknown>,
    );

    // 4. Build MyCase client (mapped fields + required fallbacks)
    const clientData: McClientInput = {
      first_name: (mapped['first_name'] as string) ?? contact.properties.firstname ?? '',
      last_name: (mapped['last_name'] as string) ?? contact.properties.lastname ?? '',
      email: (mapped['email'] as string) ?? contact.properties.email,
      cell_phone_number: (mapped['cell_phone_number'] as string) ?? contact.properties.phone,
    };

    // 5. Change detection
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'contact',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, clientData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 6. Duplicate detection (create path only)
    let mycaseId = existing?.mycaseObjectId;
    let action: 'created' | 'updated';

    if (!mycaseId) {
      const dupResult = await this.duplicateDetector.findExistingContact(
        installationId,
        installation.hubspotPortalId,
        'hs_to_mc',
        {
          email: clientData.email,
          firstName: clientData.first_name,
          lastName: clientData.last_name,
          phone: clientData.cell_phone_number,
        },
      );

      if (dupResult.ambiguous) {
        return this.failed('DUPLICATE_AMBIGUOUS', 'Ambiguous duplicate — manual review required');
      }

      if (dupResult.existingId) {
        this.logger.log(
          `Linked contact ${sourceId} to existing MyCase client ${dupResult.existingId} (${dupResult.confidence} match)`,
        );
        await this.syncRecords.upsert({
          installationId,
          objectType: 'contact',
          hubspotObjectId: sourceId,
          mycaseObjectId: dupResult.existingId,
          payload: clientData as any,
          direction: 'hs_to_mc',
        });
        return this.skip(`Linked to existing MyCase client (${dupResult.confidence} match)`);
      }

      const created = await this.mycase.createClient(installationId, clientData);
      mycaseId = String(created.id);
      action = 'created';
      this.logger.log(`Created MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
    } else {
      await this.mycase.updateClient(installationId, mycaseId, clientData);
      action = 'updated';
    }

    // 7. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'contact',
      hubspotObjectId: sourceId,
      mycaseObjectId: mycaseId!,
      payload: clientData as any,
      direction: 'hs_to_mc',
    });

    // 8. Write back mycase_client_id (best effort)
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
