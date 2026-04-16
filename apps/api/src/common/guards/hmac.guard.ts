import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';

/**
 * Verifies HubSpot webhook signature v3.
 *
 * HubSpot computes:
 *   HMAC-SHA256( clientSecret, method + fullUrl + rawBody + timestamp )
 * then base64-encodes the result and puts it in X-HubSpot-Signature-v3.
 *
 * Reference: https://developers.hubspot.com/docs/api/webhooks#security
 */
@Injectable()
export class HubSpotHmacGuard implements CanActivate {
  private readonly logger = new Logger(HubSpotHmacGuard.name);

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req: Request = context.switchToHttp().getRequest();

    const signature = req.headers['x-hubspot-signature-v3'] as string;
    const timestamp = req.headers['x-hubspot-request-timestamp'] as string;
    const rawBody = (req as any).rawBody as Buffer | undefined;

    if (!signature || !timestamp) {
      throw new UnauthorizedException('Missing HubSpot signature headers');
    }

    // Reject requests older than 5 minutes (replay attack protection)
    const requestTime = Number(timestamp);
    if (Date.now() - requestTime > 5 * 60 * 1000) {
      throw new UnauthorizedException('HubSpot webhook timestamp too old');
    }

    if (!rawBody) {
      throw new UnauthorizedException('Raw body not available for HMAC verification');
    }

    const clientSecret = this.config.getOrThrow<string>('HUBSPOT_CLIENT_SECRET');
    const method = req.method.toUpperCase();
    const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;

    const payload = `${method}${url}${rawBody.toString('utf8')}${timestamp}`;
    const expected = createHmac('sha256', clientSecret)
      .update(payload)
      .digest('base64');

    try {
      if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) {
        throw new UnauthorizedException('Invalid HubSpot webhook signature');
      }
    } catch {
      throw new UnauthorizedException('Invalid HubSpot webhook signature');
    }

    return true;
  }
}
