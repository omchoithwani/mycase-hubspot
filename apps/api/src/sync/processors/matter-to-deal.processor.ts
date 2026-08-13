import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { StageMappingService } from '../../stage-mapping/stage-mapping.service';
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
private readonly syncCriteria: SyncCriteriaService,
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch matter from MyCase — skip if deleted
    let matter: Awaited<ReturnType<typeof this.mycase.getMatter>>;
    try {
      matter = await this.mycase.getMatter(installationId, sourceId);
    } catch (err) {
      if (err instanceof NotFoundException) return this.skip('MyCase matter not found (deleted)');
      throw err;
    }

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

    // Helper: include a field only if it has a mapped value OR is not locked to HubSpot.
    // On initial creation, always copy the field regardless of source-of-truth setting —
    // the source-of-truth only applies to subsequent updates.
    const field = (name: string, mappedVal: unknown, fallback: unknown): string | undefined => {
      if (mappedVal != null) return String(mappedVal);
      if (!isCreate && lockedFields.has(name)) return undefined; // Update: HubSpot owns this — skip
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

    // 9. mc_to_hs only updates — never create a new HubSpot deal from MyCase.
    //    Deals originate in HubSpot; MyCase changes only propagate back to existing records.
    const hubspotId = existing?.hubspotObjectId;
    const fieldMismatches: import('@mycase-hubspot/shared-types').FieldMismatch[] = [];

    if (!hubspotId) {
      return this.skip('No linked HubSpot deal — mc_to_hs only updates existing records (create in HubSpot first)');
    }

    try {
      await this.hubspot.updateDeal(installation.hubspotPortalId, installationId, hubspotId, dealData);
    } catch (err: any) {
      const stripped = this.stripHubSpotInvalid(err, dealData as Record<string, unknown>, fieldMismatches);
      if (!stripped) throw err;
      await this.hubspot.updateDeal(installation.hubspotPortalId, installationId, hubspotId, stripped as any);
    }
    const action = 'updated';

    // Associate deal with HubSpot contact on every sync run — idempotent, repairs
    // failed associations from previous runs (e.g. contact wasn't synced yet).
    if (contactRecord) {
      try {
        await this.hubspot.associateDealWithContact(
          installation.hubspotPortalId,
          installationId,
          hubspotId,
          contactRecord.hubspotObjectId,
        );
      } catch (err: any) {
        this.logger.warn(
          `Could not associate deal ${hubspotId} with contact ${contactRecord.hubspotObjectId}: ${err?.message ?? err}`,
        );
      }
    } else {
      this.logger.warn(
        `matter-to-deal [${sourceId}]: no linked HubSpot contact found — deal ${hubspotId} left unassociated`,
      );
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

    return { success: true, action, destinationId: hubspotId, fieldMismatches, syncedData: dealData as Record<string, unknown> };
  }

  /**
   * On a HubSpot 422 with validationResults, strips the invalid fields from
   * payload, records them as fieldMismatches, and returns the stripped payload.
   * Returns null if the error is not a recoverable 422.
   */
  private stripHubSpotInvalid(
    err: any,
    payload: Record<string, unknown>,
    mismatches: import('@mycase-hubspot/shared-types').FieldMismatch[],
  ): Record<string, unknown> | null {
    const status: number = err?.statusCode;
    if (status !== 400 && status !== 422) return null;

    // 422: uses validationResults array
    if (status === 422) {
      const validationResults: any[] = err?.responseData?.validationResults ?? [];
      const invalidFields = validationResults.filter((r) => !r.isValid).map((r) => r.name as string);
      if (invalidFields.length === 0) return null;
      this.logger.warn(`HubSpot 422 — stripping [${invalidFields.join(', ')}] and retrying`);
      for (const r of validationResults.filter((r) => !r.isValid)) {
        mismatches.push({ field: r.name, droppedValue: payload[r.name], reason: r.message ?? 'Invalid value' });
      }
      const stripped = { ...payload };
      invalidFields.forEach((f) => delete stripped[f]);
      return stripped;
    }

    // 400 VALIDATION_ERROR: uses errors array with context.propertyName
    const errors: any[] = err?.responseData?.errors ?? [];
    const invalidFields = errors
      .filter((e) => e.code === 'INVALID_OPTION' || e.code === 'INVALID_ENUM_VALUE')
      .map((e) => (e.context?.propertyName?.[0] ?? e.name) as string)
      .filter(Boolean);
    if (invalidFields.length === 0) return null;
    this.logger.warn(`HubSpot 400 VALIDATION_ERROR — stripping [${invalidFields.join(', ')}] and retrying`);
    for (const e of errors.filter((e) => e.code === 'INVALID_OPTION' || e.code === 'INVALID_ENUM_VALUE')) {
      const field = e.context?.propertyName?.[0] ?? e.name;
      if (field) mismatches.push({ field, droppedValue: payload[field], reason: e.message ?? 'Invalid enum value' });
    }
    const stripped = { ...payload };
    invalidFields.forEach((f) => delete stripped[f]);
    return stripped;
  }
}
