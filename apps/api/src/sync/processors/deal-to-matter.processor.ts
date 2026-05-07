import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { HubSpotPropertiesService } from '../../hubspot/hubspot-properties.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { StageMappingService } from '../../stage-mapping/stage-mapping.service';
import { DuplicateDetectorService } from '../../duplicate/duplicate-detector.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
import { McMatterInput, McMatter, McCustomFieldValue } from '../../mycase/dto/matter.dto';

function extractCustomFieldValues(mapped: Record<string, unknown>): McCustomFieldValue[] {
  return Object.entries(mapped)
    .filter(([k]) => k.startsWith('custom_field:'))
    .map(([k, v]) => ({ custom_field: { id: parseInt(k.split(':')[1], 10) }, value: v as string | number | boolean }))
    .filter((cf) => !isNaN(cf.custom_field.id) && cf.value != null);
}

@Injectable()
export class DealToMatterProcessor extends BaseProcessor {
  readonly objectType = 'deal' as const;
  readonly direction = 'hs_to_mc' as const;

  private readonly logger = new Logger(DealToMatterProcessor.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly hubspot: HubSpotClientService,
    private readonly hsProperties: HubSpotPropertiesService,
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

    // 1. Fetch deal from HubSpot with all properties so criteria evaluation
    //    sees the same fields as the test panel
    const allProps = await this.hsProperties.fetchProperties(
      installation.hubspotPortalId, installationId, 'deals',
    );
    const deal = await this.hubspot.getDeal(
      installation.hubspotPortalId,
      installationId,
      sourceId,
      allProps.map((p) => p.name),
    );

    const props = deal.properties;

    // 2. Evaluate sync criteria (skipped when force=true)
    if (!payload.force) {
      const eligible = await this.syncCriteria.evaluate(
        installationId,
        'deal',
        'hubspot',
        props as Record<string, unknown>,
      );
      if (!eligible) return this.skip('Record does not meet sync criteria');
    }

    // 3. Resolve linked MyCase client via HubSpot associations API
    const mycaseClientId = await this.resolveLinkedClient(
      installationId,
      installation.hubspotPortalId,
      sourceId,
    );

    if (!mycaseClientId) {
      // Throw so BullMQ retries with backoff — the contact sync may still be in flight
      throw new Error(
        'No linked MyCase client found — contact sync may be in progress, will retry',
      );
    }

    // 4. Apply field mapping (hs_object_id injected so users can map it to a MyCase custom field)
    const [mapped, lockedFields, rawMappings] = await Promise.all([
      this.fieldMapping.applyMapping(
        installationId,
        'deal',
        'hs_to_mc',
        { ...props as Record<string, unknown>, hs_object_id: deal.id },
      ),
      this.fieldMapping.getSourceOfTruthLockedFields(installationId, 'deal', 'hs_to_mc'),
      this.fieldMapping.list(installationId, 'deal'),
    ]);

    // Build CF ID → HubSpot field name map for human-readable error labels
    const cfLabelMap = new Map<string, string>();
    for (const m of rawMappings) {
      if (m.mycaseField.startsWith('custom_field:')) {
        cfLabelMap.set(m.mycaseField, m.hubspotField);
      }
    }

    // 5. Resolve deal stage → MyCase status + stage label
    const mycaseStatus = props.dealstage && props.pipeline
      ? await this.stageMapping.toMyCaseStatus(
          installationId,
          props.pipeline as string,
          props.dealstage as string,
        )
      : null;
    const stageLabel = props.dealstage && props.pipeline
      ? await this.stageMapping.toStageLabel(
          installationId,
          props.pipeline as string,
          props.dealstage as string,
        )
      : null;

    const fieldMismatches: import('@mycase-hubspot/shared-types').FieldMismatch[] = [];

    // 6. Look up existing sync record first so we know create vs update
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'deal',
      sourceId,
    );
    const isCreate = !existing?.mycaseObjectId;

    // 7. Compose final matter payload
    this.logger.log(`Deal ${sourceId} mapped fields: ${JSON.stringify(mapped)}`);

    // Helper: include a field only if it has a mapped value OR is not locked to MyCase.
    // On initial creation, always copy the field regardless of source-of-truth setting —
    // the source-of-truth only applies to subsequent updates.
    const field = (name: string, mappedVal: unknown, fallback: unknown): unknown => {
      if (mappedVal != null) return mappedVal;
      if (!isCreate && lockedFields.has(name)) return undefined; // Update: MyCase owns this — skip
      return fallback ?? undefined;
    };

