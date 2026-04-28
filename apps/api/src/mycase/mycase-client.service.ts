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

/**
 * Conservative rate limit: 1 req/s until MyCase documents their limit.
 * Uses a simple per-installation sliding queue.
 */
const REQUEST_INTERVAL_MS = 1_000;

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

  private async buildClient(installationId: string): Promise<AxiosInstance> {
    const installation = await this.installationService.findByIdOrFail(installationId);
    const token = await this.oauthService.getValidAccessToken(installation);

    const instance = axios.create({
      baseURL: installation.mycaseBaseUrl ?? MYCASE_BASE,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 8_000, // 8s hard timeout — prevents worker stalls on slow/hung MyCase responses
    });

    // Retry transient errors (network, 5xx) up to 3 times with exponential backoff
    axiosRetry(instance, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error: AxiosError) =>
        axiosRetry.isNetworkOrIdempotentRequestError(error) ||
        (error.response?.status ?? 0) >= 500,
    });

    // On 401 → refresh token and retry once
    instance.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        if (
          error.response?.status === 401 &&
          !(error.config as any)._retried
        ) {
          (error.config as any)._retried = true;
          const fresh = await this.installationService.findByIdOrFail(installationId);
          const newToken = await this.oauthService.getValidAccessToken(fresh);
          (error.config as InternalAxiosRequestConfig).headers[
            'Authorization'
          ] = `Bearer ${newToken}`;
          return instance.request(error.config!);
        }
        return Promise.reject(error);
      },
    );

    return instance;
  }

  /**
   * Throttle requests to 1/s per installation.
   */
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
      if (axiosErr.response?.status === 422) {
        this.logger.error(
          `MyCase 422 — URL: ${axiosErr.config?.baseURL}${axiosErr.config?.url} — request: ${axiosErr.config?.data} — response: ${JSON.stringify(axiosErr.response?.data)}`,
        );
      }
      if (axiosErr.response?.status === 401) {
        throw new UnauthorizedException('MyCase authentication failed');
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
      http.get(`/clients/${clientId}`).then((r) => r.data),
    );
  }

  async createClient(
    installationId: string,
    data: McClientInput,
  ): Promise<McClient> {
    return this.call(installationId, (http) =>
      http.post('/clients', data).then((r) => r.data),
    );
  }

  async updateClient(
    installationId: string,
    clientId: string,
    data: Partial<McClientInput>,
  ): Promise<McClient> {
    return this.call(installationId, (http) =>
      http.put(`/clients/${clientId}`, data).then((r) => r.data),
    );
  }

  async listClients(
    installationId: string,
    since?: Date,
  ): Promise<McClient[]> {
    return this.call(installationId, (http) => {
      const params: Record<string, string> = {};
      if (since) {
        params.updated_since = since.toISOString();
      }
      return http.get('/clients', { params }).then((r) => r.data.clients ?? r.data ?? []);
    });
  }

  async searchClientByEmail(
    installationId: string,
    email: string,
  ): Promise<McClient | null> {
    const target = email.toLowerCase();
    // Build the HTTP client directly — skip the 1 req/s write throttle since
    // this is a read-only scan and needs to page quickly.
    const http = await this.buildClient(installationId);
    const MAX_PAGES = 40;
    let page = 1;

    while (page <= MAX_PAGES) {
      const res = await http.get('/clients', {
        params: { email, page, page_size: 500 },
      });
      const batch: McClient[] = res.data.clients ?? res.data ?? [];

      if (!Array.isArray(batch) || batch.length === 0) return null;

      const found = batch.find((c) => c.email?.toLowerCase() === target);
      if (found) return found;

      if (batch.length < 500) return null;
      page++;
    }

    this.logger.warn(`searchClientByEmail: "${email}" not found in first ${MAX_PAGES} pages`);
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
  ): Promise<McMatter> {
    return this.call(installationId, (http) =>
      http.put(`/cases/${matterId}`, data).then((r) => r.data),
    );
  }

  async listMatters(
    installationId: string,
    since?: Date,
  ): Promise<McMatter[]> {
    return this.call(installationId, (http) => {
      const params: Record<string, string> = {};
      if (since) {
        params.updated_since = since.toISOString();
      }
      return http.get('/cases', { params }).then((r) => r.data.cases ?? r.data ?? []);
    });
  }

  async listMattersByClient(
    installationId: string,
    clientId: string,
  ): Promise<McMatter[]> {
    return this.call(installationId, (http) =>
      http
        .get(`/clients/${clientId}/cases`)
        .then((r) => r.data.cases ?? r.data ?? []),
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
      http.post(`/clients/${clientId}/notes`, data).then((r) => r.data),
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
        .then((r) => r.data.notes ?? r.data ?? []),
    );
  }

  async listNotesByClient(
    installationId: string,
    clientId: string,
  ): Promise<McNote[]> {
    return this.call(installationId, (http) =>
      http
        .get(`/clients/${clientId}/notes`)
        .then((r) => r.data.notes ?? r.data ?? []),
    );
  }
}
