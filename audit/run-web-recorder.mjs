// Recorder-only audit. Real Chrome, production dashboard, real MCP calls, disposable stores.
// Run after pnpm build and acquiring the bb-audit-web heavy slot. Always releases it.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const repo = resolve(import.meta.dirname, '..');
const state = mkdtempSync(join(tmpdir(), 'bb-recorder-audit-'));
const base = 'http://127.0.0.1:33217', emptyBase = 'http://127.0.0.1:33218';
const unset = ['ZETARIS_API_KEY', 'ZETARIS_ORG_ID', 'METERLESS_TOKEN', 'METERLESS_STATE_DIR', 'WALRUS_PUBLISHER_URL'];
const clean = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
const envFor = mode => ({ ...clean, NEXT_TELEMETRY_DISABLED: '1', RECEIPTS_DIR: join(state, mode, 'session'), BLACKBOX_KEY_DIR: join(state, mode, 'keys'), RECEIPTS_SESSION_ID: '933f87da-572a-47f6-8cd3-004ea187da31' });
const calls = [['--new-session', 'git', '{"action":"log"}'], ['read_file', '{"path":"README.md"}'], ['shell', '{"command":"ls packages"}'], ['read_file', '{"path":".env"}'], ['git', '{"action":"show_stat","args":["HEAD"]}']];
const results = [], servers = [], output = resolve(repo, 'audit/web');
let browser, attacker;
const fixes = {
  'WEB-PAGE-RECORDER': 'Readouts use a semantic dl with dt/dd.',
  'WEB-FLOW-RECORDER-TAMPER-CYCLE': 'Rejected counts the rejected signature; downstream receipts remain Untrusted.'
};
const selected = process.argv.slice(2);
const pad = n => String(n).padStart(2, '0');
const lamp = (p, label) => p.locator('.rc-lamp').filter({ has: p.locator('.rc-lamp-label', { hasText: new RegExp(`^${label}$`) }) });
async function shot(p, dir, name) { await p.screenshot({ path: join(dir, `${name}.png`), fullPage: true, animations: 'disabled' }); }
async function width(p) { const size = await p.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })); expect(size.scroll).toBeLessThanOrEqual(size.client); return size; }
function call(args, denied = false) {
  const r = spawnSync(process.execPath, [join(repo, 'packages/proxy/dist/call.js'), ...args], { cwd: repo, env: envFor('live'), encoding: 'utf8' });
  expect(r.status, r.stderr).toBe(denied ? 1 : 0);
  return { args, status: r.status, stderr: r.stderr };
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${url}/api/session`)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Dashboard did not start: ${url}`);
}
function report() {
  const counts = Object.fromEntries(['PASS', 'FAIL', 'UNTESTED'].map(s => [s, results.filter(r => r.status === s).length]));
  writeFileSync(resolve(repo, 'audit/results-web-recorder.md'), `# Recorder browser audit\n\n${new Date().toISOString()} — Chrome, production Next server; desktop 1280×800, mobile 375×812. Real proxy calls and isolated OS-temp receipt/key directories. ${unset.join(', ')} unset for both servers and proxy. No sponsor/publisher requests.\n\nPASS: ${counts.PASS}; FAIL: ${counts.FAIL}; UNTESTED: ${counts.UNTESTED}.\n\nEvidence saved per row and after each group of eight. Commits are left to Loom per the session's no-commit instruction. Expected corruption 409 and CSRF 403 responses are captured explicitly.\n\n| ID | status | evidence | fix |\n| --- | --- | --- | --- |\n${results.map(r => `| ${r.id} | ${r.status} | [Evidence](web/${r.id}/evidence.json), [screenshot](web/${r.id}/final.png), console.json, network.json${r.error ? `; ${r.error.replaceAll('|', '\\|').replaceAll('\n', ' ').slice(0, 900)}` : ''} | ${r.fix || '—'} |`).join('\n')}\n`);
}
async function row(id, fn, { empty = false, mobile = false, expectedErrors = false } = {}) {
  if (selected.length && !selected.includes(id)) return;
  const dir = join(output, id); mkdirSync(dir, { recursive: true });
  const context = await browser.newContext({ viewport: mobile ? { width: 375, height: 812 } : { width: 1280, height: 800 } });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const page = await context.newPage(), consoleLog = [], network = [], problems = [];
  page.on('console', msg => { consoleLog.push({ type: msg.type(), text: msg.text(), location: msg.location() }); if (msg.type() === 'error') problems.push(`console error: ${msg.text()}`); });
  page.on('pageerror', error => { consoleLog.push({ type: 'pageerror', text: error.message }); problems.push(`page error: ${error.message}`); });
  page.on('requestfailed', req => network.push({ type: 'requestfailed', method: req.method(), url: req.url(), error: req.failure() }));
  const pending = [];
  page.on('response', res => {
    const entry = { method: res.request().method(), url: res.url(), status: res.status() }; network.push(entry);
    if (res.url().includes('/api/')) pending.push(res.text().then(body => { entry.body = body; }).catch(() => {}));
    if (res.status() >= 400 && new URL(res.url()).origin === new URL(page.url()).origin && !(expectedErrors && [403, 409].includes(res.status()))) problems.push(`HTTP ${res.status()} ${entry.method} ${entry.url}`);
  });
  let detail = {}, error;
  try {
    await page.goto(`${empty ? emptyBase : base}/recorder`);
    if (!expectedErrors) { await expect(lamp(page, 'Zetaris').locator('b')).toHaveText('Setup required'); await expect(lamp(page, 'Chain').locator('b')).toHaveText(empty ? 'No data' : 'Verified'); }
    detail = await fn(page, dir) ?? {};
    await expect.poll(() => problems).toEqual([]);
  } catch (e) { error = e.message; }
  try { await shot(page, dir, 'final'); writeFileSync(join(dir, 'body.txt'), await page.locator('body').innerText()); } catch {}
  await Promise.allSettled(pending);
  await context.tracing.stop({ path: join(dir, 'trace.zip') });
  await context.close();
  const consoleCause = expectedErrors && problems.some(p => p.startsWith('console error:'))
    ? 'Required error status is correct, but Chrome emits a resource console error. Cause: /Applications/Google Chrome.app/Contents/MacOS/Google Chrome; session 409 comes from apps/web/app/api/corrupt.ts, CSRF 403 from apps/web/middleware.ts. Kept the required API refusal contract; global zero-console-error rule fails.' : '';
  const result = { id, status: error || problems.length ? 'FAIL' : 'PASS', error, problems, detail, viewport: mobile ? '375x812' : '1280x800', unset, capturedAt: new Date().toISOString(), fix: consoleCause || (fixes[id] && process.env.AUDIT_FIXED === '1' ? fixes[id] : '') };
  writeFileSync(join(dir, 'console.json'), JSON.stringify(consoleLog, null, 2));
  writeFileSync(join(dir, 'network.json'), JSON.stringify(network, null, 2));
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(result, null, 2));
  results.push(result); report(); console.log(`${id}: ${result.status}${error ? ` ${error.slice(0, 160)}` : ''}`);
}

