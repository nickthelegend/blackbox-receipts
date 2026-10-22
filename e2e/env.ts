// Shared settings for the browser E2E run. Every server the run starts binds 127.0.0.1 and keeps its
// receipts and signing key in a throwaway folder under the OS temp dir, never in ~/.blackbox or .blackbox/.
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
export const STATE = join(tmpdir(), 'blackbox-e2e');

/** The dashboard with a session recorded through the real proxy before it starts. */
export const LIVE = { port: 3217, dir: join(STATE, 'live') };
/** The dashboard over an empty store: the "armed, nothing recorded" state. */
export const EMPTY = { port: 3218, dir: join(STATE, 'empty') };
/** The static Pages build (`pnpm build:pages -- --base-path /blackbox-receipts`) served from public/. */
export const PAGES = { port: 3219, base: '/blackbox-receipts' };

/** The env the proxy and the dashboard share for one store. */
export const storeEnv = (dir: string) => ({ RECEIPTS_DIR: join(dir, 'session'), BLACKBOX_KEY_DIR: join(dir, 'keys') });

/** The calls a user's agent makes in the recorded session. The .env read must be denied. */
export const LIVE_CALLS: { args: string[]; denied?: boolean }[] = [
  { args: ['--new-session', 'git', '{"action":"log"}'] },
  { args: ['read_file', '{"path":"README.md"}'] },
  { args: ['shell', '{"command":"ls packages"}'] },
  { args: ['read_file', '{"path":".env"}'], denied: true },
  { args: ['git', '{"action":"show_stat","args":["HEAD"]}'] },
];
