import { Injectable, Logger } from '@nestjs/common';
import { SyncDirection } from '@mycase-hubspot/shared-types';
import { HubSpotClientService } from '../hubspot/hubspot-client.service';
import { MyCaseClientService } from '../mycase/mycase-client.service';

export interface DuplicateCheckResult {
  existingId: string | null;
  ambiguous: boolean;
  confidence?: 'exact' | 'fuzzy';
  score?: number;
}

// ── Jaro-Winkler implementation ───────────────────────────────────────────────

function jaro(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const l1 = s1.length, l2 = s2.length;
  if (l1 === 0 || l2 === 0) return 0;
  const dist = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Array(l1).fill(false);
  const m2 = new Array(l2).fill(false);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const lo = Math.max(0, i - dist), hi = Math.min(i + dist + 1, l2);
    for (let j = lo; j < hi; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = m2[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0, transpositions = 0;
  for (let i = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  return (matches / l1 + matches / l2 + (matches - transpositions / 2) / matches) / 3;
}

function jaroWinkler(a: string, b: string): number {
  const j = jaro(a, b);
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(a.length, b.length)); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return j + prefix * 0.1 * (1 - j);
}

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function last7Digits(phone?: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-7) : null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class DuplicateDetectorService {
  private readonly logger = new Logger(DuplicateDetectorService.name);

  constructor(
    private readonly hubspot: HubSpotClientService,
    private readonly mycase: MyCaseClientService,
  ) {}

  async findExistingContact(
    installationId: string,
    portalId: string,
    direction: SyncDirection,
    opts: { email?: string; firstName?: string; lastName?: string; phone?: string },
  ): Promise<DuplicateCheckResult> {
    const none: DuplicateCheckResult = { existingId: null, ambiguous: false };

    if (direction === 'hs_to_mc') {
      // Creating MyCase client — check MyCase first
      if (opts.email) {
        const found = await this.mycase.searchClientByEmail(installationId, opts.email);
        if (found) {
          return { existingId: found.id, ambiguous: false, confidence: 'exact', score: 1.0 };
        }
      }
      // No fuzzy fallback for MyCase (limited search API)
      return none;
    }

    // mc_to_hs — creating HubSpot contact, check HubSpot
    if (opts.email) {
      const contacts = await this.hubspot.searchContacts(
        portalId,
        installationId,
        [{ filters: [{ propertyName: 'email', operator: 'EQ', value: opts.email }] }],
      );
      if (contacts.length > 0) {
        return {
          existingId: contacts[0].id,
          ambiguous: false,
          confidence: 'exact',
          score: 1.0,
        };
      }
    }

    // Fuzzy: search by last name, then Jaro-Winkler + phone last-7
    if (opts.lastName) {
      try {
        const candidates = await this.hubspot.searchContacts(
          portalId,
          installationId,
          [{ filters: [{ propertyName: 'lastname', operator: 'CONTAINS_TOKEN', value: opts.lastName }] }],
        );
        const fullName = normName(`${opts.firstName ?? ''} ${opts.lastName}`);
        const srcPhone = last7Digits(opts.phone);

        for (const c of candidates) {
          const cName = normName(`${c.properties.firstname ?? ''} ${c.properties.lastname ?? ''}`);
          const score = jaroWinkler(fullName, cName);
          const cPhone = last7Digits(c.properties.phone);

          if (score >= 0.90 && (!srcPhone || !cPhone || srcPhone === cPhone)) {
            return { existingId: c.id, ambiguous: false, confidence: 'fuzzy', score };
          }
          if (score >= 0.80 && score < 0.90) {
            this.logger.warn(
              `DUPLICATE_AMBIGUOUS: contact "${fullName}" ↔ "${cName}" score=${score.toFixed(3)}`,
            );
            return { existingId: null, ambiguous: true, score };
          }
        }
      } catch {
        // fuzzy check is best-effort
      }
    }

    return none;
  }

  async findExistingDeal(
    installationId: string,
    portalId: string,
    direction: SyncDirection,
    opts: { name: string; linkedClientMcId?: string; linkedContactHsId?: string },
  ): Promise<DuplicateCheckResult> {
    const none: DuplicateCheckResult = { existingId: null, ambiguous: false };

    if (direction === 'hs_to_mc') {
      // Creating MyCase matter — check matters for the linked client
      if (!opts.linkedClientMcId) return none;
      try {
        const matters = await this.mycase.listMattersByClient(
          installationId,
          opts.linkedClientMcId,
        );
        const srcName = normName(opts.name);
        for (const m of matters) {
          const score = jaroWinkler(srcName, normName(m.name));
          if (score >= 0.92) {
            return { existingId: m.id, ambiguous: false, confidence: 'fuzzy', score };
          }
        }
      } catch {
        // best-effort
      }
      return none;
    }

    // mc_to_hs — creating HubSpot deal, check HubSpot
    try {
      const deals = await this.hubspot.searchDeals(
        portalId,
        installationId,
        [{ filters: [{ propertyName: 'dealname', operator: 'EQ', value: opts.name }] }],
      );
      if (deals.length > 0) {
        return {
          existingId: deals[0].id,
          ambiguous: false,
          confidence: 'exact',
          score: 1.0,
        };
      }

      // Fuzzy: CONTAINS_TOKEN on deal name
      const candidates = await this.hubspot.searchDeals(
        portalId,
        installationId,
        [{ filters: [{ propertyName: 'dealname', operator: 'CONTAINS_TOKEN', value: opts.name.split(' ')[0] }] }],
      );
      const srcName = normName(opts.name);
      for (const d of candidates) {
        const score = jaroWinkler(srcName, normName(d.properties.dealname ?? ''));
        if (score >= 0.92) {
          return { existingId: d.id, ambiguous: false, confidence: 'fuzzy', score };
        }
      }
    } catch {
      // best-effort
    }

    return none;
  }
}
