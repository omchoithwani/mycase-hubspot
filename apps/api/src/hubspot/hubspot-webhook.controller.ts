import {
  Controller,
  Post,
  Body,
  Logger,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { HubSpotHmacGuard } from '../common/guards/hmac.guard';
import { HsWebhookEvent } from './dto/webhook-payload.dto';
import { InstallationService } from '../installation/installation.service';
import { PgBossService } from '../queue/pg-boss.service';
import { QUEUE_HS_TO_MC, SYNC_JOB_OPTS } from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

type HsObjectType = 'contact' | 'deal' | 'note';

const SUBSCRIPTION_TYPE_MAP: Record<string, HsObjectType | null> = {
  'contact.creation': 'contact',
  'contact.propertyChange': 'contact',
  'deal.creation': 'deal',
  'deal.propertyChange': 'deal',
  'contact_note.creation': 'note',
  'contact_note.propertyChange': 'note',
};

@Controller('webhooks/hubspot')
@UseGuards(HubSpotHmacGuard)
export class HubSpotWebhookController {
  private readonly logger = new Logger(HubSpotWebhookController.name);

  constructor(
    private readonly pgBoss: PgBossService,
    private readonly installationService: InstallationService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(@Body() events: HsWebhookEvent[]): Promise<{ received: number }> {
    if (!Array.isArray(events) || events.length === 0) {
      return { received: 0 };
    }

    let enqueued = 0;

    for (const event of events) {
      const objectType = SUBSCRIPTION_TYPE_MAP[event.subscriptionType];
      if (!objectType) continue;

      const installation = await this.installationService.findByPortalId(
        String(event.portalId),
      );
      if (!installation || !installation.syncEnabled) continue;

      const payload: SyncJobPayload = {
        installationId: installation.id,
        direction: 'hs_to_mc',
        objectType,
        sourceId: String(event.objectId),
        sourceSystem: 'hubspot',
        triggeredBy: 'webhook',
        rawPayload: event as any,
      };

      // singletonKey deduplicates retried HubSpot webhook deliveries for the same event
      await this.pgBoss.send(QUEUE_HS_TO_MC, payload as object, {
        ...SYNC_JOB_OPTS,
        startAfter: 0.5, // 0.5s so HubSpot finishes writing before we fetch
        singletonKey: `hs.${event.portalId}.${objectType}.${event.objectId}.${event.occurredAt}`,
      });

      enqueued++;
      this.logger.debug(
        `Enqueued hs_to_mc ${objectType}/${event.objectId} for portal ${event.portalId}`,
      );
    }

    return { received: enqueued };
  }
}
