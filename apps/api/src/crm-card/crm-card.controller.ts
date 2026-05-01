import { Controller, Get, Query, Logger, HttpCode } from '@nestjs/common';
import { InstallationService } from '../installation/installation.service';
import { SyncRecordService } from '../sync/sync-record.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';

const MYCASE_WEB = 'https://app.mycase.com';

@Controller('crm-cards')
export class CrmCardController {
  private readonly logger = new Logger(CrmCardController.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly syncRecords: SyncRecordService,
    private readonly mycase: MyCaseClientService,
  ) {}

  /**
   * HubSpot CRM card for Contact objects.
   * Shows the linked MyCase client name + a direct link to their profile.
   *
   * Query params sent by HubSpot:
   *   portalId, associatedObjectId (contact HubSpot ID), userId, userEmail
   */
  @Get('contact')
  @HttpCode(200)
  async contactCard(
    @Query('portalId') portalId: string,
    @Query('associatedObjectId') contactId: string,
  ) {
    const installation = await this.findInstallation(portalId);
    if (!installation) return this.emptyCard('MyCase not connected for this portal');

    const record = await this.syncRecords.findByHubSpotId(
      installation.id,
      'contact',
      contactId,
    );

    if (!record?.mycaseObjectId) {
      return this.emptyCard('No linked MyCase client — sync the contact first');
    }

    try {
      const client = await this.mycase.getClient(installation.id, record.mycaseObjectId);
      const name = [client.first_name, client.last_name].filter(Boolean).join(' ') || `Client #${client.id}`;
      const profileUrl = `${MYCASE_WEB}/contacts/${client.id}`;

      return {
        results: [
          {
            objectId: String(client.id),
            title: name,
            link: profileUrl,
            properties: [
              ...(client.email ? [{ label: 'Email', dataType: 'EMAIL', value: client.email }] : []),
              ...(client.cell_phone_number ? [{ label: 'Phone', dataType: 'STRING', value: client.cell_phone_number }] : []),
              { label: 'MyCase ID', dataType: 'STRING', value: String(client.id) },
            ],
          },
        ],
        primaryAction: {
          type: 'ACTION_HOOK',
          label: 'Open in MyCase',
          uri: profileUrl,
        },
      };
    } catch (err: any) {
      this.logger.warn(`CRM card contact ${contactId}: ${err.message}`);
      return this.emptyCard(`Could not load MyCase client #${record.mycaseObjectId}`);
    }
  }

  /**
   * HubSpot CRM card for Deal objects.
   * Shows the linked MyCase case name + a direct link to the case.
   *
   * Query params sent by HubSpot:
   *   portalId, associatedObjectId (deal HubSpot ID), userId, userEmail
   */
  @Get('deal')
  @HttpCode(200)
  async dealCard(
    @Query('portalId') portalId: string,
    @Query('associatedObjectId') dealId: string,
  ) {
    const installation = await this.findInstallation(portalId);
    if (!installation) return this.emptyCard('MyCase not connected for this portal');

    const record = await this.syncRecords.findByHubSpotId(
      installation.id,
      'deal',
      dealId,
    );

    if (!record?.mycaseObjectId) {
      return this.emptyCard('No linked MyCase case — sync the deal first');
    }

    try {
      const matter = await this.mycase.getMatter(installation.id, record.mycaseObjectId);
      const caseUrl = `${MYCASE_WEB}/cases/${matter.id}`;

      return {
        results: [
          {
            objectId: String(matter.id),
            title: matter.name,
            link: caseUrl,
            properties: [
              { label: 'Status', dataType: 'STRING', value: matter.status ?? 'unknown' },
              ...(matter.practice_area ? [{ label: 'Practice Area', dataType: 'STRING', value: matter.practice_area }] : []),
              ...(matter.case_stage ? [{ label: 'Stage', dataType: 'STRING', value: matter.case_stage }] : []),
              { label: 'MyCase ID', dataType: 'STRING', value: String(matter.id) },
            ],
          },
        ],
        primaryAction: {
          type: 'ACTION_HOOK',
          label: 'Open in MyCase',
          uri: caseUrl,
        },
      };
    } catch (err: any) {
      this.logger.warn(`CRM card deal ${dealId}: ${err.message}`);
      return this.emptyCard(`Could not load MyCase case #${record.mycaseObjectId}`);
    }
  }

  private async findInstallation(portalId: string) {
    const all = await this.installationService.findAllActive();
    return all.find((i) => i.hubspotPortalId === portalId) ?? null;
  }

  private emptyCard(message: string) {
    return {
      results: [],
      settingsAction: {
        type: 'ACTION_HOOK',
        label: message,
        uri: '',
      },
    };
  }
}