    const customFieldValues = extractCustomFieldValues(mapped);
    const rateRaw = field('rate', mapped['rate'], props.amount ? Math.round(parseFloat(props.amount as string) * 100) : undefined);
    const matterData: McMatterInput = {
      name: field('name', mapped['name'], props.dealname ?? 'Untitled Matter') as string,
      clients: [{ id: Number(mycaseClientId) }],
      status: (mycaseStatus ?? 'open').toLowerCase() as 'open' | 'closed',
      case_stage: field('case_stage', mapped['case_stage'], stageLabel) as string | undefined,
      practice_area: field('practice_area', mapped['practice_area'], undefined) as string | undefined,
      description: field('description', mapped['description'], undefined) as string | undefined,
      opened_date: field('opened_date', mapped['opened_date'], undefined) as string | undefined,
      rate: rateRaw != null ? Number(rateRaw) : undefined,
      custom_field_values: customFieldValues.length > 0 ? customFieldValues : undefined,
    };

    this.logger.log(`Deal ${sourceId} matterData: ${JSON.stringify(matterData)}`);

    // 8. Change detection
    if (existing && this.syncRecords.isSamePayload(existing, matterData as any)) {
      return this.skip('Payload unchanged since last sync');
    }

    // 9. Duplicate detection (create path only)
    let mycaseId = existing?.mycaseObjectId;
    let action: 'created' | 'updated';

    if (!mycaseId) {
      const dupResult = await this.duplicateDetector.findExistingDeal(
        installationId,
        installation.hubspotPortalId,
        'hs_to_mc',
        { name: matterData.name, linkedClientMcId: mycaseClientId },
      );

      if (dupResult.existingId) {
        this.logger.log(
          `Linked deal ${sourceId} to existing MyCase matter ${dupResult.existingId} (${dupResult.confidence} match)`,
        );
        await this.syncRecords.upsert({
          installationId,
          objectType: 'deal',
          hubspotObjectId: sourceId,
          mycaseObjectId: dupResult.existingId,
          payload: matterData as any,
          direction: 'hs_to_mc',
        });
        return this.skip(`Linked to existing MyCase matter (${dupResult.confidence} match)`);
      }

      this.logger.log(`Creating MyCase matter — payload: ${JSON.stringify(matterData)}`);
      let created: McMatter;
      try {
        created = await this.mycase.createMatter(installationId, matterData);
      } catch (err: any) {
        const stripped = this.stripMyCaseInvalid(err, matterData as unknown as Record<string, unknown>, fieldMismatches, cfLabelMap);
        if (!stripped) throw err;
        created = await this.mycase.createMatter(installationId, stripped as unknown as McMatterInput);
      }
      mycaseId = String(created.id);
      action = 'created';
      this.logger.log(`Created MyCase matter ${mycaseId} from HubSpot deal ${sourceId}`);
    } else {
      // Strip custom_field_values from updates — MyCase PUT appends rather than
      // replaces them, causing duplicates on every sync run.
      const { custom_field_values: _cfv, ...updateData } = matterData;
      try {
        await this.mycase.updateMatter(installationId, mycaseId, updateData);
      } catch (err: any) {
        const stripped = this.stripMyCaseInvalid(err, updateData as unknown as Record<string, unknown>, fieldMismatches, cfLabelMap);
        if (!stripped) throw err;
        await this.mycase.updateMatter(installationId, mycaseId, stripped);
      }
      action = 'updated';
    }

    // 9. Upsert sync record + write back matter ID
    await this.syncRecords.upsert({
      installationId,
      objectType: 'deal',
      hubspotObjectId: sourceId,
      mycaseObjectId: mycaseId,
      payload: matterData as any,
      direction: 'hs_to_mc',
    });

    try {
      await this.hubspot.updateDeal(
        installation.hubspotPortalId,
        installationId,
        sourceId,
        { my_case_id: mycaseId },
      );
    } catch {
      this.logger.warn(`Could not write my_case_id back to deal ${sourceId}`);
    }

