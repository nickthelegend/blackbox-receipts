// Client for the Zetaris SaaS REST API.
// Spec: https://api.saas.enterprise.zetaris.com/redoc/docs.yaml (OpenAPI 3.1, "Zetaris Api" v1).
// Every data call needs `Authorization: Bearer <API key>`, `X-Org-ID` (int64) and `X-Request-ID` (uuid).
import { randomUUID } from 'node:crypto';

export const ZETARIS_DEFAULT_BASE_URL = 'https://api.saas.enterprise.zetaris.com';

export class ZetarisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZetarisConfigError';
  }
}

export class ZetarisApiError extends Error {
  constructor(readonly status: number, readonly path: string, readonly body: string) {
    super(`Zetaris API ${status} on ${path}: ${body || '(empty body)'}`);
    this.name = 'ZetarisApiError';
  }
}

export interface ZetarisConfig {
  apiKey: string;
  orgId: string;
  baseUrl: string;
}

export interface LoginTokens { idToken: string; refreshToken: string }
export interface DataMartInfo { dataMartId: number; name: string; description?: string; tableCount: number }
export interface SqlPage {
  queryToken: string;
  pageNumber: number;
  pageLimit?: number;
  totalCount: number;
  totalPages: number;
  records?: unknown[];
}

type Env = Record<string, string | undefined>;

/** Reads ZETARIS_API_KEY, ZETARIS_ORG_ID and optional ZETARIS_BASE_URL. Throws if a required one is missing. */
export function zetarisConfigFromEnv(env: Env = process.env): ZetarisConfig {
  const missing = ['ZETARIS_API_KEY', 'ZETARIS_ORG_ID'].filter((k) => !env[k]?.trim());
  if (missing.length) {
    throw new ZetarisConfigError(
      `Zetaris not configured: missing ${missing.join(', ')}. Create an API key in the Zetaris Console and get your Org ID from Zetaris Support/Admin, then set them in .env.local.`,
    );
  }
  const orgId = env.ZETARIS_ORG_ID!.trim();
  if (!/^\d+$/.test(orgId)) throw new ZetarisConfigError(`ZETARIS_ORG_ID must be an integer org id, got "${orgId}".`);
  return {
    apiKey: env.ZETARIS_API_KEY!.trim(),
    orgId,
    baseUrl: (env.ZETARIS_BASE_URL?.trim() || ZETARIS_DEFAULT_BASE_URL).replace(/\/+$/, ''),
  };
}

export class ZetarisClient {
  constructor(readonly config: ZetarisConfig = zetarisConfigFromEnv()) {}

  private async request<T>(method: string, path: string, opts: { auth?: string; body?: unknown; query?: Record<string, string | number> } = {}): Promise<T> {
    const url = new URL(this.config.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Authorization: opts.auth ?? `Bearer ${this.config.apiKey}`,
      'X-Request-ID': randomUUID(),
      'X-Org-ID': this.config.orgId,
      Accept: 'application/json',
    };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(60_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = (JSON.parse(text) as { msg?: string }).msg ?? text; } catch { /* plain-text error body */ }
      throw new ZetarisApiError(res.status, path, msg);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** GET /api/v1.0/auth/login with Basic auth (username/password); returns JWTs. */
  login(username: string, password: string): Promise<LoginTokens> {
    const basic = Buffer.from(`${username}:${password}`).toString('base64');
    return this.request('GET', '/api/v1.0/auth/login', { auth: `Basic ${basic}` });
  }

  /** GET /api/v1.0/datamart: every data mart visible to the key's user. */
  listDataMarts(): Promise<DataMartInfo[]> {
    return this.request('GET', '/api/v1.0/datamart');
  }

  /** GET /api/v1.0/datamart/{DataMartId}/tables */
  listDataMartTables(dataMartId: number): Promise<unknown[]> {
    return this.request('GET', `/api/v1.0/datamart/${encodeURIComponent(dataMartId)}/tables`);
  }

  /** GET /api/v1.0/lightning-database/databases */
  listLightningDatabases(): Promise<unknown[]> {
    return this.request('GET', '/api/v1.0/lightning-database/databases');
  }

  /** POST /api/v1.0/query/sql/start. pageLimit is 1..100 per the spec. */
  startSql(select: string, pageLimit = 100): Promise<SqlPage> {
    if (pageLimit < 1 || pageLimit > 100) throw new RangeError('Zetaris pageLimit must be between 1 and 100');
    return this.request('POST', '/api/v1.0/query/sql/start', { body: { select, pageLimit } });
  }

  /** GET /api/v1.0/query/sql/page */
  pageSql(queryToken: string, pageNumber: number, pageLimit = 100): Promise<SqlPage> {
    return this.request('GET', '/api/v1.0/query/sql/page', { query: { queryToken, pageNumber, pageLimit } });
  }

  /** DELETE /api/v1.0/query/sql/close/{queryToken} */
  async closeSql(queryToken: string): Promise<void> {
    await this.request('DELETE', `/api/v1.0/query/sql/close/${encodeURIComponent(queryToken)}`);
  }

  /** Runs a query, follows every page, and always closes the server-side cursor. */
  async querySql(select: string, opts: { pageLimit?: number; maxPages?: number } = {}): Promise<{ records: unknown[]; totalCount: number }> {
    const pageLimit = opts.pageLimit ?? 100;
    const first = await this.startSql(select, pageLimit);
    try {
      const records = [...(first.records ?? [])];
      const last = Math.min(first.totalPages, opts.maxPages ?? Infinity);
      for (let n = first.pageNumber + 1; n <= last; n++) {
        records.push(...((await this.pageSql(first.queryToken, n, pageLimit)).records ?? []));
      }
      return { records, totalCount: first.totalCount };
    } finally {
      await this.closeSql(first.queryToken);
    }
  }
}
