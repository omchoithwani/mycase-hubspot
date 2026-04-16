import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { StageMappingService } from './stage-mapping.service';
import { HubSpotPropertiesService } from '../hubspot/hubspot-properties.service';
import { InstallationService } from '../installation/installation.service';

@Controller('installations/:installationId/stage-mappings')
export class StageMappingController {
  constructor(
    private readonly stageMappingService: StageMappingService,
    private readonly propertiesService: HubSpotPropertiesService,
    private readonly installationService: InstallationService,
  ) {}

  @Get()
  list(@Param('installationId') installationId: string) {
    return this.stageMappingService.list(installationId);
  }

  @Put()
  upsert(
    @Param('installationId') installationId: string,
    @Body()
    rows: Array<{
      hubspotPipelineId: string;
      hubspotStageId: string;
      hubspotStageLabel?: string;
      mycaseStatus: string;
      direction?: string;
    }>,
  ) {
    return this.stageMappingService.upsert(installationId, rows);
  }

  /** Returns HubSpot pipelines + stages for the stage-mapping UI */
  @Get('pipelines')
  async pipelines(@Param('installationId') installationId: string) {
    const installation = await this.installationService.findByIdOrFail(installationId);
    return this.propertiesService.getPipelines(
      installation.hubspotPortalId,
      installationId,
    );
  }
}
