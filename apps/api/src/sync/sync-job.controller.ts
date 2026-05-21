import { Controller, Get, Post, Param, Query, Body } from '@nestjs/common';
import { SyncJobService } from './sync-job.service';
import { InitialSyncService } from './initial-sync.service';

@Controller('installations/:installationId/sync-jobs')
export class SyncJobController {
  constructor(
    private readonly service: SyncJobService,
    private readonly initialSync: InitialSyncService,
  ) {}

  @Get()
  async list(
    @Param('installationId') installationId: string,
    @Query('status') status?: string,
    @Query('objectType') objectType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('search') search?: string,
  ) {
    const [data, total] = await this.service.list(installationId, {
      status,
      objectType,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
      search: search || undefined,
    });
    return { data, total };
  }

  @Get('stats')
  stats(@Param('installationId') installationId: string) {
    return this.service.stats(installationId);
  }

  @Post('trigger')
  trigger(@Param('installationId') installationId: string) {
    return this.initialSync.triggerForInstallation(installationId);
  }

  @Post('force-record')
  async forceRecord(
    @Param('installationId') installationId: string,
    @Body()
    body: {
      objectType: 'contact' | 'deal';
      recordId: string;
      direction: 'hs_to_mc' | 'mc_to_hs';
      force?: boolean;
    },
  ) {
    await this.initialSync.triggerSingleRecord(
      installationId,
      body.objectType,
      body.recordId,
      body.direction,
      body.force ?? false,
    );
    return { queued: true };
  }
}
