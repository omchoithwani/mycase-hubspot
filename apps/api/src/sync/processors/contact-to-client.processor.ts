import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { HubSpotPropertiesService } from '../../hubspot/hubspot-properties.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { DuplicateDetectorService } from '../../duplicate/duplicate-detector.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
import { McClientInput, McCustomFieldValue } from '../../mycase/dto/client.dto';

function extractCustomFieldValues(mapped: Record<string, unknown>): McCustomFieldValue[] {
  return Object.entries(mapped)
    .filter(([k]) => k.startsWith('custom_field:'))
    .map(([k, v]) => ({ custom_field: { id: parseInt(k.split(':')[1], 10) }, value: v as string | number | boolean }))
    .filter((cf) => !isNaN(cf.custom_field.id) && cf.value != null);
}

@Injectable()
export class ContactToClientProcessor extends BaseProcessor {
  readonly objectType = 'contact' as const;
  readonly direction = 'hs_to_mc' as const;

  private readonly logger = new Logger(ContactToClientProcessor.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly hsProperties: HubSpotPropertiesService,
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

    // 1. Fetch full contact from HubSpot with all properties so criteria evaluation
    //    sees the same fields as the test panel
    const allProps = await this.hsProperties.fetchProperties(
      installation.hubspotPortalId, installationId, 'contacts',
    );
    const contact = await this.hubspot.getContact(
      installation.hubspotPortalId,
      installationId,
      sourceId,
      allProps.map((p) => p.name),
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
    const customFieldValues = extractCustomFieldValues(mapped);
    const clientData: McClientInput = {
      first_name: (mapped['first_name'] as string) ?? contact.properties.firstname ?? '',
      last_name: (mapped['last_name'] as string) ?? contact.properties.lastname ?? '',
      email: (mapped['email'] as string) ?? contact.properties.email,
      cell_phone_number: (mapped['cell_phone_number'] as string) ?? contact.properties.phone,
      custom_field_values: customFieldValues.length > 0 ? customFieldValues : undefined,
    };

    // 5. Change detection
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'contact',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, clientData as any)) {
      this.logger.log(`Skipping HubSpot contact ${sourceId} — payload unchanged (hash match)`);
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

      try {
        const created = await this.mycase.createClient(installationId, clientData);
        mycaseId = String(created.id);
        action = 'created';
        this.logger.log(`Created MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
      } catch (err: any) {
        const body = err?.response?.data ?? {};
        const isEmailConflict =
          err?.response?.status === 422 &&
          JSON.stringify(body).toLowerCase().includes('email');

        if (!isEmailConflict || !clientData.email) throw err;

        // Email is taken in MyCase — try to find the existing client and update instead
        const existing = await this.mycase.searchClientByEmail(installationId, clientData.email);
        if (!existing) {
          // Client not findable via API (may be a staff/user account or outside API visibility).
          // Return a non-retrying failure — user must manually link in MyCase.
          return this.failed(
            'EMAIL_CONFLICT_UNRESOLVABLE',
            `MyCase reports email "${clientData.email}" is already taken but the client cannot be found via the API. ` +
            `This usually means the email belongs to a MyCase staff/user account. ` +
            `To fix: in MyCase, change the email on the conflicting account, then re-sync.`,
          );
        }
        }

        mycaseId = String(existing.id);
        await this.mycase.updateClient(installationId, mycaseId, clientData);
        action = 'updated';
        this.logger.log(
          `Resolved email conflict: linked contact ${sourceId} → existing MyCase client ${mycaseId}`,
        );
      }
    } else {
      this.logger.log(`Updating MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
      await this.mycase.updateClient(installationId, mycaseId, clientData);
      action = 'updated';
      this.logger.log(`Updated MyCase client ${mycaseId} from HubSpot contact ${sourceId}`);
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
