import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import axiosRetry from 'axios-retry';
import { MyCaseOAuthService } from '../auth/mycase-oauth.service';
import { InstallationService } from '../installation/installation.service';
import { McClient, McClientInput } from './dto/client.dto';
import { McMatter, McMatterInput } from './dto/matter.dto';
import { McNote, McNoteInput } from './dto/note.dto';

const MYCASE_BASE = 'https://external-integrations.mycase.com/v1';

const REQUEST_INTERVAL_MS = 1_000;

/** Parse cursor token from MyCase Link header: <url?page_token=TOKEN>; rel="next" */
function parseNextPageToken(linkHeader?: string): string | undefined {
  if (!linkHeader) return undefined;
  const match = linkHeader.match(/<[^>]*[?&]page_token=([^&>]+)[^>]*>;\s*rel="next"/);
  return match ? decodeURIComponent(match[1]) : undefined;
}

export interface McWebhookSubscription {
  id: string;
  model: string;
  url: string;
  actions: string[];
  hmac_key: string;
}

@Injectable()
export class MyCaseClientService {
  private readonly logger = new Logger(MyCaseClientService.name);

  // Per-installation: timestamp of the last request sent
  private readonly lastRequestAt = new Map<string, number>();

  constructor(
    private readonly installationService: InstallationService,
    private readonly oauthService: MyCaseOAuthService,
  ) {}

  // ── HTTP factory ─────────────────────────────────────────────────────────────

  private async buildClientForBase(installationId: string, baseURL: string): Promise<AxiosInstance> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    const token = await this.oauthService.getValidAccessToken(installation);

