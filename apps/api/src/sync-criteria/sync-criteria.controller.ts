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
} from '@nestjs/common';
import { SyncCriteriaService, SourceSystem } from './sync-criteria.service';

@Controller('installations/:installationId/sync-criteria')
export class SyncCriteriaController {
  constructor(private readonly service: SyncCriteriaService) {}

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
      logicOperator?: 'AND' | 'OR';
      conditions: Array<{ field: string; operator: string; value?: unknown }>;
    },
  ) {
    return this.service.create(installationId, body);
  }

  @Patch(':ruleId')
  update(
    @Param('installationId') installationId: string,
    @Param('ruleId') ruleId: string,
    @Body()
    body: Partial<{
      ruleName: string;
      logicOperator: 'AND' | 'OR';
      conditions: Array<{ field: string; operator: string; value?: unknown }>;
      isActive: boolean;
    }>,
  ) {
    return this.service.update(ruleId, installationId, body);
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
}
