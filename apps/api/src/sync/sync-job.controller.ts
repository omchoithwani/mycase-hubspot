import { Controller, Get, Param, Query } from '@nestjs/common';
import { SyncJobService } from './sync-job.service';

@Controller('installations/:installationId/sync-jobs')
export class SyncJobController {
  constructor(private readonly service: SyncJobService) {}

  @Get()
  async list(
    @Param('installationId') installationId: string,
    @Query('status') status?: string,
    @Query('objectType') objectType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const [data, total] = await this.service.list(installationId, {
      status,
      objectType,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    return { data, total };
  }

  @Get('stats')
  stats(@Param('installationId') installationId: string) {
    return this.service.stats(installationId);
  }
}
