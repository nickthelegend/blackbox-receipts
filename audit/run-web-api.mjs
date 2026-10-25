// Targeted manual API audit. No Playwright test runner and no response stubs.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';

const repo = process.cwd(), out = resolve('audit/web');
const state = await fs.mkdtemp('/private/tmp/blackbox-api-audit-');
const store = join(state, 'session');
await fs.mkdir(store);
const env = { ...process.env, RECEIPTS_DIR: store, BLACKBOX_KEY_DIR: join(state, 'keys'), NEXT_TELEMETRY_DISABLED: '1' };
for (const name of Object.keys(env)) if (/^(ZETARIS_|METERLESS_|WALRUS_|RECEIPTS_SIGNING_KEY$|BLACKBOX_DASHBOARD_ALLOW_REMOTE$)/.test(name)) delete env[name];
const require = createRequire(join(repo, 'apps/web/package.json'));
const next = join(dirname(require.resolve('next/package.json')), 'dist/bin/next');
const selected = new Set(process.argv.slice(2));
const prefix = selected.size ? 'recheck-' : '';
const results = selected.size ? JSON.parse(await fs.readFile(join(out,'results.json'),'utf8')) : [];
const allConsole = selected.size ? JSON.parse(await fs.readFile(join(out,'console-all.json'),'utf8')) : [];
const observed = [];

