import {
  Controller,
  Post,
  Body,
  Param,
  Logger,
  HttpCode,
} from '@nestjs/common';
import { InstallationService } from '../installation/installation.service';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_MC_TO_HS, SYNC_JOB_OPTS } from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

@Controller('webhooks/mycase')
export class MyCaseWebhookController {
  private readonly logger = new Logger(MyCaseWebhookController.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly installationService: InstallationService,
  ) {}

  /**
   * MyCase webhook receiver — one endpoint per installation.
   * Subscribed via POST /v1/webhooks/subscriptions with url =
   *   {API_URL}/webhooks/mycase/{installationId}
   */
  @Post(':installationId')
  @HttpCode(200)
  async receive(
    @Param('installationId') installationId: string,
    @Body() body: Record<string, any>,
  ): Promise<{ ok: boolean }> {
    this.logger.log(`MyCase webhook [${installationId.slice(0, 8)}]: ${JSON.stringify(body)}`);

    const model: string | undefined = body.model ?? body.object_type;
    const action: string | undefined = body.action ?? body.event;
    const id: string | number | undefined =
      body.id ?? body.case_id ?? body.contact_id ?? body.object_id;

    if (!id) {
      this.logger.warn(`MyCase webhook: no id in payload — ${JSON.stringify(body)}`);
      return { ok: true };
    }

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

    await this.pgBoss.send(QUEUE_MC_TO_HS, payload as object, {
      ...SYNC_JOB_OPTS,
      singletonKey: `mc:${installationId}:${objectType}:${sourceId}:${Date.now()}`,
    });

    this.logger.log(`Enqueued mc_to_hs ${objectType}/${sourceId} via webhook`);
  }
}
