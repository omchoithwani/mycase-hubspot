import {
  Controller,
  Post,
  Body,
  Param,
  Logger,
  HttpCode,
  Headers,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Request } from 'express';
import { InstallationService } from '../installation/installation.service';
import {
  QUEUE_MC_TO_HS,
  SYNC_JOB_OPTIONS,
} from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

@Controller('webhooks/mycase')
export class MyCaseWebhookController {
  private readonly logger = new Logger(MyCaseWebhookController.name);

  constructor(
    @InjectQueue(QUEUE_MC_TO_HS) private readonly queue: Queue<SyncJobPayload>,
    private readonly installationService: InstallationService,
  ) {}

  /**
   * MyCase webhook receiver — one endpoint per installation so we always
   * know which installation a webhook belongs to without querying by firm_id.
   *
   * Subscribed via POST /v1/webhooks/subscriptions with url =
   *   {API_URL}/webhooks/mycase/{installationId}
   *
   * Payload format (MyCase external integrations API):
   *   { model: 'case' | 'client', action: 'created' | 'updated' | 'deleted', id: number, ... }
   */
  @Post(':installationId')
  @HttpCode(200)
  async receive(
    @Param('installationId') installationId: string,
    @Body() body: Record<string, any>,
  ): Promise<{ ok: boolean }> {
    // Log raw payload on first receipt so we can verify the format
    this.logger.log(`MyCase webhook [${installationId.slice(0, 8)}]: ${JSON.stringify(body)}`);

    const model: string | undefined = body.model ?? body.object_type;
    const action: string | undefined = body.action ?? body.event;
    const id: string | number | undefined =
      body.id ?? body.case_id ?? body.contact_id ?? body.object_id;

    if (!id) {
      this.logger.warn(`MyCase webhook: no id in payload — ${JSON.stringify(body)}`);
      return { ok: true };
    }

    // Verify installation exists and is active
    try {
      await this.installationService.findByIdOrFail(installationId);
    } catch {
      this.logger.warn(`MyCase webhook: unknown installationId ${installationId}`);
      return { ok: true };
    }

    const sourceId = String(id);

    if (model === 'case' || model === 'deal' || body.case_id) {
      if (action !== 'deleted') {
        await this.enqueue(installationId, 'deal', sourceId);
      }
    } else if (model === 'client' || model === 'contact' || body.contact_id) {
      if (action !== 'deleted') {
        await this.enqueue(installationId, 'contact', sourceId);
      }
    } else {
      this.logger.warn(`MyCase webhook: unrecognised model="${model}" action="${action}" — skipping`);
    }

    return { ok: true };
  }

  private async enqueue(
    installationId: string,
    objectType: 'contact' | 'deal' | 'note',
    sourceId: string,
  ): Promise<void> {
    const payload: SyncJobPayload = {
      installationId,
      direction: 'mc_to_hs',
      objectType,
      sourceId,
      sourceSystem: 'mycase',
      triggeredBy: 'webhook',
    };

    await this.queue.add(`${objectType}-${sourceId}`, payload, {
      ...SYNC_JOB_OPTIONS,
      jobId: `mc:${installationId}:${objectType}:${sourceId}:${Date.now()}`,
    });

    this.logger.log(`Enqueued mc_to_hs ${objectType}/${sourceId} via webhook`);
  }
}
