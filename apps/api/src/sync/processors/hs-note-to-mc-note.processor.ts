import { Injectable, Logger } from '@nestjs/common';
import { BaseProcessor } from './base.processor';
import { SyncJobPayload, SyncResult } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../../mycase/mycase-client.service';
import { SyncRecordService } from '../sync-record.service';
import { InstallationService } from '../../installation/installation.service';
import { McNoteInput } from '../../mycase/dto/note.dto';

/** Strips basic HTML tags from HubSpot note body */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

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

    const body = stripHtml(note.properties.hs_note_body ?? '');
    if (!body) {
      return this.skip('Note body is empty after stripping HTML');
    }

    // 2. Find which MyCase resource (client or matter) to attach to
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

    // 3. Build note payload
    const noteData: McNoteInput = {
      description: body,
      date: note.properties.hs_timestamp
        ? new Date(Number(note.properties.hs_timestamp)).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      client_id: clientId ?? undefined,
      matter_id: matterId ?? undefined,
    };

    // 4. Change detection (hash of body)
    const existing = await this.syncRecords.findByHubSpotId(
      installationId,
      'note',
      sourceId,
    );
    if (existing && this.syncRecords.isSamePayload(existing, noteData as any)) {
      return this.skip('Note body unchanged since last sync');
    }

    // 5. Create or update
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

    // 6. Upsert sync record
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
    _portalId: string,
    _noteId: string,
  ): Promise<{ clientId: string | null; matterId: string | null }> {
    // Phase 4 will query HubSpot associations API to find associated contacts/deals,
    // then look up the corresponding MyCase client/matter IDs from sync_records.
    return { clientId: null, matterId: null };
  }
}
