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
    //    can reference any custom field as custom_field:{id}
    const customFlat: Record<string, unknown> = {};
    for (const cfv of matter.custom_field_values ?? []) {
      const cfId = cfv.custom_field?.id;
      if (cfId != null) customFlat[`custom_field:${cfId}`] = cfv.value;
    }

    this.logger.log(
      `matter-to-deal [${sourceId}]: custom fields on matter: ${JSON.stringify(customFlat)}`,
    );

    // 5. Apply configured field mapping (custom fields now available as custom_field:ID)
    const [mapped, lockedFields] = await Promise.all([
      this.fieldMapping.applyMapping(
        installationId,
        'deal',
        'mc_to_hs',
        { ...(matter as unknown as Record<string, unknown>), ...customFlat },
      ),
      this.fieldMapping.getSourceOfTruthLockedFields(installationId, 'deal', 'mc_to_hs'),
    ]);

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
    const amount =
      (mapped['amount'] as string | undefined) ??
      (matter.outstanding_balance != null && matter.outstanding_balance !== 0
        ? String(matter.outstanding_balance)
        : undefined);

    this.logger.log(
      `matter-to-deal [${sourceId}]: name="${matter.name}" mapped_amount=${mapped['amount']} → amount=${amount}`,
    );

    // Helper: include a field only if it has a mapped value OR is not locked to HubSpot
    const field = (name: string, mappedVal: unknown, fallback: unknown): string | undefined => {
      if (mappedVal != null) return String(mappedVal);
      if (lockedFields.has(name)) return undefined; // HubSpot is source of truth — don't overwrite
      return fallback != null ? String(fallback) : undefined;
    };

    const dealData: HsDealInput = {
      // Spread all configured field mappings (non-null only)
      ...(Object.fromEntries(
        Object.entries(mapped).filter(([, v]) => v != null),
      ) as Record<string, string | undefined>),
      // Core fields with source-of-truth awareness
      dealname: field('dealname', mapped['dealname'], matter.name),
      my_case_id: sourceId,
      closedate: field(
        'closedate',
        mapped['closedate'],
        matter.sol_date ? String(new Date(matter.sol_date).getTime()) : undefined,
      ),
      amount,
      practice_area: field('practice_area', mapped['practice_area'], matter.practice_area),
      case_stage: field('case_stage', mapped['case_stage'], matter.case_stage),
      // Stage mapping only on create
      ...(hsStage ? { dealstage: hsStage.stageId, pipeline: hsStage.pipelineId } : {}),
    };

    this.logger.log(
      `matter-to-deal [${sourceId}]: dealData practice_area="${dealData.practice_area}" case_stage="${dealData.case_stage}" dealname="${dealData.dealname}"`,
    );

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
