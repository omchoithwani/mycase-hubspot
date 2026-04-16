import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { FieldMappingService } from '../../field-mapping/field-mapping.service';
import { SyncCriteriaService } from '../../sync-criteria/sync-criteria.service';
import { HsNoteInput, HsNoteAssociation } from '../../hubspot/dto/note.dto';

const HS_NOTE_CHAR_LIMIT = 65_536;

@Injectable()
export class McNoteToHsNoteProcessor extends BaseProcessor {
  readonly objectType = 'note' as const;
  readonly direction = 'mc_to_hs' as const;

  private readonly logger = new Logger(McNoteToHsNoteProcessor.name);

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

    // 1. Fetch note from MyCase
    const note = await this.mycase.getNote(installationId, sourceId);

    const rawBody = note.description ?? '';
    if (!rawBody) {
      return this.skip('MyCase note description is empty');
    }

    // 2. Evaluate sync criteria
    const eligible = await this.syncCriteria.evaluate(
      installationId,
      'note',
      'mycase',
      note as unknown as Record<string, unknown>,
    );
    if (!eligible) return this.skip('Record does not meet sync criteria');

    // 3. Apply configured field mapping
    const mapped = await this.fieldMapping.applyMapping(
      installationId,
      'note',
      'mc_to_hs',
      note as unknown as Record<string, unknown>,
    );

    // 3. Resolve HubSpot associations (contact/deal)
    const associations = await this.resolveAssociations(installationId, note);

    // 4. Build HubSpot note payload (truncate to 65,536 chars)
    const noteData: HsNoteInput = {
      hs_note_body: ((mapped['hs_note_body'] as string) ?? rawBody).slice(0, HS_NOTE_CHAR_LIMIT),
      hs_timestamp:
        (mapped['hs_timestamp'] as string) ??
        (note.date ? String(new Date(note.date).getTime()) : String(Date.now())),
    };

    // 5. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'note',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, noteData as any)) {
      return this.skip('Note body unchanged since last sync');
    }

    // 6. Create or update in HubSpot
    let hubspotId = existing?.hubspotObjectId;
    let action: 'created' | 'updated';

    if (!hubspotId) {
      const created = await this.hubspot.createNote(
        installation.hubspotPortalId,
        installationId,
        noteData,
        associations,
      );
      hubspotId = created.id;
      action = 'created';
      this.logger.log(`Created HubSpot note ${hubspotId} from MyCase note ${sourceId}`);
    } else {
      await this.hubspot.updateNote(
        installation.hubspotPortalId,
        installationId,
        hubspotId,
        noteData,
      );
      action = 'updated';
    }

    // 7. Upsert sync record
    await this.syncRecords.upsert({
      installationId,
      objectType: 'note',
      hubspotObjectId: hubspotId,
      mycaseObjectId: sourceId,
      payload: noteData as any,
      direction: 'mc_to_hs',
    });

    return { success: true, action, destinationId: hubspotId };
  }

  private async resolveAssociations(
    installationId: string,
    note: { client_id?: string; matter_id?: string },
  ): Promise<HsNoteAssociation[]> {
    const associations: HsNoteAssociation[] = [];

    if (note.client_id) {
      const contactRecord = await this.syncRecords.findByMyCaseId(
        installationId,
        'contact',
        note.client_id,
      );
      if (contactRecord) {
        associations.push({
          to: { id: contactRecord.hubspotObjectId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
        });
      }
    }

    if (note.matter_id) {
      const dealRecord = await this.syncRecords.findByMyCaseId(
        installationId,
        'deal',
        note.matter_id,
      );
      if (dealRecord) {
        associations.push({
          to: { id: dealRecord.hubspotObjectId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 214 }],
        });
      }
    }

    return associations;
  }
}
