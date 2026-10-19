// Client for the Meterless Runtime (Nightshift hotspot), an OpenAI-compatible provider that runs locally.
// Contract (Meterless Runtime 0.90.0):
// https://github.com/meterless/meterless/blob/main/docs/agent-ready/add-meterless-provider.md
// Meterless has no hosted API key. Auth is the bearer token the runtime writes to <stateDir>/proxy-token.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const METERLESS_DEFAULT_BASE_URL = 'http://127.0.0.1:8088/v1';
export const METERLESS_APP_ID = 'blackbox-receipts';
const TIMEOUT_MS = 180_000; // contract: a cold model load can take minutes

export class MeterlessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MeterlessConfigError';
  }
}

export class MeterlessApiError extends Error {
  constructor(readonly status: number, readonly path: string, readonly body: string) {
    super(`Meterless Runtime ${status} on ${path}: ${body || '(empty body)'}`);
    this.name = 'MeterlessApiError';
  }
}

export interface MeterlessConfig { baseUrl: string; token: string }
export type MeterlessStatus = 'online' | 'unauthorized' | 'offline';
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

type Env = Record<string, string | undefined>;

/** Normalises any pasted runtime URL to `<host>/v1`, never `/v1/v1`. */
export function normalizeMeterlessUrl(input: string): string {
  let url = input.trim();
  if (!/^[a-z]+:\/\//i.test(url)) url = `http://${url}`;
  const parsed = new URL(url);
  const path = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|models|healthz)$/, '')
    .replace(/(\/v1)+$/, '');
  return `${parsed.protocol}//${parsed.host}${path}/v1`;
}

/**
 * Reads METERLESS_TOKEN, or the token file at METERLESS_STATE_DIR/proxy-token, plus optional
 * METERLESS_BASE_URL. Throws if no token can be found, or if it is the rejected `rt-local` placeholder.
 */
export function meterlessConfigFromEnv(env: Env = process.env): MeterlessConfig {
  let token = env.METERLESS_TOKEN?.trim();
  if (!token && env.METERLESS_STATE_DIR?.trim()) {
    const file = join(env.METERLESS_STATE_DIR.trim(), 'proxy-token');
    try {
      token = readFileSync(file, 'utf8').trim();
    } catch (err) {
      throw new MeterlessConfigError(`Meterless not configured: could not read ${file} (${(err as Error).message}). Is the Meterless Runtime installed and has it run once?`);
    }
  }
  if (!token) {
    throw new MeterlessConfigError(
      'Meterless not configured: set METERLESS_TOKEN, or METERLESS_STATE_DIR (the runtime writes its token to <stateDir>/proxy-token). Meterless runs locally; there is no hosted API key.',
    );
  }
  if (token === 'rt-local') throw new MeterlessConfigError('Meterless token "rt-local" is a placeholder the runtime rejects; use the real token from <stateDir>/proxy-token.');
  return { token, baseUrl: normalizeMeterlessUrl(env.METERLESS_BASE_URL?.trim() || METERLESS_DEFAULT_BASE_URL) };
}

export class MeterlessClient {
  constructor(readonly config: MeterlessConfig = meterlessConfigFromEnv()) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.config.token}`, 'meterless-app': METERLESS_APP_ID, Accept: 'application/json', ...extra };
  }

  private async getModelsResponse(): Promise<Response> {
    return fetch(`${this.config.baseUrl}/models`, { headers: this.headers(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  }

  /** Status per the contract: GET /v1/models decides; 401/403 is unauthorized, 200 with meterless ids is online. */
  async status(): Promise<MeterlessStatus> {
    let res: Response;
    try {
      res = await this.getModelsResponse();
    } catch {
      return 'offline';
    }
    if (res.status === 401 || res.status === 403) return 'unauthorized';
    if (!res.ok) return 'offline';
    const body = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
    return body?.data?.some((m) => m.id.startsWith('meterless/')) ? 'online' : 'offline';
  }

  /** GET /v1/models. Model ids are routing modes (meterless/auto, fast, deep, ...); unknown meterless/* ids are kept. */
  async listModels(): Promise<string[]> {
    const res = await this.getModelsResponse();
    if (!res.ok) throw new MeterlessApiError(res.status, '/v1/models', await res.text());
    const body = (await res.json()) as { data?: { id: string }[] };
    return (body.data ?? []).map((m) => m.id);
  }

  /** POST /v1/chat/completions; returns the assistant's text. */
  async chat(messages: ChatMessage[], model = 'meterless/auto'): Promise<string> {
    const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json', 'meterless-scope': 'user' }),
      body: JSON.stringify({ model, messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new MeterlessApiError(res.status, '/v1/chat/completions', await res.text());
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new MeterlessApiError(res.status, '/v1/chat/completions', 'response had no choices[0].message.content');
    return content;
  }
}
