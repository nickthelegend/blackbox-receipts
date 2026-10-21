// Overhead benchmark: the same real MCP server called directly and through the Blackbox proxy
// (`--upstream`), sequential calls, many sessions. Overhead = proxied minus direct latency per call,
// which covers policy evaluation, Ed25519 signing, the lock and two appends to disk.
//   node packages/proxy/dist/bench.js [--sessions 20] [--calls 25] [--upstream "<cmd>"] [--out file.json]
import { mkdtempSync, writeFileSync } from 'node:fs';
import { cpus, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectProxy } from './client.js';
import { splitCommand } from './upstream.js';

const argv = process.argv.slice(2);
const option = (name: string, fallback: string) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback; };
const sessions = Number(option('sessions', '20'));
const calls = Number(option('calls', '25'));
const fixture = fileURLToPath(new URL('../../../test/fixtures/upstream-server.mjs', import.meta.url));
const upstream = option('upstream', `node "${fixture}"`);
const out = option('out', '');

const env = { ...process.env, UPSTREAM_NO_DELAY: '1' } as Record<string, string>;
const work = mkdtempSync(join(tmpdir(), 'blackbox-bench-'));

async function timeCalls(client: Client): Promise<number[]> {
  const times: number[] = [];
  for (let index = 0; index < calls; index++) {
    const started = process.hrtime.bigint();
    const result = await client.callTool({ name: 'echo', arguments: { text: `call ${index}` } });
    times.push(Number(process.hrtime.bigint() - started) / 1e6);
    if (result.isError) throw new Error(`call failed: ${JSON.stringify(result.content)}`);
  }
  return times;
}

async function direct(): Promise<number[]> {
  const [command, ...args] = splitCommand(upstream);
  const client = new Client({ name: 'bench-direct', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command, args, cwd: work, env }));
  try { return await timeCalls(client); } finally { await client.close(); }
}

async function proxied(session: number): Promise<number[]> {
  const client = await connectProxy({ cwd: work, args: ['--upstream', upstream], env: { ...env, RECEIPTS_DIR: join(work, 'receipts'), BLACKBOX_KEY_DIR: join(work, 'keys'), RECEIPTS_RESUME: undefined, RECEIPTS_SESSION_ID: `bench-${session}` } });
  try { return await timeCalls(client); } finally { await client.close(); }
}

const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { mean: values.reduce((sum, value) => sum + value, 0) / values.length, p50: at(0.5), p95: at(0.95), max: sorted.at(-1)! };
};
const round = (value: number) => Math.round(value * 1000) / 1000;

const directTimes: number[] = [];
const proxiedTimes: number[] = [];
for (let session = 1; session <= sessions; session++) {
  // Alternate the order so neither side always runs on a warmer machine.
  if (session % 2) { directTimes.push(...await direct()); proxiedTimes.push(...await proxied(session)); }
  else { proxiedTimes.push(...await proxied(session)); directTimes.push(...await direct()); }
}
const d = stats(directTimes);
const p = stats(proxiedTimes);
const report = {
  measuredAt: new Date().toISOString(),
  machine: { cpu: cpus()[0]?.model ?? 'unknown', cores: cpus().length, platform: `${process.platform} ${process.arch}`, node: process.version },
  upstream: upstream.replace(fixture, 'test/fixtures/upstream-server.mjs'),
  sessions, callsPerSession: calls, callsMeasured: { direct: directTimes.length, proxied: proxiedTimes.length },
  msPerCall: {
    direct: Object.fromEntries(Object.entries(d).map(([key, value]) => [key, round(value)])),
    proxied: Object.fromEntries(Object.entries(p).map(([key, value]) => [key, round(value)])),
    overheadMean: round(p.mean - d.mean),
    overheadP50: round(p.p50 - d.p50),
  },
};
console.log(JSON.stringify(report, null, 2));
if (out) writeFileSync(resolve(out), `${JSON.stringify(report, null, 2)}\n`);
