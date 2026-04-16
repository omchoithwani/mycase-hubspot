import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ErrorLogService } from './error-log.service';

@Controller('installations/:installationId/error-logs')
export class ErrorLogController {
  constructor(private readonly service: ErrorLogService) {}

  @Get()
  async list(
    @Param('installationId') installationId: string,
    @Query('resolved') resolved?: string,
    @Query('objectType') objectType?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const resolvedBool =
      resolved === 'true' ? true : resolved === 'false' ? false : undefined;
    const [data, total] = await this.service.list(installationId, {
      resolved: resolvedBool,
      objectType,
      limit: limit ? Number(limit) : 50,
      offset: offset ? Number(offset) : 0,
    });
    return { data, total };
  }

  @Patch(':logId/resolve')
  @HttpCode(HttpStatus.NO_CONTENT)
  resolve(
    @Param('installationId') installationId: string,
    @Param('logId') logId: string,
  ) {
    return this.service.resolve(logId, installationId);
  }

  @Post(':logId/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  retry(
    @Param('installationId') installationId: string,
    @Param('logId') logId: string,
  ) {
    return this.service.retry(logId, installationId);
  }
}
