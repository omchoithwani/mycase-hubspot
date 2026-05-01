import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { StageMappingService } from '../../stage-mapping/stage-mapping.service';
import { DuplicateDetectorService } from '../../duplicate/duplicate-detector.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
import { HsDealInput } from '../../hubspot/dto/deal.dto';

/** Normalize a custom field name for loose matching ("Case Value" → "casevalue") */
function normalizeFieldName(name: string): string {
  return name.toLowerCase().replace(/[\s_-]/g, '');
}

@Injectable()
export class MatterToDealProcessor extends BaseProcessor {
  readonly objectType = 'deal' as const;
  readonly direction = 'mc_to_hs' as const;

  private readonly logger = new Logger(MatterToDealProcessor.name);

  /** Simple per-installation cache so we don't call listCustomFields on every sync job */
  private readonly customFieldCache = new Map<string, { fields: Array<{ id: number; name: string; parent_type: string }>; expiresAt: number }>();

  private async getCaseCustomFields(installationId: string) {
    const cached = this.customFieldCache.get(installationId);
    if (cached && cached.expiresAt > Date.now()) return cached.fields;

    const all = await this.mycase.listCustomFields(installationId);
    const caseFields = all.filter((f) =>
      f.parent_type?.toLowerCase() === 'case' || f.parent_type?.toLowerCase() === 'matter',
    );
    this.customFieldCache.set(installationId, { fields: caseFields, expiresAt: Date.now() + 10 * 60 * 1000 });
    return caseFields;
  }

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
    private readonly syncRecords: SyncRecordService,
    private readonly fieldMapping: FieldMappingService,
    private readonly stageMapping: StageMappingService,
    private readonly duplicateDetector: DuplicateDetectorService,
    private readonly syncCriteria: SyncCriteriaService,
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch matter from MyCase
    const matter = await this.mycase.getMatter(installationId, sourceId);

    // 2. Evaluate sync criteria
    const eligible = await this.syncCriteria.evaluate(
      installationId,
      'deal',
      'mycase',
      matter as unknown as Record<string, unknown>,
    );
    if (!eligible) return this.skip('Record does not meet sync criteria');

    // 3. Resolve linked HubSpot contact
    const linkedClientId = matter.clients?.[0]?.id ? String(matter.clients[0].id) : null;
    const contactRecord = linkedClientId
      ? await this.syncRecords.findByMyCaseId(installationId, 'contact', linkedClientId)
      : null;

    // 4. Flatten custom_field_values into the mapping source so field mappings
    //    can reference them as custom_field:{id}, and find "case value" by name.
    const caseFields = await this.getCaseCustomFields(installationId);
    const customFlat: Record<string, unknown> = {};
    let caseValueAmount: string | undefined;

    for (const cfv of matter.custom_field_values ?? []) {
      const cfId = cfv.custom_field?.id;
      if (cfId == null) continue;
      customFlat[`custom_field:${cfId}`] = cfv.value;

      // Match by name so "case value" works without any field mapping config
      const meta = caseFields.find((f) => f.id === cfId);
      if (meta && normalizeFieldName(meta.name) === 'casevalue' && cfv.value != null) {
        caseValueAmount = String(cfv.value);
      }
    }

    // 5. Apply configured field mapping (custom fields now available as custom_field:ID)
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'deal',
      'mc_to_hs',
      { ...(matter as unknown as Record<string, unknown>), ...customFlat },
    );

    // 6. Check for existing sync record first so we know if this is create or update
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'deal',
      sourceId,
    );

    // 7. Resolve MyCase status → HubSpot stage — only on create.
    //    On updates, leave the stage as-is in HubSpot (let users manage it there).
    const isCreate = !existing?.hubspotObjectId;
    const hsStage = isCreate && matter.status
      ? await this.stageMapping.toHubSpotStage(installationId, matter.status)
      : null;

    // 8. Compose final deal payload
    // Priority: field mapping config > "case value" custom field > outstanding_balance fallback
    const amount =
      (mapped['amount'] as string | undefined) ??
      caseValueAmount ??
      (matter.outstanding_balance != null && matter.outstanding_balance !== 0
        ? String(matter.outstanding_balance)
        : undefined);

    this.logger.log(
      `matter-to-deal [${sourceId}]: name="${matter.name}" case_value=${caseValueAmount} outstanding_balance=${matter.outstanding_balance} → amount=${amount}`,
    );

    const dealData: HsDealInput = {
      dealname: (mapped['dealname'] as string) ?? matter.name,
      my_case_id: sourceId,
      closedate:
        (mapped['closedate'] as string) ??
        (matter.sol_date ? String(new Date(matter.sol_date).getTime()) : undefined),
      amount,
      ...(hsStage ? { dealstage: hsStage.stageId, pipeline: hsStage.pipelineId } : {}),
    };

    // 8. Change detection
    if (existing && this.syncRecords.isSamePayload(existing, dealData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 9. Duplicate detection (create path only)
    let hubspotId = existing?.hubspotObjectId;
    let action: 'created' | 'updated';

    if (!hubspotId) {
      const dupResult = await this.duplicateDetector.findExistingDeal(
        installationId,
        installation.hubspotPortalId,
        'mc_to_hs',
        {
          name: dealData.dealname ?? matter.name,
          linkedContactHsId: contactRecord?.hubspotObjectId,
        },
      );

      if (dupResult.existingId) {
        this.logger.log(
          `Linked matter ${sourceId} to existing HubSpot deal ${dupResult.existingId} (${dupResult.confidence} match)`,
        );
        await this.syncRecords.upsert({
          installationId,
          objectType: 'deal',
          hubspotObjectId: dupResult.existingId,
          mycaseObjectId: sourceId,
          payload: dealData as any,
          direction: 'mc_to_hs',
        });
        return this.skip(`Linked to existing HubSpot deal (${dupResult.confidence} match)`);
      }

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

    // 9. Upsert sync record
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
