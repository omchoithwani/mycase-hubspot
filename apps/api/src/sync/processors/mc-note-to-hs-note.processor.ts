import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
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
  ) {
    super();
  }

  async process(payload: SyncJobPayload): Promise<SyncResult> {
    const { installationId, sourceId } = payload;
    const installation = await this.installationService.findByIdOrFail(installationId);

    // 1. Fetch note from MyCase
    const note = await this.mycase.getNote(installationId, sourceId);

    const body = note.description ?? '';
    if (!body) {
      return this.skip('MyCase note description is empty');
    }

    // 2. Resolve HubSpot associations (contact/deal)
    const associations = await this.resolveAssociations(installationId, note);

    // 3. Build HubSpot note payload (truncate to 65,536 chars)
    const noteData: HsNoteInput = {
      hs_note_body: body.slice(0, HS_NOTE_CHAR_LIMIT),
      hs_timestamp: note.date
        ? String(new Date(note.date).getTime())
        : String(Date.now()),
    };

    // 4. Change detection
    const existing = await this.syncRecords.findByMyCaseId(
      installationId,
      'note',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, noteData as any)) {
      return this.skip('Note body unchanged since last sync');
    }

    // 5. Create or update in HubSpot
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

    // 6. Upsert sync record
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
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 202, // note_to_contact
            },
          ],
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
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: 214, // note_to_deal
            },
          ],
        });
      }
    }

    return associations;
  }
}