let server, browser, context, page, origin, active = 'startup', phase = 0;
let chromePids = [], serverPids = [], cleaning;
async function cleanup() {
  cleaning ??= (async()=>{
    try {
      try { if(browser)await browser.close(); } finally { await stop(); }
      await fs.writeFile(join(out,'console-all.json'),JSON.stringify(allConsole,null,2)+'\n');
      await fs.writeFile(join(out,'results.json'),JSON.stringify(results,null,2)+'\n');
      const alive = [...chromePids,...serverPids].filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
      await fs.appendFile(join(out,'lifecycle.log'),`${new Date().toISOString()} Chrome PIDs=${chromePids.join(',')}; Next PIDs=${serverPids.join(',')}; stillAlive=${JSON.stringify(alive)}; temporary state removed.\n`);
      if(alive.length)throw new Error('Owned processes still alive: '+alive.join(','));
    } finally {
      await fs.rm(state,{recursive:true,force:true});
      const release=spawnSync('/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh',['release','bb-audit-web']);
      await fs.appendFile(join(out,'lifecycle.log'),`${new Date().toISOString()} heavy slot bb-audit-web release exit=${release.status}\n`);
    }
  })();
  return cleaning;
}
for(const signal of ['SIGINT','SIGTERM','SIGHUP'])process.once(signal,()=>{void cleanup().finally(()=>process.exit(1));});
const freePort = () => new Promise((ok, fail) => { const s = net.createServer(); s.on('error', fail); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const stop = async () => { if (server && server.exitCode === null) { server.kill('SIGTERM'); await new Promise(r => server.once('exit', r)); } };
async function start(extra = {}) {
  await stop();
  const port = await freePort(); origin = `http://127.0.0.1:${port}`;
  const log = await fs.open(join(out, `${prefix}server-${++phase}.log`), 'w');
  server = spawn(process.execPath, [next, 'start', '-H', '127.0.0.1', '-p', String(port)], { cwd: join(repo, 'apps/web'), env: { ...env, ...extra }, stdio: ['ignore', log.fd, log.fd] });
  serverPids.push(server.pid);
  await log.close();
  await fs.appendFile(join(out, 'lifecycle.log'), `${new Date().toISOString()} next start pid=${server.pid} origin=${origin} throwawayStore=${store} vars=${JSON.stringify(extra)}\n`);
  for (let n = 0; n < 100; n++) {
    if (server.exitCode !== null) throw new Error('dashboard exited');
    try { await new Promise((ok, fail) => { const s = net.connect({ host: '127.0.0.1', port }, () => { s.end(); ok(); }); s.on('error', fail); }); return; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  throw new Error('dashboard readiness timed out');
}
function call(tool, args, fresh = false, denied = false) {
  const run = spawnSync(process.execPath, [join(repo, 'packages/proxy/dist/call.js'), ...(fresh ? ['--new-session'] : []), tool, JSON.stringify(args)], { cwd: repo, env, encoding: 'utf8' });
  // Do not save tool content or any key material; only invocation and exit status.
  if ((run.status !== 0) !== denied) throw new Error(`real proxy call ${tool}: unexpected exit ${run.status}`);
  return fs.appendFile(join(out, 'fixture.log'), `${new Date().toISOString()} real MCP ${tool} ${JSON.stringify(args)} exit=${run.status}${denied ? ' denied before disk read' : ''}\n`);
}
async function open(url = `${origin}/recorder`) {
  if (context) await context.close();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
  page = await context.newPage();
  page.on('console', m => allConsole.push({ id: active, type: m.type(), text: m.text(), location: m.location() }));
  page.on('response', r => observed.push({ id:active, url:r.url(), status:r.status(), method:r.request().method() }));
  page.on('pageerror', e => allConsole.push({ id: active, type: 'pageerror', text: e.message }));
  await page.goto(url, { waitUntil: 'networkidle' });
}
const reqs = [];
async function request(path, method = 'GET', body, forbidden) {
  if (forbidden) {
    // Chromium recomputes forbidden Fetch Metadata headers even after CDP interception.
    // The middleware rows explicitly require artificial incoming headers, so use the
    // live Playwright page's request client (same real server, no response stubs).
    const headers = Object.fromEntries(Object.entries(forbidden).filter(([,v]) => v !== null));
    const response = await page.request.fetch(new URL(path,page.url()).href, { method, headers });
    const result = { url:response.url(), status:response.status(), headers:response.headers(), text:await response.text(), request:{ method,path,headers,omitted:Object.entries(forbidden).filter(([,v])=>v===null).map(([k])=>k) }, transport:'Playwright page.request; artificial middleware headers', wire:[] };
    result.body = JSON.parse(result.text); reqs.push(result); return result;
  }
  const c = await context.newCDPSession(page), wire = [];
  await c.send('Network.enable');
  c.on('Network.requestWillBeSentExtraInfo', e => wire.push({ requestId: e.requestId, headers: e.headers }));
  const result = await page.evaluate(async ({ path, method, body }) => {
    const res = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), cache: 'no-store' });
    return { url: res.url, status: res.status, headers: Object.fromEntries(res.headers), text: await res.text() };
  }, { path, method, body });
  await new Promise(r => setTimeout(r, 100));
  result.body = JSON.parse(result.text); result.request = { method, path, ...(body === undefined ? {} : { body }), ...(forbidden ? { forbidden } : {}) }; result.wire = wire;
  await c.detach();
  reqs.push(result); return result;
}
const status = (r,s) => assert.equal(r.status,s);
const exact = (r,s,body) => { status(r,s); assert.deepEqual(r.body,body); };
const str = v => assert.equal(typeof v, 'string');
async function item(id, work, setup = '') {
  if(selected.size && !selected.has(id))return;
  active = id; reqs.length = 0; const before = allConsole.length, responseStart = observed.length;
  const dir = join(out,id); await fs.mkdir(dir,{recursive:true});
  let error;
  try { await work(); } catch(e) { error = e.message; }
  await page.screenshot({path:join(dir,'screenshot.png'), fullPage:false});
  const messages = allConsole.slice(before);
  await fs.writeFile(join(dir,'console.log'), messages.length ? messages.map(m=>JSON.stringify(m)).join('\n')+'\n' : 'No console messages or uncaught page errors.\n');
  await fs.writeFile(join(dir,'network.log'), JSON.stringify({ id, timestamp:new Date().toISOString(), browser:await browser.version(), page:page.url(), setup, requests:[...reqs], browserResponses:observed.slice(responseStart), assertion:error ?? 'PASS' },null,2)+'\n');
  const expected = {
    'API-POST-ANCHOR-UNCONFIGURED':503, 'API-POST-TAMPER-INVALID-STEP':400,
    'API-POST-TAMPER-OUT-OF-BOUNDS':409, 'API-POST-RESTORE-ERROR':409,
    'API-GET-SESSION-CORRUPT':409, 'API-POST-PROVE-CORRUPT':409,
    'API-GET-EXPLAIN-CORRUPT':409, 'API-GET-EXPLAIN-ERROR':500,
    'API-MIDDLEWARE-CROSS-SITE-SEC-FETCH':403, 'API-MIDDLEWARE-CROSS-ORIGIN-HEADER':403,
    'API-MIDDLEWARE-OPAQUE-ORIGIN':403, 'API-MIDDLEWARE-NON-LOOPBACK-HOST':403,
    'API-POST-ANCHOR-NETWORK-FAIL':502, 'API-POST-ANCHOR-CORRUPT':409, 'API-POST-ANCHOR-EMPTY':409,
  }[id];
  const allowedDiagnostic = m => {
    const match = m.text.match(/^Failed to load resource: the server responded with a status of (\d{3})(?: \(.*\))?$/);
    return Boolean(match && Number(match[1]) === expected && reqs.some(r=>r.status===expected && r.url===m.location?.url));
  };
  if (messages.some(m => m.type === 'pageerror' || (m.type === 'error' && !allowedDiagnostic(m)))) error = [error,'Unexpected dashboard console/page error (see console.log)'].filter(Boolean).join('; ');
  if(observed.slice(responseStart).some(r=>r.status>=400 && (r.status!==expected || !reqs.some(q=>q.url===r.url && q.status===r.status)))) error = [error,'Unexpected HTTP error response'].filter(Boolean).join('; ');
  const diagnostics = messages.filter(m => m.type === 'error').length;
  const file=join(dir,'network.log');const evidence=JSON.parse(await fs.readFile(file,'utf8'));evidence.assertion=error??'PASS';evidence.consoleRule='Only native Chrome resource diagnostics for this row’s required status and request URL are allowed.';await fs.writeFile(file,JSON.stringify(evidence,null,2)+'\n');
  const oldIndex=results.findIndex(r=>r.id===id);if(oldIndex!==-1)results.splice(oldIndex,1);
  results.push({id,status:error?'FAIL':'PASS',error,diagnostics});
  console.log(`${id} ${error?'FAIL: '+error:'PASS'}${diagnostics ? ` (console resource diagnostics: ${diagnostics})` : ''}`);
}
const corrupt = (r,label='session.jsonl',line=2) => {status(r,409); assert.equal(r.body.corruptLine,line);assert.ok(r.body.error.startsWith(`${label} is corrupt at line ${line}: `));assert.deepEqual(Object.keys(r.body).sort(),['corruptLine','error']);};
try {
  await call('git',{action:'log'},true);
  await call('read_file',{path:'README.md'});
  await call('shell',{command:'pwd'});
  const session = await fs.readFile(join(store,'session.jsonl'),'utf8');
  const witnesses = await fs.readFile(join(store,'witness.jsonl'),'utf8');
  await start();
  browser = await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP blackbox.test 127.0.0.1','--no-proxy-server']});
  const browserCdp = await browser.newBrowserCDPSession();
  chromePids=(await browserCdp.send('SystemInfo.getProcessInfo')).processInfo.map(p=>p.id);
  await browserCdp.detach();
  await open();
  await item('API-GET-SESSION-SUCCESS', async()=>{
    const r=await request('/api/session'); status(r,200); const b=r.body;
    for (const k of ['sessionId','root','publicKey','source']) str(b[k]);
    assert.equal(b.receipts.length,3); assert.deepEqual(b.chain,{valid:true,brokenAt:null,reason:null}); assert.equal(b.walrus,null); assert.equal(b.walrusConfigured,false); assert.deepEqual(b.tampered,[]);
    for(const receipt of b.receipts){ for(const k of ['sessionId','timestamp','tool','argsHash','outcome','resultHash','hash','signature'])str(receipt[k]);assert.equal(typeof receipt.step,'number');assert.equal(typeof receipt.secretsAccessed,'boolean');assert.ok(Array.isArray(receipt.paths));assert.ok(Array.isArray(receipt.permissions));assert.equal(receipt.cost,null);assert.equal(receipt.approver,null);assert.ok(receipt.previousHash===null || typeof receipt.previousHash==='string'); }
  });
  await item('API-POST-PROVE-PASS',async()=>{
    const r=await request('/api/prove','POST');status(r,200);const b=r.body;
    assert.equal(b.status,'PASS');assert.equal(b.step,null);assert.equal(b.reason,null);assert.equal(b.policyId,'no-secrets-read/v2');str(b.sessionRoot);assert.equal(b.chainBrokenAt,null);assert.equal(b.steps,3);str(b.root);
    const p=b.proof; assert.equal(p.format,'blackbox-property-proof/v1');assert.equal(p.policyId,'no-secrets-read/v2');assert.equal(p.count,3);for(const k of ['sessionId','policyHash','root','publicKey'])str(p[k]);assert.equal(p.leaves.length,3);assert.equal(p.commitments.length,3);
    for(const l of p.leaves){assert.equal(typeof l.step,'number');for(const k of ['leafHash','receiptHash','signature'])str(l[k]);assert.ok(l.inclusionPath.every(h=>typeof h==='string'));}for(const c of p.commitments){assert.equal(typeof c.step,'number');str(c.commitment);str(c.opening);}
    const { verifyPropertyProof, stableJson, sha256Hex } = await import('../packages/verify/dist/core.js');
    assert.equal(verifyPropertyProof(p,p.publicKey).valid,true);
    const receipts=JSON.parse((await request('/api/session')).text).receipts;
    for(const c of p.commitments){const receipt=receipts.find(r=>r.step===c.step);assert.equal(c.commitment,sha256Hex(stableJson({property:p.property,policyHash:p.policyHash,step:c.step,leaf:receipt.hash,argsHash:receipt.argsHash,verdict:'pass',salt:c.opening})));}
    assert.ok(!JSON.stringify(p).includes('README.md'));
  });
  await item('API-GET-EXPLAIN-SUCCESS',async()=>{const r=await request('/api/explain');status(r,200);for(const k of ['sessionId','verdict','policyId'])str(r.body[k]);assert.equal(r.body.steps.length,3);for(const s of r.body.steps){assert.equal(typeof s.step,'number');for(const k of ['receipt','timestamp','command','outcome'])str(s[k]);assert.ok(['allowed','tool-error','violation','untrusted','unchecked'].includes(s.finding));assert.ok(s.detail===null||typeof s.detail==='string');assert.ok(s.why.every(v=>typeof v==='string'));for(const c of s.cites){assert.equal(typeof c.step,'number');for(const k of ['role','hash','note'])str(c[k]);}}});
  await item('API-GET-INTEGRATIONS-UNCONFIGURED',async()=>{ for(const name of ['Zetaris','Meterless'])assert.equal(await page.locator('.rc-lamp').filter({hasText:name}).locator('b').textContent(),'Setup required'); exact(await request('/api/integrations'),200,{integrations:[{name:'Zetaris',ok:false,detail:'Zetaris not configured: missing ZETARIS_API_KEY, ZETARIS_ORG_ID. Create an API key in the Zetaris Console and get your Org ID from Zetaris Support/Admin, then set them in .env.local.'},{name:'Meterless',ok:false,detail:'Meterless not configured: set METERLESS_TOKEN, or METERLESS_STATE_DIR (the runtime writes its token to <stateDir>/proxy-token). Meterless runs locally; there is no hosted API key.'}]}); },'All ZETARIS_* and METERLESS_* variables removed from server environment.');
  await item('API-POST-ANCHOR-UNCONFIGURED',async()=>exact(await request('/api/anchor','POST'),503,{error:'Walrus is not configured. Set WALRUS_PUBLISHER_URL to a funded publisher endpoint.'}),'WALRUS_PUBLISHER_URL unset.');
  await item('API-POST-TAMPER-SUCCESS',async()=>{exact(await request('/api/tamper','POST',{step:2}),200,{editedStep:2});const edited=await fs.readFile(join(store,'session.jsonl'),'utf8');assert.notEqual(edited,session);assert.equal(JSON.parse(edited.trim().split('\n')[1]).tool,'read_file-edited');const backup=JSON.parse(await fs.readFile(join(store,'tamper-backup.json'),'utf8'));assert.equal(Object.values(backup)[0].line,session.trim().split('\n')[1]);},'Compare disk receipt and real backup with the original signed proxy session.');
  await item('API-POST-TAMPER-DEFAULT-BODY',async()=>{exact(await request('/api/tamper','POST'),200,{editedStep:1});exact(await request('/api/tamper','POST',{}),200,{editedStep:1});assert.equal(JSON.parse((await fs.readFile(join(store,'session.jsonl'),'utf8')).trim().split('\n')[0]).tool,'git-edited');},'Both omitted body and empty JSON object.');
  await item('API-POST-TAMPER-INVALID-STEP',async()=>{for(const step of [0,-1,'abc'])exact(await request('/api/tamper','POST',{step}),400,{error:`Block step must be a positive integer, got "${step}".`});});
  await item('API-POST-TAMPER-OUT-OF-BOUNDS',async()=>exact(await request('/api/tamper','POST',{step:999}),409,{error:'There is no block 999 in the current log (it has 3).'}));
  await item('API-POST-RESTORE-SUCCESS',async()=>{exact(await request('/api/restore','POST'),200,{restoredSteps:[1,2]});assert.equal(await fs.readFile(join(store,'session.jsonl'),'utf8'),session);await assert.rejects(fs.stat(join(store,'tamper-backup.json')));});
  await item('API-POST-RESTORE-ERROR',async()=>exact(await request('/api/restore','POST'),409,{error:'Nothing to restore: no block has been tampered with.'}),'Backup is absent after successful restore; no store permissions changed.');
  // A denied synthetic secret path does not exist and the guard refuses it before any disk read.
  await call('read_file',{path:'secrets/blackbox-audit-does-not-exist.txt'},false,true);
  await item('API-POST-PROVE-FAIL',async()=>{const r=await request('/api/prove','POST');status(r,200);assert.equal(r.body.status,'FAIL');assert.equal(r.body.step,4);assert.ok(r.body.reason.includes('secrets/**'));assert.equal(r.body.policyId,'no-secrets-read/v2');str(r.body.sessionRoot);assert.equal(r.body.chainBrokenAt,null);},'Real MCP proxy denied a nonexistent secrets/ path before filesystem access at step 4.');
  await fs.writeFile(join(store,'session.jsonl'),session);await fs.writeFile(join(store,'witness.jsonl'),witnesses);
  // Use the dashboard landing page during destructive store scenarios to avoid background polling.
  await open(`${origin}/`);
  await fs.writeFile(join(store,'session.jsonl'),session.split('\n')[0]+'\n{not-json\n');
  await item('API-GET-SESSION-CORRUPT',async()=>corrupt(await request('/api/session')),'Temporary session.jsonl line 2 is invalid JSON.');
  await item('API-POST-PROVE-CORRUPT',async()=>{corrupt(await request('/api/prove','POST'));await fs.writeFile(join(store,'session.jsonl'),session);await fs.writeFile(join(store,'witness.jsonl'),witnesses.split('\n')[0]+'\n{not-json\n');corrupt(await request('/api/prove','POST'),'witness.jsonl');await fs.writeFile(join(store,'witness.jsonl'),witnesses);await fs.writeFile(join(store,'session.jsonl'),session.split('\n')[0]+'\n{not-json\n');},'Session and witness corrupt line 2 are checked separately.');
  await item('API-GET-EXPLAIN-CORRUPT',async()=>corrupt(await request('/api/explain')),'Temporary session.jsonl line 2 is invalid JSON.');
  await fs.writeFile(join(store,'session.jsonl'),session);
  await fs.rename(join(store,'witness.jsonl'),join(store,'witness.saved'));await fs.mkdir(join(store,'witness.jsonl'));
  await item('API-GET-EXPLAIN-ERROR',async()=>{const r=await request('/api/explain');status(r,500);assert.ok(r.body.error.startsWith('Could not explain the session: '));assert.ok(r.body.error.includes('EISDIR'));},'Replace throwaway witness path with a directory to cause a real EISDIR store read error.');
  await fs.rmdir(join(store,'witness.jsonl'));await fs.rename(join(store,'witness.saved'),join(store,'witness.jsonl'));
  await item('API-MIDDLEWARE-CROSS-SITE-SEC-FETCH',async()=>exact(await request('/api/session','GET',undefined,{'Sec-Fetch-Site':'cross-site',Origin:'http://evil.example'}),403,{error:"The Blackbox dashboard API only answers the dashboard's own pages and refused a cross-site request from http://evil.example."}),'Playwright page.request sends exact Sec-Fetch-Site and Origin; browser/CDP cannot override Fetch Metadata. No response stubs.');
  await item('API-MIDDLEWARE-CROSS-ORIGIN-HEADER',async()=>exact(await request('/api/session','GET',undefined,{'Sec-Fetch-Site':null,Origin:'http://evil.example'}),403,{error:"The Blackbox dashboard API only answers the dashboard's own pages and refused a cross-origin request from http://evil.example."}),'Playwright page.request omits Sec-Fetch-Site and sends Origin: http://evil.example.');
  await item('API-MIDDLEWARE-OPAQUE-ORIGIN',async()=>exact(await request('/api/session','GET',undefined,{'Sec-Fetch-Site':null,Origin:'null'}),403,{error:"The Blackbox dashboard API only answers the dashboard's own pages and refused a request from an opaque origin."}),'Playwright page.request omits Sec-Fetch-Site and sends literal Origin: null.');
  await open(`${origin.replace('127.0.0.1','blackbox.test')}/`);
  await item('API-MIDDLEWARE-NON-LOOPBACK-HOST',async()=>exact(await request('/api/session'),403,{error:'The Blackbox dashboard API is local-only and refused a request for host "blackbox.test". Open it at http://localhost:3000, or set BLACKBOX_DASHBOARD_ALLOW_REMOTE=1 on a trusted network.'}),'Real Chrome URL blackbox.test resolves to 127.0.0.1; wire Host includes its dynamic port. Remote override unset.');
  await context.tracing.stop({path:join(out,prefix+'trace-unconfigured.zip')});await context.close();context=null;
  const closed = await freePort();
  await start({ WALRUS_PUBLISHER_URL:`http://127.0.0.1:${closed}`, BLACKBOX_DASHBOARD_ALLOW_REMOTE:'1' });
  await open();
  await item('API-POST-ANCHOR-NETWORK-FAIL',async()=>{const r=await request('/api/anchor','POST');status(r,502);assert.ok(r.body.error.startsWith('Walrus publisher request failed: '));await assert.rejects(fs.stat(join(store,'walrus.json')));},`WALRUS_PUBLISHER_URL=http://127.0.0.1:${closed} is a closed local port. No publisher server or upload. Only the network-throw branch is exercised.`);
  await open(`${origin}/`);
  await fs.writeFile(join(store,'session.jsonl'),session.split('\n')[0]+'\n{not-json\n');
  await item('API-POST-ANCHOR-CORRUPT',async()=>corrupt(await request('/api/anchor','POST')),'Loopback publisher configured only to pass the unset check; corrupt log returns before fetch.');
  await fs.writeFile(join(store,'session.jsonl'),'');
  await item('API-POST-ANCHOR-EMPTY',async()=>exact(await request('/api/anchor','POST'),409,{error:'There are no session receipts to anchor.'}),'Loopback publisher configured only to pass the unset check; empty store returns before fetch.');
  await fs.writeFile(join(store,'session.jsonl'),session);
  await open(`${origin.replace('127.0.0.1','blackbox.test')}/`);
  await item('API-MIDDLEWARE-ALLOW-REMOTE',async()=>{const r=await request('/api/session');status(r,200);assert.equal(r.body.receipts.length,3);assert.equal(r.body.chain.valid,true);},'BLACKBOX_DASHBOARD_ALLOW_REMOTE=1; real Chrome URL sends non-loopback Host blackbox.test.');
  await open();
  await item('API-DELETE-SESSION',async()=>{const r=await request('/api/session','DELETE');status(r,200);assert.equal(r.body.ok,true);str(r.body.archived);assert.ok(r.body.archived.startsWith(join(store,'sessions')+'/'));assert.equal(await fs.readFile(r.body.archived,'utf8'),session);assert.equal(await fs.readFile(join(store,'session.jsonl'),'utf8'),'');assert.equal(await fs.readFile(join(store,'witness.jsonl'),'utf8'),'');},'Verify archive contents byte-for-byte against real signed receipts and active files reset.');
  await context.tracing.stop({path:join(out,prefix+'trace-loopback.zip')});
} finally {
  await cleanup();
}
