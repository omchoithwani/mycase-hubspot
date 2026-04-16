import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
} from '@nestjs/common';
import { FieldMappingService } from './field-mapping.service';
import { ObjectType, SyncDirection } from '@mycase-hubspot/shared-types';
import { HubSpotPropertiesService } from '../hubspot/hubspot-properties.service';
import { InstallationService } from '../installation/installation.service';

@Controller('installations/:installationId/field-mappings')
export class FieldMappingController {
  constructor(
    private readonly fieldMappingService: FieldMappingService,
    private readonly propertiesService: HubSpotPropertiesService,
    private readonly installationService: InstallationService,
  ) {}

  @Get()
  list(
    @Param('installationId') installationId: string,
    @Query('objectType') objectType?: ObjectType,
  ) {
    return this.fieldMappingService.list(installationId, objectType);
  }

  @Post()
  create(
    @Param('installationId') installationId: string,
    @Body()
    body: {
      objectType: ObjectType;
      hubspotField: string;
      mycaseField: string;
      direction?: string;
      transformType?: string;
      transformConfig?: Record<string, unknown>;
      isRequired?: boolean;
    },
  ) {
    return this.fieldMappingService.create(installationId, body);
  }

  @Patch(':mappingId')
  update(
    @Param('installationId') installationId: string,
    @Param('mappingId') mappingId: string,
    @Body()
    body: {
      direction?: string;
      transformType?: string;
      transformConfig?: Record<string, unknown>;
      isRequired?: boolean;
    },
  ) {
    return this.fieldMappingService.update(installationId, mappingId, body);
  }

  @Delete(':mappingId')
  @HttpCode(204)
  remove(
    @Param('installationId') installationId: string,
    @Param('mappingId') mappingId: string,
  ) {
    return this.fieldMappingService.remove(installationId, mappingId);
  }

  @Post('seed-defaults')
  @HttpCode(204)
  seedDefaults(@Param('installationId') installationId: string) {
    return this.fieldMappingService.seedDefaults(installationId);
  }

  @Post('test')
  testTransform(
    @Param('installationId') _installationId: string,
    @Body()
    body: {
      value: unknown;
      transformType: string;
      transformConfig?: Record<string, unknown>;
      direction: SyncDirection;
    },
  ) {
    return {
      result: this.fieldMappingService.testTransform(
        body.value,
        body.transformType,
        body.transformConfig ?? null,
        body.direction,
      ),
    };
  }

  /** Returns HubSpot properties for the given objectType — used to populate
   *  the field-picker dropdown in the Admin UI. */
  @Get('hubspot-properties')
  async hubspotProperties(
    @Param('installationId') installationId: string,
    @Query('objectType') objectType: 'contacts' | 'deals' | 'notes' = 'contacts',
  ) {
    const installation = await this.installationService.findByIdOrFail(installationId);
    return this.propertiesService.fetchProperties(
      installation.hubspotPortalId,
      installationId,
      objectType,
    );
  }
}
