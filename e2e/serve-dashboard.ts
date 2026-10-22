// Starts the dashboard (`next start` of the production build) over a throwaway store.
//   tsx e2e/serve-dashboard.ts live    records a real session through the MCP proxy first, then serves it
//   tsx e2e/serve-dashboard.ts empty   serves an empty store
// The live session is made of real tool calls through `packages/proxy/dist/call.js` (the one-shot bridge),
// including a `.env` read the proxy denies before it runs. Needs `pnpm build` first.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { EMPTY, LIVE, LIVE_CALLS, REPO, storeEnv } from './env.ts';

const mode = process.argv[2];
if (mode !== 'live' && mode !== 'empty') { console.error('Usage: tsx e2e/serve-dashboard.ts live|empty'); process.exit(2); }
const target = mode === 'live' ? LIVE : EMPTY;
const web = join(REPO, 'apps/web');
for (const built of [join(REPO, 'packages/proxy/dist/call.js'), join(web, '.next/BUILD_ID')]) {
  if (!existsSync(built)) { console.error(`serve-dashboard: ${built} is missing. Run pnpm build first.`); process.exit(1); }
}

rmSync(target.dir, { recursive: true, force: true });
mkdirSync(target.dir, { recursive: true });
const env = { ...process.env, ...storeEnv(target.dir) };

if (mode === 'live') {
  for (const call of LIVE_CALLS) {
    const run = spawnSync(process.execPath, [join(REPO, 'packages/proxy/dist/call.js'), ...call.args], { cwd: REPO, env, encoding: 'utf8' });
    const denied = run.status !== 0;
    if (denied !== Boolean(call.denied)) {
      console.error(`serve-dashboard: call ${call.args.join(' ')} exited ${run.status}, expected ${call.denied ? 'a denial' : 'success'}\n${run.stderr}`);
      process.exit(1);
    }
    console.log(`serve-dashboard: recorded ${call.args.filter((arg) => arg !== '--new-session').join(' ')}${denied ? ' (denied by the proxy)' : ''}`);
  }
}

const require = createRequire(join(web, 'package.json'));
const nextBin = join(dirname(require.resolve('next/package.json')), 'dist/bin/next');
const server = spawn(process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', String(target.port)], { cwd: web, env: { ...env, NEXT_TELEMETRY_DISABLED: '1' }, stdio: 'inherit' });
console.log(`serve-dashboard: ${mode} dashboard pid ${server.pid} on http://127.0.0.1:${target.port} (store ${target.dir})`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { server.kill(signal); });
server.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
