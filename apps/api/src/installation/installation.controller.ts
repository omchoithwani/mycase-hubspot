import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { InstallationService } from './installation.service';

@Controller('installations')
export class InstallationController {
  constructor(private readonly service: InstallationService) {}

  @Get(':id')
  async getOne(@Param('id') id: string) {
    const inst = await this.service.findByIdOrFail(id);
    return {
      id: inst.id,
      hubspotPortalId: inst.hubspotPortalId,
      mycaseConnected: inst.mycaseConnected,
      syncEnabled: inst.syncEnabled,
      createdAt: inst.createdAt,
    };
  }

  @Patch(':id/sync-enabled')
  async setSyncEnabled(
    @Param('id') id: string,
    @Body('enabled') enabled: boolean,
  ) {
    const inst = await this.service.setSyncEnabled(id, enabled);
    return { id: inst.id, syncEnabled: inst.syncEnabled };
  }
}
