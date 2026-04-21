import {
  Controller,
  Post,
  Body,
  Logger,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { HubSpotHmacGuard } from '../common/guards/hmac.guard';
import { HsWebhookEvent } from './dto/webhook-payload.dto';
import { InstallationService } from '../installation/installation.service';
import {
  QUEUE_HS_TO_MC,
  SYNC_JOB_OPTIONS,
} from '../queue/queue.constants';
import { SyncJobPayload } from '@mycase-hubspot/shared-types';

const EVENT_DEDUP_TTL = 86_400; // 24 hours (seconds)

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
    @InjectQueue(QUEUE_HS_TO_MC) private readonly queue: Queue<SyncJobPayload>,
    private readonly installationService: InstallationService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
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

      // Deduplication — HubSpot retries deliveries; skip already-seen eventIds
      const dedupKey = `hs:event:${event.eventId}`;
      const already = await this.redis.set(
        dedupKey,
        '1',
        'EX',
        EVENT_DEDUP_TTL,
        'NX',
      );
      if (!already) {
        this.logger.verbose(`Skipping duplicate HubSpot event ${event.eventId}`);
        continue;
      }

      // Find the installation for this portal
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

      await this.queue.add(`${objectType}-${event.objectId}`, payload, {
        ...SYNC_JOB_OPTIONS,
        delay: 500, // 500ms delay so HubSpot finishes writing before we fetch
        jobId: `hs.${event.portalId}.${objectType}.${event.objectId}.${event.occurredAt}`,
      });

      enqueued++;
      this.logger.debug(
        `Enqueued hs_to_mc ${objectType}/${event.objectId} for portal ${event.portalId}`,
      );
    }

    return { received: enqueued };
  }
}
