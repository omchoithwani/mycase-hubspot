import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
import { McNoteInput } from '../../mycase/dto/note.dto';

@Injectable()
export class HsNoteToMcNoteProcessor extends BaseProcessor {
  readonly objectType = 'note' as const;
  readonly direction = 'hs_to_mc' as const;

  private readonly logger = new Logger(HsNoteToMcNoteProcessor.name);

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

    // 1. Fetch note from HubSpot
    const note = await this.hubspot.getNote(
      installation.hubspotPortalId,
      installationId,
      sourceId,
    );

    // 2. Evaluate sync criteria
    const eligible = await this.syncCriteria.evaluate(
      installationId,
      'note',
      'hubspot',
      note.properties as Record<string, unknown>,
    );
    if (!eligible) return this.skip('Record does not meet sync criteria');

    // 3. Apply configured field mapping (html_strip transform applied to description)
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'note',
      'hs_to_mc',
      note.properties as Record<string, unknown>,
    );

    const body = (mapped['description'] as string) ?? '';
    if (!body) {
      return this.skip('Note body is empty after applying field mapping');
    }

    // 3. Find which MyCase resource (client or matter) to attach to
    const { clientId, matterId } = await this.resolveAssociations(
      installationId,
      installation.hubspotPortalId,
      sourceId,
    );

    if (!clientId && !matterId) {
      return this.skip(
        'No synced MyCase client or matter found for this note — sync the parent record first',
      );
    }

    // 4. Build note payload
    const noteData: McNoteInput = {
      description: body,
      date: note.properties.hs_timestamp
        ? new Date(Number(note.properties.hs_timestamp)).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      client_id: clientId ?? undefined,
      matter_id: matterId ?? undefined,
    };

    // 5. Change detection
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'note',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, noteData as any)) {
      return this.skip('Note body unchanged since last sync');
    }

    // 6. Create or update
    let mycaseId = existing?.mycaseObjectId;
    let action: 'created' | 'updated';

    if (!mycaseId) {
      const created = await this.mycase.createNote(installationId, noteData);
      mycaseId = created.id;
      action = 'created';
      this.logger.log(`Created MyCase note ${mycaseId} from HubSpot note ${sourceId}`);
    } else {
      await this.mycase.updateNote(installationId, mycaseId, noteData);
      action = 'updated';
    }

    // 7. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'note',
      hubspotObjectId: sourceId,
      mycaseObjectId: mycaseId,
      payload: noteData as any,
      direction: 'hs_to_mc',
    });

    return { success: true, action, destinationId: mycaseId };
  }

  private async resolveAssociations(
    installationId: string,
    portalId: string,
    noteId: string,
  ): Promise<{ clientId: string | null; matterId: string | null }> {
    let clientId: string | null = null;
    let matterId: string | null = null;

    const contactIds = await this.hubspot.getNoteContactIds(portalId, installationId, noteId);
    for (const contactId of contactIds) {
      const record = await this.syncRecords.findByHubSpotId(installationId, 'contact', contactId);
      if (record) { clientId = record.mycaseObjectId; break; }
    }

    const dealIds = await this.hubspot.getNoteDealIds(portalId, installationId, noteId);
    for (const dealId of dealIds) {
      const record = await this.syncRecords.findByHubSpotId(installationId, 'deal', dealId);
      if (record) { matterId = record.mycaseObjectId; break; }
    }

    return { clientId, matterId };
  }
}