    return { success: true, action, destinationId: mycaseId, fieldMismatches };
  }

  /**
   * On a MyCase 422 with field-level errors, strips the invalid fields from
   * payload, records them as fieldMismatches, and returns the stripped payload.
   * Returns null if the error is not a recoverable 422.
   */
  private stripMyCaseInvalid(
    err: any,
    payload: Record<string, unknown>,
    mismatches: import('@mycase-hubspot/shared-types').FieldMismatch[],
    cfLabelMap: Map<string, string> = new Map(),
  ): Record<string, unknown> | null {
    if (err?.statusCode !== 422 || !err?.responseData?.errors) return null;
    const errors = err.responseData.errors;

    // Array format (JSON API): [{description, source: {pointer: "/field" or "/array/index/..."}}]
    if (Array.isArray(errors)) {
      if (errors.length === 0) return null;
      const stripped: Record<string, unknown> = JSON.parse(JSON.stringify(payload));
      const arrayRemovals = new Map<string, number[]>();
      const fieldLabels: string[] = [];

      for (const error of errors) {
        const pointer: string = error?.source?.pointer ?? '';
        const reason: string = error?.description ?? 'Invalid value';
        const parts = pointer.split('/').filter(Boolean);
        if (parts.length === 0) continue;

        if (parts.length === 1) {
          // Simple top-level field: /field_name
          const fieldName = parts[0];
          fieldLabels.push(fieldName);
          mismatches.push({ field: fieldName, droppedValue: payload[fieldName], reason });
          delete stripped[fieldName];
        } else {
          // Nested: /array_key/index/...
          const arrayKey = parts[0];
          const index = parseInt(parts[1], 10);
          if (isNaN(index)) {
            fieldLabels.push(arrayKey);
            mismatches.push({ field: arrayKey, droppedValue: payload[arrayKey], reason });
            delete stripped[arrayKey];
          } else {
            const arr = payload[arrayKey];
            let fieldLabel = `${arrayKey}[${index}]`;
            let droppedValue: unknown = Array.isArray(arr) ? (arr as any[])[index] : undefined;
            if (arrayKey === 'custom_field_values' && Array.isArray(arr)) {
              const cfEntry = (arr as any[])[index];
              const cfId = cfEntry?.custom_field?.id;
              if (cfId != null) {
                const cfKey = `custom_field:${cfId}`;
                const hsName = cfLabelMap.get(cfKey);
                fieldLabel = hsName ? `${hsName} (${cfKey})` : cfKey;
                droppedValue = cfEntry?.value;
              }
            }
            fieldLabels.push(fieldLabel);
            mismatches.push({ field: fieldLabel, droppedValue, reason });
            if (!arrayRemovals.has(arrayKey)) arrayRemovals.set(arrayKey, []);
            arrayRemovals.get(arrayKey)!.push(index);
          }
        }
      }

      // Remove array elements in reverse index order to avoid shifting
      for (const [arrayKey, indices] of arrayRemovals) {
        const arr = stripped[arrayKey];
        if (Array.isArray(arr)) {
          [...new Set(indices)].sort((a, b) => b - a).forEach((i) => (arr as any[]).splice(i, 1));
          if ((arr as any[]).length === 0) delete stripped[arrayKey];
        }
      }

      this.logger.warn(`MyCase 422 — stripping [${fieldLabels.join(', ')}] and retrying`);
      return stripped;
    }

    // Object format fallback: { field: ['message', ...] }
    const invalidFields = Object.keys(errors as Record<string, string[]>);
    if (invalidFields.length === 0) return null;
    this.logger.warn(`MyCase 422 — stripping [${invalidFields.join(', ')}] and retrying`);
    for (const f of invalidFields) {
      mismatches.push({
        field: f,
        droppedValue: payload[f],
        reason: (errors[f] as string[])?.[0] ?? 'Invalid value',
      });
    }
    const stripped = { ...payload };
    invalidFields.forEach((f) => delete stripped[f]);
    return stripped;
  }

  private async resolveLinkedClient(
    installationId: string,
    portalId: string,
    dealId: string,
  ): Promise<string | null> {
    const contactIds = await this.hubspot.getDealContactIds(
      portalId,
      installationId,
      dealId,
    );

    this.logger.log(`resolveLinkedClient: deal ${dealId} has ${contactIds.length} associated contact(s): [${contactIds.join(', ')}]`);

    for (const contactId of contactIds) {
      // 1. Check sync_records first (fast path)
      const record = await this.syncRecords.findByHubSpotId(
        installationId,
        'contact',
        contactId,
      );
      if (record) {
        this.logger.log(`resolveLinkedClient: found sync_record for contact ${contactId} → MyCase client ${record.mycaseObjectId}`);
        return record.mycaseObjectId;
      }

      // 2. No sync_record — contact may predate sync setup.
      //    Fetch the contact's email and search MyCase directly.
      this.logger.log(`resolveLinkedClient: no sync_record for contact ${contactId}, trying email fallback`);
      try {
        const contact = await this.hubspot.getContact(portalId, installationId, contactId);
        const email = contact.properties?.email as string | undefined;
        this.logger.log(`resolveLinkedClient: contact ${contactId} email = ${email ?? '(none)'}`);
        if (!email) continue;

        const mcClient = await this.mycase.searchClientByEmail(installationId, email);
        this.logger.log(`resolveLinkedClient: MyCase search for "${email}" → ${mcClient ? `found client ${mcClient.id}` : 'not found'}`);
        if (!mcClient) continue;

        // Auto-link: create sync_record so future syncs use the fast path
        const mycaseClientId = String(mcClient.id);
        await this.syncRecords.upsert({
          installationId,
          objectType: 'contact',
          hubspotObjectId: contactId,
          mycaseObjectId: mycaseClientId,
          payload: { email } as any,
          direction: 'hs_to_mc',
        });
        this.logger.log(
          `resolveLinkedClient: auto-linked contact ${contactId} → MyCase client ${mycaseClientId} via email`,
        );
        return mycaseClientId;
      } catch (err: any) {
        this.logger.warn(`resolveLinkedClient: email fallback failed for contact ${contactId}: ${err.message}`);
      }
    }

    this.logger.warn(`resolveLinkedClient: could not resolve a MyCase client for deal ${dealId}`);
    return null;
  }
}
