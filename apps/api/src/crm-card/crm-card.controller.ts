import {
  Controller,
  Get,
  Query,
  Headers,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { InstallationService } from '../installation/installation.service';
import { SyncRecordService } from '../sync/sync-record.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { InitialSyncService } from '../sync/initial-sync.service';
import { ErrorLogService } from '../error-log/error-log.service';

function mycaseWebBase(webBase: string | null): string {
  if (webBase) return webBase.replace(/\/$/, '');
  return 'https://app.mycase.com';
}

@Controller('crm-cards')
export class CrmCardController {
  private readonly logger = new Logger(CrmCardController.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly syncRecords: SyncRecordService,
    private readonly mycase: MyCaseClientService,
    private readonly hubspot: HubSpotClientService,
    private readonly config: ConfigService,
    private readonly initialSync: InitialSyncService,
    private readonly errorLogs: ErrorLogService,
  ) {}

  /**
   * HubSpot CRM card for Contact objects.
   * Register in HubSpot developer portal → CRM cards → target URL:
   *   {API_URL}/crm-cards/contact
   * propertiesToSend: email, firstname, lastname, my_case_id
   */
  @Get('contact')
  @HttpCode(200)
  async contactCard(
    @Query('portalId') portalId: string,
    @Query('associatedObjectId') contactId: string,
    @Query('my_case_id') myCaseId: string | undefined,
    @Headers('x-hubspot-signature') signature: string | undefined,
    @Query() allQuery: Record<string, string>,
  ) {
    this.verifySignature('GET', 'contact', allQuery, signature);

    let installation: Awaited<ReturnType<typeof this.findInstallation>>;
    let mycaseObjectId: string | undefined;
    try {
      installation = await this.findInstallation(portalId);
      if (!installation) return this.emptyCard('MyCase not connected for this portal');

      // 1. Query param (when HubSpot sends my_case_id via objectProperties)
      // 2. sync_records DB lookup
      // 3. HubSpot API direct lookup (fallback for records synced before sync_records were written)
      mycaseObjectId =
        (myCaseId || undefined) ||
        (await this.syncRecords.findByHubSpotId(installation.id, 'contact', contactId))
          ?.mycaseObjectId;

      if (!mycaseObjectId) {
        const contact = await this.hubspot.getContact(
          installation.hubspotPortalId,
          installation.id,
          contactId,
        );
        const hsId = contact.properties?.my_case_id as string | undefined;
        if (hsId) mycaseObjectId = hsId;
      }
    } catch (err: any) {
      this.logger.error(`CRM card contact lookup failed: ${err.message}`);
      return this.emptyCard('Sync service temporarily unavailable — try again shortly');
    }

    if (!mycaseObjectId) {
      return this.emptyCard('Not yet synced — trigger a sync from the contact record');
    }

    try {
      const client = await this.mycase.getClient(installation!.id, mycaseObjectId);
      const name =
        [client.first_name, client.last_name].filter(Boolean).join(' ') ||
        `Client #${client.id}`;
      const profileUrl = `${mycaseWebBase(installation!.mycaseWebBaseUrl)}/contacts/clients/${client.id}`;

      return {
        results: [
          {
            objectId: Number(client.id),
            title: name,
            link: profileUrl,
            properties: [
              ...(client.email
                ? [{ label: 'Email', dataType: 'EMAIL', value: client.email }]
                : []),
              ...(client.cell_phone_number
                ? [{ label: 'Phone', dataType: 'STRING', value: client.cell_phone_number }]
                : []),
              { label: 'MyCase ID', dataType: 'STRING', value: String(client.id) },
            ],
          },
        ],
      };
    } catch (err: any) {
      this.logger.warn(`CRM card contact ${contactId}: ${err.message}`);
      return this.emptyCard(`Could not load MyCase client #${mycaseObjectId}`);
    }
  }

  /**
   * HubSpot CRM card for Deal objects.
   * Register in HubSpot developer portal → CRM cards → target URL:
   *   {API_URL}/crm-cards/deal
   * propertiesToSend: dealname, my_case_id
   */
  @Get('deal')
  @HttpCode(200)
  async dealCard(
    @Query('portalId') portalId: string,
    @Query('associatedObjectId') dealId: string,
    @Query('my_case_id') myCaseId: string | undefined,
    @Headers('x-hubspot-signature') signature: string | undefined,
    @Query() allQuery: Record<string, string>,
  ) {
    this.verifySignature('GET', 'deal', allQuery, signature);

    let installation: Awaited<ReturnType<typeof this.findInstallation>>;
    let mycaseObjectId: string | undefined;
    try {
      installation = await this.findInstallation(portalId);
      if (!installation) return this.emptyCard('MyCase not connected for this portal');

      // 1. Query param (when HubSpot sends my_case_id via objectProperties)
      // 2. sync_records DB lookup
      // 3. HubSpot API direct lookup (fallback for records synced before sync_records were written)
      mycaseObjectId =
        (myCaseId || undefined) ||
        (await this.syncRecords.findByHubSpotId(installation.id, 'deal', dealId))
          ?.mycaseObjectId;

      if (!mycaseObjectId) {
        const deal = await this.hubspot.getDeal(
          installation.hubspotPortalId,
          installation.id,
          dealId,
          ['my_case_id'],
        );
        const hsId = deal.properties?.my_case_id as string | undefined;
        if (hsId) mycaseObjectId = hsId;
      }
    } catch (err: any) {
      this.logger.error(`CRM card deal lookup failed: ${err.message}`);
      return this.emptyCard('Sync service temporarily unavailable — try again shortly');
    }

    if (!mycaseObjectId) {
      return this.emptyCard('Not yet synced — trigger a sync from the deal record');
    }

    try {
      const [matter, mismatchLogs] = await Promise.all([
        this.mycase.getMatter(installation!.id, mycaseObjectId),
        this.errorLogs.findMismatchesBySourceId(installation!.id, dealId),
      ]);
      const caseUrl = `${mycaseWebBase(installation!.mycaseWebBaseUrl)}/court_cases/${matter.id}`;

      const fieldWarnings = mismatchLogs.map((log) => ({
        field: (log.rawResponse as any)?.field ?? log.errorMessage,
        droppedValue: (log.rawResponse as any)?.droppedValue,
        reason: (log.rawResponse as any)?.reason ?? log.errorMessage,
      }));

      return {
        results: [
          {
            objectId: Number(matter.id),
            title: matter.name,
            link: caseUrl,
            properties: [
              {
                label: 'Status',
                dataType: 'STATUS',
                value: matter.status === 'open' ? 'Open' : 'Closed',
                optionType: matter.status === 'open' ? 'SUCCESS' : 'DEFAULT',
              },
              ...(matter.practice_area
                ? [{ label: 'Practice Area', dataType: 'STRING', value: matter.practice_area }]
                : []),
              ...(matter.case_stage
                ? [{ label: 'Stage', dataType: 'STRING', value: matter.case_stage }]
                : []),
              { label: 'MyCase ID', dataType: 'STRING', value: String(matter.id) },
            ],
            fieldWarnings,
          },
        ],
      };
    } catch (err: any) {
      this.logger.warn(`CRM card deal ${dealId}: ${err.message}`);
      return this.emptyCard(`Could not load MyCase case #${mycaseObjectId}`);
    }
  }

  /**
   * Triggered by card buttons — enqueues a HubSpot→MyCase sync for the record.
   * GET /crm-cards/sync?portalId=&objectId=&objectType=contact|deal&force=true|false
   * hubspot.fetch() only supports GET, so sync is triggered via query params.
   */
  @Get('sync')
  @HttpCode(200)
  async syncRecord(
    @Query('portalId') portalId: string,
    @Query('objectId') objectId: string,
    @Query('objectType') objectType: 'contact' | 'deal',
    @Query('force') forceStr: string | undefined,
  ) {
    const force = forceStr === 'true';
    try {
      const installation = await this.findInstallation(portalId);
      if (!installation) return { queued: false, error: 'Installation not found' };
      await this.initialSync.triggerSingleRecord(
        installation.id,
        objectType,
        objectId,
        'hs_to_mc',
        force,
      );
      return { queued: true };
    } catch (err: any) {
      this.logger.error(`CRM card sync trigger failed: ${err.message}`);
      return { queued: false, error: 'Sync service temporarily unavailable — try again shortly' };
    }
  }

  private async findInstallation(portalId: string) {
    const all = await this.installationService.findAllActive();
    return all.find((i) => i.hubspotPortalId === portalId) ?? null;
  }

  private emptyCard(message: string) {
    return { results: [], allItemsLinkUrl: '', cardLabel: message };
  }

  /**
   * Verify X-HubSpot-Signature: SHA-256(appSecret + method + url + body), base64-encoded.
   * Logs a warning but does NOT reject — HubSpot omits the header on first load in some SDKs.
   */
  private verifySignature(
    method: string,
    endpoint: string,
    query: Record<string, string>,
    signature: string | undefined,
  ): void {
    const secret = this.config.get<string>('HUBSPOT_CLIENT_SECRET');
    if (!secret || !signature) return;

    const apiUrl = this.config.get<string>('API_URL') ?? '';
    const params = new URLSearchParams(query).toString();
    const fullUrl = `${apiUrl}/crm-cards/${endpoint}${params ? '?' + params : ''}`;
    const hash = createHash('sha256')
      .update(`${secret}${method}${fullUrl}`)
      .digest('base64');

    if (hash !== signature) {
      this.logger.warn(`CRM card signature mismatch for ${endpoint} — expected ${hash}`);
    }
  }
}
