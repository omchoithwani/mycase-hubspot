import {
  Controller,
  Post,
  Body,
  Query,
  Logger,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { InstallationService } from '../installation/installation.service';
import {
  QUEUE_MC_TO_HS,
  SYNC_JOB_OPTIONS,
} from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

interface MyCaseWebhookPayload {
  event: string;           // 'new_case' | 'updated_contact' | 'invoice_payment'
  object_type?: string;
  object_id?: string;
  contact_id?: string;
  case_id?: string;
  firm_id?: string;
}

@Controller('webhooks/mycase')
export class MyCaseWebhookController {
  private readonly logger = new Logger(MyCaseWebhookController.name);

  constructor(
    @InjectQueue(QUEUE_MC_TO_HS) private readonly queue: Queue<SyncJobPayload>,
    private readonly installationService: InstallationService,
    private readonly config: ConfigService,
  ) {}

  /**
   * MyCase webhook receiver.
   * MyCase passes a shared secret as a query param for verification.
   */
  @Post()
  @HttpCode(200)
  async receive(
    @Body() body: MyCaseWebhookPayload,
    @Query('secret') secret: string,
  ): Promise<{ ok: boolean }> {
    // Simple shared-secret verification (MyCase doesn't use HMAC)
    const expected = this.config.get<string>('MYCASE_WEBHOOK_SECRET');
    if (expected && secret !== expected) {
      throw new UnauthorizedException('Invalid MyCase webhook secret');
    }

    const { event, contact_id, case_id, firm_id } = body;

    // Find installation by MyCase firm ID
    // (firm_id must be stored on the installation — stored during MyCase OAuth)
    if (!firm_id) {
      this.logger.warn('MyCase webhook missing firm_id — cannot route to installation');
      return { ok: true };
    }

    const installations = await this.installationService.findAllActive();
    const installation = installations.find(
      (i) => i.mycaseBaseUrl?.includes(firm_id),
    );
    if (!installation) {
      return { ok: true };
    }

    if (event === 'updated_contact' && contact_id) {
      await this.enqueue(installation.id, 'contact', contact_id);
    } else if (event === 'new_case' && case_id) {
      await this.enqueue(installation.id, 'deal', case_id);
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

    this.logger.debug(`Enqueued mc_to_hs ${objectType}/${sourceId}`);
  }
}