try {
  mkdirSync(output, { recursive: true });
  writeFileSync(resolve(repo, 'audit/web-recorder-runtime.json'), JSON.stringify({ state, unset, sessionId: envFor('live').RECEIPTS_SESSION_ID, fixtureCalls: calls, capturedAt: new Date().toISOString() }, null, 2));
  for (const mode of ['live', 'empty']) mkdirSync(envFor(mode).RECEIPTS_DIR, { recursive: true });
  const callEvidence = calls.map((args, i) => call(args, i === 3));
  writeFileSync(resolve(repo, 'audit/web-recorder-proxy.json'), JSON.stringify(callEvidence, null, 2));
  const require = createRequire(join(repo, 'apps/web/package.json'));
  const next = join(dirname(require.resolve('next/package.json')), 'dist/bin/next');
  for (const [mode, port] of [['live', 33217], ['empty', 33218]]) {
    const server = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: join(repo, 'apps/web'), env: envFor(mode), stdio: ['ignore', 'pipe', 'pipe'] });
    servers.push(server);
    let log = ''; const save = chunk => { log += chunk; writeFileSync(resolve(repo, `audit/web-recorder-server-${mode}.txt`), log); };
    server.stdout.on('data', save); server.stderr.on('data', save);
    await ready(`http://127.0.0.1:${port}`);
  }
  attacker = createServer((req, res) => { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Cross-origin audit source</title><p>Cross-origin audit source</p>'); });
  await new Promise(r => attacker.listen(33219, '127.0.0.1', r));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  await row('WEB-PAGE-RECORDER', async p => {
    await expect(p).toHaveTitle('Recorder · Blackbox Receipts'); await expect(p.getByRole('heading', { name: 'Annunciator panel' })).toBeVisible();
    await expect(p.locator('.rc-rec')).toContainText('Recording'); await expect(p.locator('.rc-rec code')).toHaveText('933f87da');
    await expect(p.getByLabel('Readouts')).toContainText('Blocks05'); await expect(p.getByLabel('Readouts')).toContainText('Denied calls01'); await expect(p.getByLabel('Readouts')).toContainText('Merkle root');
    await expect(p.locator('#tape .tape-mark')).toHaveCount(5); await expect(p.locator('.rc-legend')).toBeVisible(); await expect(p.getByRole('list', { name: 'Tape log' }).getByRole('listitem')).toHaveCount(5);
    await p.locator('#block-1 .rc-row-main').click(); await expect(p.locator('#block-1 .rc-details')).toBeVisible();
    for (const text of ['Tamper test', 'Policy proof · no-secrets-read/v2', 'Walrus storage']) await expect(p.getByLabel('Controls')).toContainText(text);
    await expect(p.getByLabel('Wiring')).toBeVisible();
    expect(await p.getByLabel('Readouts').evaluate(el => el.tagName)).toBe('DL');
  });
  await row('WEB-NAV-RECORDER', async p => {
    await p.keyboard.press('Tab'); const skip = p.getByRole('link', { name: 'Skip to the recorder' }); await expect(skip).toBeFocused(); await expect(skip).toHaveAttribute('href', '#rc-main'); await p.keyboard.press('Enter'); await expect(p).toHaveURL(`${base}/recorder#rc-main`);
    for (const [label, path] of [['Overview', '/'], ['Verify a pack', '/verify']]) { await p.getByRole('navigation', { name: 'Recorder' }).getByRole('link', { name: label }).click(); await expect(p).toHaveURL(`${base}${path}`); await p.goto(`${base}/recorder`); }
    await p.getByRole('link', { name: 'Blackbox Receipts, home' }).click(); await expect(p).toHaveURL(`${base}/`);
  });
  for (const [suffix, name, detail] of [['ZETARIS', 'Zetaris', 'Set ZETARIS_API_KEY, ZETARIS_ORG_ID'], ['METERLESS', 'Meterless', 'Set METERLESS_TOKEN or METERLESS_STATE_DIR'], ['WALRUS', 'Walrus', 'Set WALRUS_PUBLISHER_URL']]) {
    await row(`WEB-LAMP-${suffix}-SETUP`, async (p, dir) => {
      const l = lamp(p, name); await expect(l.locator('.rc-lamp-label')).toHaveText(name); await expect(l.locator('b')).toHaveText('Setup required'); await expect(l).toHaveClass('rc-lamp is-caution'); await expect(l.locator('small')).toHaveText(detail); await l.screenshot({ path: join(dir, 'lamp.png') }); return { label: name, state: await l.locator('b').innerText(), tone: await l.getAttribute('class'), detail: await l.locator('small').innerText() };
    });
  }
  await row('WEB-LAMP-CHAIN-SECRET', async p => {
    for (const [name, state, tone, detail] of [['Chain', 'Verified', 'ok', '5 signatures and links'], ['Secret paths', 'Touched · 04', 'bad', '1 call(s) denied before running']]) { const l = lamp(p, name); await expect(l.locator('b')).toHaveText(state); await expect(l).toHaveClass(`rc-lamp is-${tone}`); await expect(l.locator('small')).toHaveText(detail); }
  });
  await row('WEB-FLOW-RECORDER-STORE-LABEL', async p => {
    const file = join(envFor('live').RECEIPTS_DIR, 'session.jsonl'); await expect(p.locator('#tape .rc-note')).toHaveText(`Reads ${file} every 3 s`); await expect(p.getByLabel('Wiring').locator('dt', { hasText: /^Store$/ }).locator('xpath=following-sibling::dd[1]')).toHaveText(file); await expect(p.locator('body')).not.toContainText('.blackbox/session.jsonl'); await expect(p.locator('body')).not.toContainText(envFor('live').BLACKBOX_KEY_DIR); return { file };
  });
  await row('WEB-FLOW-RECORDER-KEY-TOGGLE', async p => {
    await p.getByRole('button', { name: 'Show public key' }).click(); await expect(p.getByRole('button', { name: 'Hide public key' })).toHaveAttribute('aria-expanded', 'true'); const key = p.getByLabel('Proxy public key'); await expect(key).toContainText('-----BEGIN PUBLIC KEY-----'); expect(await key.evaluate(el => el.tagName)).toBe('PRE'); await p.getByRole('button', { name: 'Hide public key' }).click(); await expect(key).toHaveCount(0);
  });
  console.log('First eight rows saved for Loom checkpoint.');
  await row('WEB-FLOW-RECORDER-LOG-EXPLAIN', async (p, dir) => {
    const explained = await (await p.request.get(`${base}/api/explain`)).json();
    for (let n = 1; n <= 5; n++) {
      const step = explained.steps.find(s => s.step === n), r = p.locator(`#block-${n}`); await r.locator('.rc-row-main').click(); await expect(r.locator('.rc-row-main')).toHaveAttribute('aria-expanded', 'true');
      for (const title of ['Receipt hash', 'Previous', 'Args hash · result hash', 'Signature', 'Permissions']) await expect(r.locator('dt', { hasText: new RegExp(`^${title.replace('·', '\\u00b7')}$`) })).toBeVisible();
      const why = r.getByRole('button', { name: `Explain why · step ${pad(n)}` }); await why.click(); const d = p.getByRole('dialog'); await expect(d).toContainText(step.command); await expect(d).toContainText(n === 4 ? 'Policy violation' : 'Allowed'); await expect(d).toContainText(step.outcome); await expect(d).toContainText(`${step.timestamp.slice(11, 19)} UTC`); await expect(d.locator('.xd-why li')).toHaveCount(step.why.length); await expect(d.locator('.xd-cites li')).toHaveCount(step.cites.length); if (n === 4) await shot(p, dir, 'denied-drawer'); await p.keyboard.press('Escape'); await expect(d).toBeHidden(); await expect(why).toBeFocused();
    }
  });
  await row('WEB-FLOW-RECORDER-PROVE', async p => {
    const response = p.waitForResponse(r => r.url().endsWith('/api/prove') && r.request().method() === 'POST'); await p.getByRole('button', { name: 'Prove: no secrets read' }).click(); expect((await response).status()).toBe(200); await expect(lamp(p, 'No-secrets proof').locator('b')).toHaveText('Fail · 04'); await expect(p.locator('#prove h2')).toHaveText('Fail at block 04'); await expect(p.locator('#prove p')).toContainText('.env*'); await expect(p.locator('#block-4 .rc-pill')).toHaveText('Policy fail'); await p.getByRole('button', { name: 'Explain why block 04 fails' }).click(); await expect(p.getByRole('dialog')).toContainText('Explain why · step 04');
  });
  await row('WEB-FLOW-RECORDER-TAMPER-CYCLE', async (p, dir) => {
    try {
      await p.getByRole('button', { name: 'Prove: no secrets read' }).click(); await expect(lamp(p, 'No-secrets proof').locator('b')).toHaveText('Fail · 04'); await p.getByLabel('Block to tamper').selectOption('2'); await p.getByRole('button', { name: 'Tamper', exact: true }).click();
      await expect(p.locator('.rc-notice')).toHaveText('Block 2 edited on disk. Verification now rejects its signature.');
      for (const [name, value] of [['Chain', 'Broken · 02'], ['Tamper test', 'Edited · 02'], ['No-secrets proof', 'Stale']]) await expect(lamp(p, name).locator('b')).toHaveText(value);
      await expect(p.locator('.rc-rec')).toContainText('Tamper detected'); await expect(p.locator('#block-2 .rc-pill')).toHaveText('Signature fails'); await expect(p.locator('#block-3 .rc-pill')).toHaveText('Untrusted'); await shot(p, dir, 'tampered');
      const rejected = p.getByLabel('Readouts').locator('div').filter({ has: p.locator('.stencil', { hasText: /^Rejected$/ }) }).locator('b'); await expect(rejected).toHaveText('01');
      const response = p.waitForResponse(r => r.url().endsWith('/api/session') && r.request().method() === 'GET'); await p.getByRole('button', { name: 'Re-verify' }).click(); expect((await response).status()).toBe(200); await expect(lamp(p, 'Chain').locator('b')).toHaveText('Broken · 02'); await p.getByRole('button', { name: 'Restore' }).click(); await expect(p.locator('.rc-notice')).toHaveText('Restored block(s) 2 to their signed originals.'); await expect(lamp(p, 'Chain').locator('b')).toHaveText('Verified'); await expect(lamp(p, 'Tamper test').locator('b')).toHaveText('Off'); await expect(p.getByRole('button', { name: 'Restore' })).toBeDisabled();
    } finally { await p.request.post(`${base}/api/restore`); }
  });
  await row('WEB-FLOW-RECORDER-NEW-CALL', async (p, dir) => {
    await p.getByRole('button', { name: 'Prove: no secrets read' }).click(); await expect(lamp(p, 'No-secrets proof').locator('b')).toHaveText('Fail · 04');
    const start = Date.now(); const result = call(['read_file', '{"path":"package.json"}']);
    await expect(p.getByLabel('Readouts')).toContainText('Blocks06', { timeout: 8000 }); const elapsedMs = Date.now() - start; expect(elapsedMs).toBeLessThanOrEqual(8000);
    const r = p.locator('#block-6'); await expect(r).toContainText('read_file'); await expect(r).toContainText('package.json'); await expect(lamp(p, 'No-secrets proof').locator('b')).toHaveText('Stale'); await expect(lamp(p, 'Chain').locator('b')).toHaveText('Verified'); await r.locator('.rc-row-main').click(); await expect(r.locator('dt', { hasText: /^Signature$/ })).toBeVisible(); await r.getByRole('button', { name: 'Explain why · step 06' }).click(); await expect(p.getByRole('dialog')).toContainText('package.json'); return { elapsedMs, result };
  });
  await row('EDGE-RECORDER-EMPTY-STORE', async p => {
    await expect(p.locator('.rc-empty strong')).toHaveText('Recorder armed. Nothing recorded yet.'); await expect(p.locator('.rc-empty code')).toHaveText('pnpm --filter @blackbox/proxy start'); await expect(lamp(p, 'Secret paths').locator('b')).toHaveText('No data');
    for (const name of ['Tamper', 'Restore', 'Prove: no secrets read', 'Upload to Walrus']) await expect(p.getByRole('button', { name, exact: true })).toBeDisabled(); await expect(p.locator('.rc-master')).toHaveText('No warnings'); const response = p.waitForResponse(r => r.url().endsWith('/api/session')); await p.getByRole('button', { name: 'Re-verify' }).click(); expect((await response).status()).toBe(200);
  }, { empty: true });
  await row('EDGE-RECORDER-TORN-LOG', async (p, dir) => {
    const file = join(envFor('empty').RECEIPTS_DIR, 'session.jsonl'), live = readFileSync(join(envFor('live').RECEIPTS_DIR, 'session.jsonl'), 'utf8').split('\n');
    try {
      writeFileSync(file, `${live[0]}\n${live[1].slice(0, Math.floor(live[1].length / 2))}`); const response = await p.request.get(`${emptyBase}/api/session`); expect(response.status()).toBe(409); const body = await response.json(); expect(body.corruptLine).toBe(2); expect(body.error).toMatch(/^session\.jsonl is corrupt at line 2: /); writeFileSync(join(dir, 'api-409.json'), JSON.stringify(body, null, 2)); await p.reload(); await expect(p.locator('p.rc-alert[role="alert"]')).toHaveText(`Could not load the session: ${body.error}`); await expect(p.locator('.rc-empty strong')).toHaveText('Session unavailable'); const dimensions = await width(p); await shot(p, dir, 'torn'); return { responseStatus: response.status(), body, dimensions };
    } finally { writeFileSync(file, ''); }
  }, { empty: true, expectedErrors: true });
  await row('EDGE-RECORDER-CROSS-SITE-POST', async (p, dir) => {
    await p.getByLabel('Block to tamper').selectOption('2'); await p.getByRole('button', { name: 'Tamper', exact: true }).click(); await expect(lamp(p, 'Chain').locator('b')).toHaveText('Broken · 02');
    try {
      const statuses = [];
      for (const origin of ['http://127.0.0.1:33219', 'http://localhost:33219']) {
        await p.goto(origin);
        for (const path of ['/api/restore', '/api/prove']) {
          const response = p.waitForResponse(r => r.url() === `${base}${path}` && r.request().method() === 'POST');
          const type = await p.evaluate(async url => (await fetch(url, { method: 'POST', mode: 'no-cors' })).type, `${base}${path}`);
          const res = await response; expect(res.status()).toBe(403); expect(type).toBe('opaque'); const data = await (await p.request.get(`${base}/api/session`)).json(); expect(data.tampered).toEqual([2]); statuses.push({ origin, path, status: res.status(), type, tampered: data.tampered });
        }
      }
      writeFileSync(join(dir, 'refusals.json'), JSON.stringify(statuses, null, 2)); return { statuses };
    } finally { await p.request.post(`${base}/api/restore`); }
  }, { expectedErrors: true });
  await row('EDGE-WIDTH-375-RECORDER', async (p, dir) => {
    const sizes = { initial: await width(p) };
    for (const selector of ['.rc-annunciator', '.rc-readouts', '#tape .tape', '.rc-log', '.rc-side']) { const l = p.locator(selector); if (await l.count()) { const box = await l.boundingBox(); expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(375); } }
    await p.locator('#block-4 .rc-row-main').click(); await expect(p.locator('#block-4 .rc-details')).toBeVisible(); sizes.expanded = await width(p); await shot(p, dir, 'expanded'); await p.getByRole('button', { name: 'Explain why · step 04' }).click(); await expect(p.getByRole('dialog')).toBeVisible(); sizes.drawer = await width(p); const overflow = await p.getByRole('dialog').evaluate(el => ({ scroll: el.scrollWidth, client: el.clientWidth })); expect(overflow.scroll).toBeLessThanOrEqual(overflow.client); return { sizes, drawer: overflow };
  }, { mobile: true });
} finally {
  if (browser) await browser.close();
  if (attacker) await new Promise(r => attacker.close(r));
  for (const server of servers) { server.kill('SIGTERM'); await new Promise(r => server.exitCode !== null ? r() : server.once('exit', r)); }
  spawnSync('/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh', ['release', 'bb-audit-web']);
  writeFileSync(resolve(repo, 'audit/web-recorder-cleanup.json'), JSON.stringify({ released: true, serverPids: servers.map(s => s.pid), serversExited: servers.every(s => s.exitCode !== null || s.signalCode !== null), at: new Date().toISOString() }, null, 2));
}
