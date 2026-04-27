import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SyncCriteriaService, SourceSystem } from './sync-criteria.service';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { HubSpotPropertiesService } from '../hubspot/hubspot-properties.service';
import { InstallationService } from '../installation/installation.service';

@Controller('installations/:installationId/sync-criteria')
export class SyncCriteriaController {
  constructor(
    private readonly service: SyncCriteriaService,
    private readonly hubspot: HubSpotClientService,
    private readonly hsProperties: HubSpotPropertiesService,
    private readonly installations: InstallationService,
  ) {}

  @Get()
  list(
    @Param('installationId') installationId: string,
    @Query('objectType') objectType?: string,
    @Query('sourceSystem') sourceSystem?: SourceSystem,
  ) {
    return this.service.list(installationId, objectType, sourceSystem);
  }

  @Post()
  create(
    @Param('installationId') installationId: string,
    @Body()
    body: {
      objectType: string;
      sourceSystem: SourceSystem;
      ruleName?: string;
      filterGroups: Array<{ filters: Array<{ field: string; operator: string; value?: unknown }> }>;
    },
  ) {
    return this.service.create(installationId, body as any);
  }

  @Patch(':ruleId')
  update(
    @Param('installationId') installationId: string,
    @Param('ruleId') ruleId: string,
    @Body()
    body: Partial<{
      ruleName: string;
      filterGroups: Array<{ filters: Array<{ field: string; operator: string; value?: unknown }> }>;
      isActive: boolean;
    }>,
  ) {
    return this.service.update(ruleId, installationId, body as any);
  }

  @Delete(':ruleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('installationId') installationId: string,
    @Param('ruleId') ruleId: string,
  ) {
    return this.service.remove(ruleId, installationId);
  }

  @Post(':ruleId/test')
  testRule(
    @Param('installationId') installationId: string,
    @Param('ruleId') ruleId: string,
    @Body() body: { record: Record<string, unknown> },
  ) {
    return this.service.testRule(ruleId, installationId, body.record);
  }

  @Post('test-all')
  testAll(
    @Param('installationId') installationId: string,
    @Body() body: { objectType: string; sourceSystem: SourceSystem; record: Record<string, unknown> },
  ) {
    return this.service
      .evaluate(installationId, body.objectType, body.sourceSystem, body.record)
      .then((passed) => ({ passed }));
  }

  /**
   * Fetch a real HubSpot record by email or record ID, then evaluate it
   * against all active sync-criteria rules.
   *
   * POST /installations/:id/sync-criteria/test-live
   * Body: { objectType: 'contact'|'deal', email?: string, recordId?: string, sourceSystem?: string }
   */
  @Post('test-live')
  async testLive(
    @Param('installationId') installationId: string,
    @Body()
    body: {
      objectType: 'contact' | 'deal';
      email?: string;
      recordId?: string;
      sourceSystem?: SourceSystem;
    },
  ) {
    const { objectType, email, recordId, sourceSystem = 'hubspot' } = body;

    if (!email && !recordId) {
      throw new BadRequestException('Provide either email or recordId');
    }
    if (objectType !== 'contact' && objectType !== 'deal') {
      throw new BadRequestException('objectType must be contact or deal');
    }

    const installation = await this.installations.findByIdOrFail(installationId);
    const portalId = installation.hubspotPortalId;

    // Fetch all HubSpot property names so we get full data for evaluation
    const hsObjType = objectType === 'contact' ? 'contacts' : 'deals';
    const allProps = await this.hsProperties.fetchProperties(portalId, installationId, hsObjType);
    const propNames = allProps.map((p) => p.name);

    let properties: Record<string, unknown>;
    let foundId: string;

    if (objectType === 'contact') {
      let contact: { id: string; properties: Record<string, unknown> } | null = null;

      if (recordId) {
        try {
          const raw = await this.hubspot['call'](portalId, installationId, (http: any) =>
            http
              .get(`/crm/v3/objects/contacts/${recordId}`, {
                params: { properties: propNames.join(',') },
              })
              .then((r: any) => r.data),
          );
          contact = raw as any;
        } catch {
          throw new NotFoundException(`Contact ${recordId} not found`);
        }
      } else if (email) {
        const results = await this.hubspot.searchContacts(
          portalId,
          installationId,
          [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
          propNames,
        );
        if (!results.length) throw new NotFoundException(`No contact found with email ${email}`);
        contact = results[0] as any;
      }

      if (!contact) throw new NotFoundException('Contact not found');
      foundId = contact.id;
      properties = contact.properties as Record<string, unknown>;
    } else {
      // deal — must use recordId
      if (!recordId) throw new BadRequestException('recordId is required for deals');
      let deal: { id: string; properties: Record<string, unknown> } | null = null;
      try {
        deal = await this.hubspot['call'](portalId, installationId, (http: any) =>
          http
            .get(`/crm/v3/objects/deals/${recordId}`, {
              params: { properties: propNames.join(',') },
            })
            .then((r: any) => r.data),
        ) as any;
      } catch {
        throw new NotFoundException(`Deal ${recordId} not found`);
      }
      if (!deal) throw new NotFoundException('Deal not found');
      foundId = deal.id;
      properties = deal.properties as Record<string, unknown>;
    }

    const passed = await this.service.evaluate(
      installationId,
      objectType,
      sourceSystem,
      properties,
    );

    return { passed, recordId: foundId, properties };
  }
}