    const instance = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 8_000,
    });

    axiosRetry(instance, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error: AxiosError) =>
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        (error.response?.status ?? 0) >= 500,
    });

    instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (error.response?.status === 401 && !(error.config as any)._retried) {
          (error.config as any)._retried = true;
          const fresh = await this.installationService.findByIdOrFail(installationId);
          const newToken = await this.oauthService.getValidAccessToken(fresh);
          (error.config as InternalAxiosRequestConfig).headers['Authorization'] = `Bearer ${newToken}`;
          return instance.request(error.config!);
        }
        return Promise.reject(error);
      },
    );

    return instance;
  }

  // Data API — always external-integrations.mycase.com/v1
  // Bearer token identifies the firm; no firm UUID prefix needed in the URL.
  private async buildClient(installationId: string): Promise<AxiosInstance> {
    this.logger.debug(`[${installationId.slice(0, 8)}] data API base: ${MYCASE_BASE}`);
    return this.buildClientForBase(installationId, MYCASE_BASE);
  }

  // Management API — always external-integrations.mycase.com/v1 (webhooks, /firm)
  private async buildCentralClient(installationId: string): Promise<AxiosInstance> {
    return this.buildClientForBase(installationId, MYCASE_BASE);
  }

  private async throttle(installationId: string): Promise<void> {
    const last = this.lastRequestAt.get(installationId) ?? 0;
    const wait = REQUEST_INTERVAL_MS - (Date.now() - last);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    this.lastRequestAt.set(installationId, Date.now());
  }

  private async call<T>(
    installationId: string,
    fn: (http: AxiosInstance) => Promise<T>,
  ): Promise<T> {
    await this.throttle(installationId);
    const http = await this.buildClient(installationId);

    try {
      return await fn(http);
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) {
        this.logger.error(
          `MyCase 404 — URL: ${axiosErr.config?.baseURL}${axiosErr.config?.url} — body: ${JSON.stringify(axiosErr.response?.data)}`,
        );
        throw new NotFoundException(
          `MyCase resource not found: ${axiosErr.config?.baseURL}${axiosErr.config?.url}`,
        );
      }
      if (axiosErr.response?.status === 401) {
        const body401 = axiosErr.response?.data;
        this.logger.error(
          `MyCase 401 — URL: ${axiosErr.config?.baseURL}${axiosErr.config?.url} — body: ${JSON.stringify(body401)}`,
        );
        throw new UnauthorizedException('MyCase authentication failed');
      }
      // For any other HTTP error, embed the response body so it reaches error_logs
      if (axiosErr.response?.data) {
        const status = axiosErr.response.status;
        const body = axiosErr.response.data;
        const detail = typeof body === 'string' ? body : JSON.stringify(body);
        this.logger.error(
          `MyCase ${status} — ${axiosErr.config?.baseURL}${axiosErr.config?.url} — ${detail}`,
        );
        const enriched: any = new Error(
          `MyCase ${status}: ${axiosErr.config?.method?.toUpperCase()} ${axiosErr.config?.url} — ${detail}`,
        );
        enriched.statusCode = status;
        enriched.responseData = body;
        throw enriched;
      }
      throw err;
    }
  }

  private async callCentral<T>(
    installationId: string,
    fn: (http: AxiosInstance) => Promise<T>,
  ): Promise<T> {
    await this.throttle(installationId);
    const http = await this.buildCentralClient(installationId);
    try {
      return await fn(http);
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 404) {
        throw new NotFoundException(
          `MyCase resource not found: ${axiosErr.config?.baseURL}${axiosErr.config?.url}`,
        );
      }
      if (axiosErr.response?.status === 401) {
        throw new UnauthorizedException('MyCase authentication failed');
      }
      if (axiosErr.response?.data) {
        const status = axiosErr.response.status;
        const body = axiosErr.response.data;
        const detail = typeof body === 'string' ? body : JSON.stringify(body);
        this.logger.error(`MyCase ${status} — ${axiosErr.config?.baseURL}${axiosErr.config?.url} — ${detail}`);
        const enriched: any = new Error(`MyCase ${status}: ${axiosErr.config?.method?.toUpperCase()} ${axiosErr.config?.url} — ${detail}`);
        enriched.statusCode = status;
        enriched.responseData = body;
        throw enriched;
      }
      throw err;
    }
  }

  // ── Custom Fields ─────────────────────────────────────────────────────────────

  async listCustomFields(installationId: string): Promise<Array<{
    id: number;
    name: string;
    parent_type: string;
    field_type: string;
    list_options?: Array<{ key: string; option: string }>;
  }>> {
    return this.call(installationId, (http) =>
      http.get('/custom_fields', { params: { page_size: 1000 } }).then((r) => r.data ?? []),
    );
  }

  // ── Clients ──────────────────────────────────────────────────────────────────

  async getClient(installationId: string, clientId: string): Promise<McClient> {
    return this.call(installationId, (http) =>
      http.get(`/contacts/clients/${clientId}`).then((r) => r.data),
    );
  }

  async createClient(
    installationId: string,
    data: McClientInput,
  ): Promise<McClient> {
    return this.call(installationId, (http) =>
      http.post('/contacts/clients', data).then((r) => r.data),
    );
  }

  async updateClient(
    installationId: string,
    clientId: string,
    data: Partial<McClientInput>,
  ): Promise<McClient> {
    return this.call(installationId, (http) =>
      http.put(`/contacts/clients/${clientId}`, data).then((r) => r.data),
    );
  }

  async listClients(
    installationId: string,
    since?: Date,
  ): Promise<McClient[]> {
    const results: McClient[] = [];
    const baseParams: Record<string, unknown> = { page_size: 1000 };
    if (since) baseParams['filter[updated_after]'] = since.toISOString();

    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params: Record<string, unknown> = { ...baseParams };
      if (pageToken) params.page_token = pageToken;

      const { clients, link } = await this.call(installationId, (http) =>
        http.get('/contacts/clients', { params }).then((r) => ({
          clients: (r.data?.clients ?? (Array.isArray(r.data) ? r.data : [])) as McClient[],
          link: r.headers['link'] as string | undefined,
        })),
      );

      results.push(...clients);
      pageToken = parseNextPageToken(link);
      pages++;

      if (clients.length === 0 || !pageToken || pages >= 50) break;
    } while (true);

    return results;
  }

  async searchClientByEmail(
    installationId: string,
    email: string,
  ): Promise<McClient | null> {
    const target = email.toLowerCase();
    let pageToken: string | undefined;
    let totalScanned = 0;

    do {
      const params: Record<string, unknown> = {
        'filter[email]': email,
        page_size: 1000,
      };
      if (pageToken) params.page_token = pageToken;

      const { clients, link } = await this.call(installationId, (http) =>
        http.get('/contacts/clients', { params }).then((r) => ({
          clients: (r.data?.clients ?? (Array.isArray(r.data) ? r.data : [])) as McClient[],
          link: r.headers['link'] as string | undefined,
        })),
      );

      if (clients.length === 0) break;
      totalScanned += clients.length;

      const found = clients.find((c) => c.email?.toLowerCase() === target);
      if (found) return found;

      pageToken = parseNextPageToken(link);
    } while (pageToken);

    this.logger.warn(
      `searchClientByEmail: "${email}" not found after scanning ${totalScanned} clients`,
    );
    return null;
  }

  async findClientByAnyMeans(
    installationId: string,
    email: string,
    opts: { firstName?: string; lastName?: string; phone?: string },
  ): Promise<McClient | null> {
    const targetEmail = email.toLowerCase();
    const targetPhone = opts.phone?.replace(/\D/g, '').slice(-10) ?? '';

    const matchesEmail = (c: McClient) => c.email?.toLowerCase() === targetEmail;
    const matchesPhone = (c: McClient) => {
      if (!targetPhone || targetPhone.length < 7) return false;
      const n = (s?: string) => s?.replace(/\D/g, '').slice(-10) ?? '';
      return (
        n(c.cell_phone_number) === targetPhone ||
        n(c.work_phone_number) === targetPhone ||
        n(c.home_phone_number) === targetPhone
      );
    };

    const scanPages = async (params: Record<string, unknown>): Promise<McClient | null> => {
      let pageToken: string | undefined;
      let pages = 0;
      do {
        const reqParams: Record<string, unknown> = { ...params, page_size: 200 };
        if (pageToken) reqParams.page_token = pageToken;

        const { clients, link } = await this.call(installationId, (http) =>
          http.get('/contacts/clients', { params: reqParams }).then((r) => ({
            clients: (r.data?.clients ?? (Array.isArray(r.data) ? r.data : [])) as McClient[],
            link: r.headers['link'] as string | undefined,
          })),
        );

        if (clients.length === 0) break;
        const found = clients.find((c) => matchesEmail(c) || matchesPhone(c));
        if (found) return found;

        pageToken = parseNextPageToken(link);
        pages++;
        if (!pageToken || pages >= 5) break;
      } while (true);
      return null;
    };

    const strategies: Array<{ label: string; params: Record<string, unknown> }> = [];

    if (opts.firstName && opts.lastName) {
      strategies.push({ label: 'first+last name', params: { 'filter[first_name]': opts.firstName, 'filter[last_name]': opts.lastName } });
    }
    if (opts.lastName) {
      strategies.push({ label: 'last name only', params: { 'filter[last_name]': opts.lastName } });
    }
    if (opts.firstName) {
      strategies.push({ label: 'first name only', params: { 'filter[first_name]': opts.firstName } });
    }
    if (opts.phone) {
      strategies.push({ label: 'cell phone', params: { 'filter[cell_phone_number]': opts.phone } });
      strategies.push({ label: 'work phone', params: { 'filter[work_phone_number]': opts.phone } });
      strategies.push({ label: 'home phone', params: { 'filter[home_phone_number]': opts.phone } });
      if (targetPhone && targetPhone !== opts.phone) {
        strategies.push({ label: 'cell phone digits', params: { 'filter[cell_phone_number]': targetPhone } });
      }
    }

    for (const { label, params } of strategies) {
      const found = await scanPages(params);
      if (found) {
        this.logger.log(`findClientByAnyMeans: found via "${label}" for email ${email} → client ${(found as any).id}`);
        return found;
      }
    }

    this.logger.warn(`findClientByAnyMeans: exhausted all strategies for email "${email}"`);
    return null;
  }

  // ── Cases (Matters) ───────────────────────────────────────────────────────────

  async getMatter(installationId: string, matterId: string): Promise<McMatter> {
    return this.call(installationId, (http) =>
      http.get(`/cases/${matterId}`).then((r) => r.data),
    );
  }

  async createMatter(
    installationId: string,
    data: McMatterInput,
  ): Promise<McMatter> {
    return this.call(installationId, (http) =>
      http.post('/cases', data).then((r) => r.data),
    );
  }

  async updateMatter(
    installationId: string,
    matterId: string,
    data: Partial<McMatterInput>,
  ): Promise<void> {
    await this.call(installationId, (http) =>
      http.put(`/cases/${matterId}`, data).then(() => undefined),
    );
  }

  async listMatters(
    installationId: string,
    since?: Date,
  ): Promise<McMatter[]> {
    const results: McMatter[] = [];
    const baseParams: Record<string, unknown> = { page_size: 1000 };
    if (since) baseParams['filter[updated_after]'] = since.toISOString();

    let pageToken: string | undefined;
    let pages = 0;

    do {
      const params: Record<string, unknown> = { ...baseParams };
      if (pageToken) params.page_token = pageToken;

      const { matters, link } = await this.call(installationId, (http) =>
        http.get('/cases', { params }).then((r) => ({
          matters: (Array.isArray(r.data) ? r.data : (r.data?.cases ?? [])) as McMatter[],
          link: r.headers['link'] as string | undefined,
        })),
      );

      results.push(...matters);
      pageToken = parseNextPageToken(link);
      pages++;

      if (matters.length === 0 || !pageToken || pages >= 50) break;
    } while (true);

    return results;
  }

  async listMattersByClient(
    installationId: string,
    clientId: string,
  ): Promise<McMatter[]> {
    return this.call(installationId, (http) =>
      http
        .get(`/clients/${clientId}/cases`)
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.cases ?? []))),
    );
  }

  // ── Notes ────────────────────────────────────────────────────────────────────

  async getNote(installationId: string, noteId: string): Promise<McNote> {
    return this.call(installationId, (http) =>
      http.get(`/notes/${noteId}`).then((r) => r.data),
    );
  }

  async createNoteForCase(
    installationId: string,
    caseId: string,
    data: McNoteInput,
  ): Promise<McNote> {
    return this.call(installationId, (http) =>
      http.post(`/cases/${caseId}/notes`, data).then((r) => r.data),
    );
  }

  async createNoteForClient(
    installationId: string,
    clientId: string,
    data: McNoteInput,
  ): Promise<McNote> {
    return this.call(installationId, (http) =>
      http.post(`/contacts/clients/${clientId}/notes`, data).then((r) => r.data),
    );
  }

  async updateNote(
    installationId: string,
    noteId: string,
    data: Partial<McNoteInput>,
  ): Promise<McNote> {
    return this.call(installationId, (http) =>
      http.put(`/notes/${noteId}`, data).then((r) => r.data),
    );
  }

  async listNotesByMatter(
    installationId: string,
    matterId: string,
  ): Promise<McNote[]> {
    return this.call(installationId, (http) =>
      http
        .get(`/cases/${matterId}/notes`)
        .then((r) => (Array.isArray(r.data) ? r.data : (r.data?.notes ?? []))),
    );
  }

  async listNotesByClient(
    installationId: string,
    clientId: string,
  ): Promise<McNote[]> {
    return this.call(installationId, (http) =>
      http
        .get(`/contacts/clients/${clientId}/notes`)
        .then((r) => r.data.notes ?? r.data ?? []),
    );
  }

  // ── Webhook Subscriptions ─────────────────────────────────────────────────────

  async listWebhookSubscriptions(installationId: string): Promise<McWebhookSubscription[]> {
    return this.callCentral(installationId, (http) =>
      http.get('/webhooks/subscriptions').then((r) => r.data ?? []),
    );
  }

  async createWebhookSubscription(
    installationId: string,
    model: 'case' | 'client',
    url: string,
    actions: Array<'created' | 'updated' | 'deleted'>,
  ): Promise<McWebhookSubscription> {
    return this.callCentral(installationId, (http) =>
      http.post('/webhooks/subscriptions', { model, url, actions }).then((r) => r.data),
    );
  }

  async deleteWebhookSubscription(installationId: string, subscriptionId: string): Promise<void> {
    await this.callCentral(installationId, (http) =>
      http.delete(`/webhooks/subscriptions/${subscriptionId}`).then(() => undefined),
    );
  }

  // ── Firm ─────────────────────────────────────────────────────────────────────

  async getFirmWebBaseUrl(installationId: string): Promise<string | null> {
    try {
      const data = await this.callCentral(installationId, (http) =>
        http.get('/firm').then((r) => r.data),
      );
      this.logger.log(`MyCase /firm response: ${JSON.stringify(data)}`);
      // MyCase returns portal_url, web_url, or subdomain depending on API version
      const raw: string | undefined =
        data?.portal_url ?? data?.web_url ?? data?.url ?? data?.subdomain;
      if (!raw) return null;
      // If it's just a subdomain string, build the full URL
      if (!raw.startsWith('http')) return `https://${raw}.mycase.com`;
      return raw.replace(/\/$/, '');
    } catch (err: any) {
      this.logger.warn(`Could not fetch MyCase firm info: ${err.message}`);
      return null;
    }
  }
}
