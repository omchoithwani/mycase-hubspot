import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { HubSpotOAuthService } from '../auth/hubspot-oauth.service';
import { InstallationService } from '../installation/installation.service';
import { HubSpotRateLimiterService } from './hubspot-rate-limiter.service';
import { HsContact, HsContactInput } from './dto/contact.dto';
import { HsDeal, HsDealInput, HsPipeline } from './dto/deal.dto';
import { HsNote, HsNoteInput, HsNoteAssociation } from './dto/note.dto';

const HS_BASE = 'https://api.hubapi.com';

@Injectable()
export class HubSpotClientService {
  private readonly logger = new Logger(HubSpotClientService.name);

  constructor(
    private readonly installationService: InstallationService,
    private readonly oauthService: HubSpotOAuthService,
    private readonly rateLimiter: HubSpotRateLimiterService,
  ) {}

  // ── Axios factory ────────────────────────────────────────────────────────────

  private async client(installationId: string): Promise<AxiosInstance> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    const token = await this.oauthService.getValidAccessToken(installation);

    return axios.create({
      baseURL: HS_BASE,
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });
  }

  /**
   * Execute a HubSpot API call with rate limiting + 429 retry.
   */
  private async call<T>(
    portalId: string,
    installationId: string,
    fn: (http: AxiosInstance) => Promise<T>,
  ): Promise<T> {
    await this.rateLimiter.acquire(portalId);
    const http = await this.client(installationId);

    try {
      return await fn(http);
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 429) {
        const retryAfter =
          Number(axiosErr.response.headers['retry-after'] ?? 10) * 1000;
        this.logger.warn(
          `HubSpot 429 for portal ${portalId} — retrying after ${retryAfter}ms`,
        );
        await new Promise((r) => setTimeout(r, retryAfter));
        // Re-acquire token and retry once
        await this.rateLimiter.acquire(portalId);
        const http2 = await this.client(installationId);
        return fn(http2);
      }
      if (axiosErr.response?.status === 404) {
        throw new NotFoundException(
          `HubSpot resource not found: ${axiosErr.config?.url}`,
        );
      }
      throw err;
    }
  }

  // ── Contacts ─────────────────────────────────────────────────────────────────

  async getContact(
    portalId: string,
    installationId: string,
    contactId: string,
  ): Promise<HsContact> {
    return this.call(portalId, installationId, (http) =>
      http
        .get(`/crm/v3/objects/contacts/${contactId}`, {
          params: { properties: 'email,firstname,lastname,phone,company,lifecyclestage,mycase_client_id' },
        })
        .then((r) => r.data),
    );
  }

  async createContact(
    portalId: string,
    installationId: string,
    properties: HsContactInput,
  ): Promise<HsContact> {
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/contacts', { properties })
        .then((r) => r.data),
    );
  }

  async updateContact(
    portalId: string,
    installationId: string,
    contactId: string,
    properties: HsContactInput,
  ): Promise<HsContact> {
    return this.call(portalId, installationId, (http) =>
      http
        .patch(`/crm/v3/objects/contacts/${contactId}`, { properties })
        .then((r) => r.data),
    );
  }

  async searchContacts(
    portalId: string,
    installationId: string,
    filterGroups: object[],
    properties: string[] = ['email', 'firstname', 'lastname', 'phone', 'mycase_client_id'],
  ): Promise<HsContact[]> {
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/contacts/search', {
          filterGroups,
          properties,
          limit: 10,
        })
        .then((r) => r.data.results ?? []),
    );
  }

  async batchGetContacts(
    portalId: string,
    installationId: string,
    ids: string[],
  ): Promise<HsContact[]> {
    if (ids.length === 0) return [];
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/contacts/batch/read', {
          inputs: ids.map((id) => ({ id })),
          properties: ['email', 'firstname', 'lastname', 'phone', 'mycase_client_id'],
        })
        .then((r) => r.data.results ?? []),
    );
  }

  // ── Deals ────────────────────────────────────────────────────────────────────

  async getDeal(
    portalId: string,
    installationId: string,
    dealId: string,
  ): Promise<HsDeal> {
    return this.call(portalId, installationId, (http) =>
      http
        .get(`/crm/v3/objects/deals/${dealId}`, {
          params: {
            properties: 'dealname,amount,closedate,dealstage,pipeline,mycase_matter_id',
          },
        })
        .then((r) => r.data),
    );
  }

  async createDeal(
    portalId: string,
    installationId: string,
    properties: HsDealInput,
  ): Promise<HsDeal> {
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/deals', { properties })
        .then((r) => r.data),
    );
  }

  async updateDeal(
    portalId: string,
    installationId: string,
    dealId: string,
    properties: HsDealInput,
  ): Promise<HsDeal> {
    return this.call(portalId, installationId, (http) =>
      http
        .patch(`/crm/v3/objects/deals/${dealId}`, { properties })
        .then((r) => r.data),
    );
  }

  async searchDeals(
    portalId: string,
    installationId: string,
    filterGroups: object[],
    properties: string[] = ['dealname', 'amount', 'dealstage', 'pipeline', 'mycase_matter_id'],
  ): Promise<HsDeal[]> {
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/deals/search', {
          filterGroups,
          properties,
          limit: 10,
        })
        .then((r) => r.data.results ?? []),
    );
  }

  // ── Notes (Engagements) ──────────────────────────────────────────────────────

  async getNote(
    portalId: string,
    installationId: string,
    noteId: string,
  ): Promise<HsNote> {
    return this.call(portalId, installationId, (http) =>
      http
        .get(`/crm/v3/objects/notes/${noteId}`, {
          params: { properties: 'hs_note_body,hs_timestamp,hubspot_owner_id' },
        })
        .then((r) => r.data),
    );
  }

  async createNote(
    portalId: string,
    installationId: string,
    properties: HsNoteInput,
    associations: HsNoteAssociation[] = [],
  ): Promise<HsNote> {
    return this.call(portalId, installationId, (http) =>
      http
        .post('/crm/v3/objects/notes', { properties, associations })
        .then((r) => r.data),
    );
  }

  async updateNote(
    portalId: string,
    installationId: string,
    noteId: string,
    properties: Partial<HsNoteInput>,
  ): Promise<HsNote> {
    return this.call(portalId, installationId, (http) =>
      http
        .patch(`/crm/v3/objects/notes/${noteId}`, { properties })
        .then((r) => r.data),
    );
  }

  // ── Deal → Contact associations ──────────────────────────────────────────────

  /** Returns HubSpot contact IDs associated with a deal (v4 associations API) */
  async getDealContactIds(
    portalId: string,
    installationId: string,
    dealId: string,
  ): Promise<string[]> {
    try {
      const result = await this.call(portalId, installationId, (http) =>
        http
          .get(`/crm/v4/objects/deals/${dealId}/associations/contacts`)
          .then((r) => r.data),
      );
      return (result as any).results?.map((r: any) => String(r.toObjectId)) ?? [];
    } catch {
      return [];
    }
  }

  async associateDealWithContact(
    portalId: string,
    installationId: string,
    dealId: string,
    contactId: string,
  ): Promise<void> {
    await this.call(portalId, installationId, (http) =>
      http.put(
        `/crm/v3/objects/deals/${dealId}/associations/contacts/${contactId}/deal_to_contact`,
      ),
    );
  }

  /** Returns HubSpot contact IDs associated with a note (v4 associations API) */
  async getNoteContactIds(
    portalId: string,
    installationId: string,
    noteId: string,
  ): Promise<string[]> {
    try {
      const result = await this.call(portalId, installationId, (http) =>
        http
          .get(`/crm/v4/objects/notes/${noteId}/associations/contacts`)
          .then((r) => r.data),
      );
      return (result as any).results?.map((r: any) => String(r.toObjectId)) ?? [];
    } catch {
      return [];
    }
  }

  /** Returns HubSpot deal IDs associated with a note (v4 associations API) */
  async getNoteDealIds(
    portalId: string,
    installationId: string,
    noteId: string,
  ): Promise<string[]> {
    try {
      const result = await this.call(portalId, installationId, (http) =>
        http
          .get(`/crm/v4/objects/notes/${noteId}/associations/deals`)
          .then((r) => r.data),
      );
      return (result as any).results?.map((r: any) => String(r.toObjectId)) ?? [];
    } catch {
      return [];
    }
  }

  // ── Associations ─────────────────────────────────────────────────────────────

  async associateNoteWithContact(
    portalId: string,
    installationId: string,
    noteId: string,
    contactId: string,
  ): Promise<void> {
    await this.call(portalId, installationId, (http) =>
      http.put(
        `/crm/v3/objects/notes/${noteId}/associations/contacts/${contactId}/note_to_contact`,
      ),
    );
  }

  async associateNoteWithDeal(
    portalId: string,
    installationId: string,
    noteId: string,
    dealId: string,
  ): Promise<void> {
    await this.call(portalId, installationId, (http) =>
      http.put(
        `/crm/v3/objects/notes/${noteId}/associations/deals/${dealId}/note_to_deal`,
      ),
    );
  }

  // ── Paginated list (for initial sync) ────────────────────────────────────────

  async listContactsPage(
    portalId: string,
    installationId: string,
    after?: string,
  ): Promise<{ results: HsContact[]; nextAfter?: string }> {
    return this.call(portalId, installationId, (http) =>
      http
        .get('/crm/v3/objects/contacts', {
          params: {
            limit: 100,
            after,
            properties: 'email,firstname,lastname,phone,company,lifecyclestage,mycase_client_id',
          },
        })
        .then((r) => ({
          results: r.data.results ?? [],
          nextAfter: r.data.paging?.next?.after as string | undefined,
        })),
    );
  }

  async listDealsPage(
    portalId: string,
    installationId: string,
    after?: string,
  ): Promise<{ results: HsDeal[]; nextAfter?: string }> {
    return this.call(portalId, installationId, (http) =>
      http
        .get('/crm/v3/objects/deals', {
          params: {
            limit: 100,
            after,
            properties: 'dealname,amount,closedate,dealstage,pipeline,mycase_matter_id',
          },
        })
        .then((r) => ({
          results: r.data.results ?? [],
          nextAfter: r.data.paging?.next?.after as string | undefined,
        })),
    );
  }

  // ── Pipelines ────────────────────────────────────────────────────────────────

  async getPipelines(
    portalId: string,
    installationId: string,
  ): Promise<HsPipeline[]> {
    return this.call(portalId, installationId, (http) =>
      http
        .get('/crm/v3/pipelines/deals')
        .then((r) => r.data.results ?? []),
    );
  }
}
