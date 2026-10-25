#!/usr/bin/env node
// Reproduce the CLI audit using built artifacts and real stdio processes. No live sponsors.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'blackbox-cli-audit-')));
const evidence = join(root, 'audit/cli');
mkdirSync(evidence, { recursive: true });
const canonical = readFileSync(join(root, 'AUDIT.md'), 'utf8').split('\n').filter(x => /^\| (CLI|MCP|EXT|SCRIPT)-/.test(x));
const ids = canonical.map(x => x.split('|')[1].trim());
const results = new Map(ids.map(id => [id, { status: 'FAIL', errors: ['not executed'] }]));
const allowed = ['PATH', 'HOME', 'TMPDIR', 'SHELL', 'LANG', 'LC_ALL', 'SYSTEMROOT'];
const cleanEnv = Object.fromEntries(allowed.filter(k => process.env[k]).map(k => [k, process.env[k]]));
const defaults = { ...cleanEnv, RECEIPTS_DIR: join(temp, 'default-store'), BLACKBOX_KEY_DIR: join(temp, 'default-keys') };
// Do not propagate ambient credentials or policy/model overrides to any subprocess.
for (const key of Object.keys(process.env)) if (!allowed.includes(key)) delete process.env[key];
Object.assign(process.env, defaults);
const cliPath = join(root, 'packages/proxy/dist/cli.js');
const callPath = join(root, 'packages/proxy/dist/call.js');
const serverPath = join(root, 'packages/proxy/dist/server.js');
const log = (id, text) => appendFileSync(join(evidence, `${id}.txt`), text + '\n');
for (const id of ids) writeFileSync(join(evidence, `${id}.txt`), `ID: ${id}\nAudit temp root: ${temp}\n`);
function check(id, fn) {
  try { fn(); log(id, 'ASSERTION: PASS'); }
  catch (e) { results.get(id).errors.push(e.message); log(id, `ASSERTION: FAIL ${e.message}`); }
}
function begin(id) { if (results.get(id).errors[0] === 'not executed') results.get(id).errors = []; }
function run(id, command, args, options = {}) {
  begin(id);
  const env = Object.fromEntries(Object.entries({ ...defaults, ...options.env }).filter(([, v]) => v !== undefined));
  const r = spawnSync(command, args, { cwd: options.cwd ?? temp, env, encoding: 'utf8', timeout: 120000, maxBuffer: 20_000_000 });
  const result = { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', signal: r.signal, error: r.error?.message };
  log(id, `COMMAND: ${command} ${JSON.stringify(args)}\nCWD: ${options.cwd ?? temp}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}\nEXIT CODE: ${result.code}\nSIGNAL: ${r.signal ?? 'none'}${r.error ? `\nSPAWN ERROR: ${r.error.message}` : ''}`);
  if (options.code !== undefined) check(id, () => assert.equal(result.code, options.code));
  const out = result.stdout + result.stderr;
  for (const match of options.matches ?? []) check(id, () => match instanceof RegExp ? assert.match(out, match) : assert.ok(out.includes(match), `missing ${match}`));
  if (options.noStack) check(id, () => assert.doesNotMatch(out, /\n\s+at |\n(?:Syntax|Type|Range)Error:/));
  return result;
}
function cli(id, ws, args, code, matches = [], env = {}, noStack = false) { return run(id, process.execPath, [cliPath, ...args], { cwd: ws.cwd, env: { ...ws.env, ...env }, code, matches, noStack }); }
function workspace(label) {
  const cwd = join(temp, label); mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, 'small.txt'), 'small\n');
  return { cwd, env: { RECEIPTS_DIR: join(temp, `${label}-store`), BLACKBOX_KEY_DIR: join(temp, `${label}-keys`) } };
}
const readLog = ws => readFileSync(join(ws.env.RECEIPTS_DIR, 'session.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
function receipts(id, ws, fn) { const r = readLog(ws); log(id, `SIGNED RECEIPTS:\n${JSON.stringify(r, null, 2)}`); check(id, () => fn(r)); }
function git(ws, ...args) { const r = spawnSync('git', args, { cwd: ws.cwd, env: defaults, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
function initGit(ws) { git(ws, 'init', '-q'); git(ws, 'config', 'user.name', 'Audit'); git(ws, 'config', 'user.email', 'audit@blackbox.invalid'); git(ws, 'add', 'small.txt'); git(ws, 'commit', '-qm', 'audit base'); return git(ws, 'rev-parse', 'HEAD'); }
async function proxy(ws, initialId, extra = [], env = {}) {
  let active = initialId;
  const usedIds = new Set([initialId]);
  let stderr = '';
  begin(active);
  const proc = spawn(process.execPath, [serverPath, ...extra], { cwd: ws.cwd, env: { ...defaults, ...ws.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  log(active, `COMMAND: node ${serverPath} ${JSON.stringify(extra)}\nCWD: ${ws.cwd}`);
  let serial = 0; const pending = new Map();
  proc.stderr.on('data', d => { stderr += d; log(active, `STDERR: ${d}`); });
  createInterface({ input: proc.stdout }).on('line', line => {
    log(active, `STDOUT: ${line}`);
    const message = JSON.parse(line); const item = pending.get(message.id);
    if (item) { pending.delete(message.id); if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result); }
  });
  const exited = new Promise(resolveExit => proc.on('exit', (code, signal) => { for (const id of usedIds) log(id, `SHARED STDIO PROCESS STDERR:\n${stderr}\nEXIT CODE: ${code}\nSIGNAL: ${signal ?? 'none'}`); resolveExit({ code, signal }); }));
  async function rpc(id, method, params = {}) {
    active = id; begin(id);
    if (!usedIds.has(id)) log(id, `SHARED PROCESS COMMAND: node ${serverPath} ${JSON.stringify(extra)}\nCWD: ${ws.cwd}`);
    usedIds.add(id);
    const request = { jsonrpc: '2.0', id: ++serial, method, params };
    log(id, `STDIN: ${JSON.stringify(request).slice(0, 2000)}${JSON.stringify(request).length > 2000 ? ' [large fixture request truncated]' : ''}`);
    const response = new Promise((resolve, reject) => { const timer = setTimeout(() => { pending.delete(request.id); reject(new Error(`RPC timed out: ${method}`)); }, 15000); pending.set(request.id, { resolve: x => { clearTimeout(timer); resolve(x); }, reject: e => { clearTimeout(timer); reject(e); } }); });
    proc.stdin.write(JSON.stringify(request) + '\n'); return response;
  }
  await rpc(active, 'initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'audit', version: '1' }, capabilities: {} });
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  return {
    rpc,
    async call(id, name, args, error = false, expected) { const r = await rpc(id, 'tools/call', { name, arguments: args }); check(id, () => assert.equal(Boolean(r.isError), error)); if (expected !== undefined) check(id, () => expected instanceof RegExp ? assert.match(r.content[0].text, expected) : assert.equal(r.content[0].text, expected)); return r; },
    async close(id = active) { active = id; proc.kill('SIGTERM'); const r = await exited; check(id, () => assert.equal(r.code, 0)); },
  };
}
const policy = '[policy no-secrets-read/v2 d1e72d1a6c22]';
const pass = `PASS no-secrets-read ${policy}:`;
const fail = `FAIL no-secrets-read ${policy}:`;
const wrongKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();

async function execute() {
  begin('CLI-001'); log('CLI-001', `Built CLI ${cliPath}; stdio proxy ${serverPath}; all stores/keys/output under ${temp}; RECEIPTS_SIGNING_KEY and sponsor variables removed, ambient overrides removed. pnpm install --frozen-lockfile and pnpm build exited 0; see build.txt.`);
  copyFileSync('/private/tmp/blackbox-cli-build.txt', join(evidence, 'build.txt'));
  const clean = workspace('clean'); const base = initGit(clean);
  const p = await proxy(clean, 'MCP-001');
  const listed = await p.rpc('MCP-001', 'tools/list');
  check('MCP-001', () => assert.deepEqual(listed.tools.map(t => t.name), ['read_file', 'write_file', 'git', 'shell', 'blackbox_explain']));
  await p.call('MCP-001', 'read_file', { path: 'small.txt' }, false, 'small\n');
  receipts('MCP-001', clean, r => { assert.equal(r[0].outcome, 'ok'); assert.deepEqual(r[0].permissions, ['workspace:file:read']); });
  // Live verification while the real proxy is running: no seal yet.
  cli('CLI-002', clean, [], 0, ['"valid": true', '"brokenAt": null', '"reason": null', 'none yet (written when the proxy shuts down)']);
  for (let i = 0; i < 7; i++) await p.call('CLI-001', 'shell', { command: 'pwd' });
  await p.close('CLI-001');
  cli('CLI-002', clean, ['verify'], 0, ['"valid": true']);
  begin('CLI-001'); check('CLI-001', () => assert.ok(clean.env.RECEIPTS_DIR.startsWith(temp)));
  const empty = workspace('empty');
  cli('CLI-003', empty, ['verify'], 1, ['"valid": false', '"brokenAt": null', '"reason": "No receipts exist for this session"', '"receipts": 0', '"sessionId": null']);
  const proof = join(temp, 'proof.json');
  cli('CLI-006', clean, ['prove', '--out', proof], 0, [`${pass} 8/8 receipts satisfy the policy`, 'root ', `proof written to ${proof} (inclusion paths and commitments only; no raw arguments)`]);
  cli('CLI-007', empty, ['prove', '--out', join(temp, 'empty-proof.json')], 1, [`${fail} No receipts exist for this session, so there is nothing to prove`]);
  check('CLI-007', () => assert.ok(!existsSync(join(temp, 'empty-proof.json'))));
  cli('CLI-010', clean, ['prove-no-secrets', '--out', join(temp, 'alias-proof.json')], 0, [`${pass} 8/8 receipts satisfy the policy`, 'inclusion paths and commitments only; no raw arguments']);
  cli('CLI-011', empty, ['prove-no-secrets'], 1, [`${fail} No receipts exist for this session, so there is nothing to prove`]);
  const exp = join(temp, 'clean-export');
  cli('CLI-015', clean, ['export', exp], 0, [`${pass} 8/8 receipts satisfy the policy`, 'exported 8 receipts to ../clean-export']);
  check('CLI-015', () => { assert.deepEqual(readdirSync(exp).sort(), ['proof-no-secrets.json', 'public-key.pem', 'result.txt', 'seal.json', 'session.jsonl']); });
  const publicKey = readFileSync(join(exp, 'public-key.pem'), 'utf8');
  cli('CLI-018', clean, ['verify-export', exp], 0, [pass, '8 receipts, chain intact, seal matches, proof verified under root'], { BLACKBOX_PUBLIC_KEY: publicKey });
  const emptyExp = join(temp, 'empty-export');
  cli('CLI-016', empty, ['export', emptyExp], 1, [`${fail} No receipts exist for this session, so there is nothing to prove`, 'exported 0 receipts to ../empty-export']);
  check('CLI-016', () => assert.deepEqual(readdirSync(emptyExp).sort(), ['public-key.pem', 'result.txt', 'session.jsonl']));
  cli('CLI-019', empty, ['verify-export'], 1, [`${fail} no exported sessions found under receipts/`]);
  cli('CLI-019', empty, ['verify-export', emptyExp], 1, [fail, 'No receipts exist for this session, so there is nothing to prove', '[']);
  const proofData = JSON.parse(readFileSync(proof, 'utf8'));
  cli('CLI-023', clean, ['verify-proof', proof, '--public-key', join(exp, 'public-key.pem'), '--root', proofData.root], 0, [`${pass} 8 receipts proven under root ${proofData.root}`]);
  const badProof = structuredClone(proofData);
  // Locate the inclusion path in the actual bundle, not a fabricated proof format.
  log('CLI-024', `Proof top-level fields: ${Object.keys(badProof).join(', ')}`);
  badProof.steps[1].inclusion[0].hash = '0'.repeat(64);
  const badProofFile = join(temp, 'bad-proof.json'); writeFileSync(badProofFile, JSON.stringify(badProof));
  cli('CLI-024', clean, ['verify-proof', badProofFile], 1, ['FAIL no-secrets-read at step 2', 'Merkle inclusion proof does not reach the session root']);
  cli('CLI-024', clean, ['verify-proof', proof, '--root', '0'.repeat(64)], 1, [`${fail} Proof root does not match the expected session root`]);
  cli('CLI-025', clean, ['verify-proof', join(temp, 'absent-proof')], 1, [fail, 'Cannot read proof', 'ENOENT']);
  const disclosure = cli('CLI-026', clean, ['disclose', '1'], 0);
  check('CLI-026', () => { const d = JSON.parse(disclosure.stdout); assert.equal(d.step, 1); for (const k of ['receipt', 'args', 'argsSalt', 'salt']) assert.ok(k in d); assert.deepEqual(d.args, { path: 'small.txt' }); });
  cli('CLI-027', empty, ['disclose', '1'], 1, ['RangeError', 'No receipt and arguments exist for step 1']);
  cli('CLI-027', clean, ['disclose', '0'], 1, ['Usage: blackbox-receipts disclose <step>']);
  const md = join(temp, 'explain.md');
  const explained = cli('CLI-028', clean, ['explain', '--out', md], 0, ['# Session ', '**Verdict:**', '## Steps', '## Why']);
  check('CLI-028', () => assert.equal(readFileSync(md, 'utf8'), explained.stdout));
  cli('CLI-029', empty, ['explain'], 0, ['# Session empty session', 'FAIL', 'No tool calls were recorded, so there is nothing to explain.']);
  const structured = cli('CLI-031', clean, ['explain', '--json'], 0);
  check('CLI-031', () => { const d = JSON.parse(structured.stdout); assert.equal(d.format, 'blackbox-explain/v1'); for (const k of ['sessionId','verdict','policy','chain','root','seal','receiptCount','steps','summary']) assert.ok(k in d, k); for (const k of ['finding','why','cites']) assert.ok(k in d.steps[0], k); });
  const emptyJson = cli('CLI-032', empty, ['explain', '--json'], 0);
  check('CLI-032', () => { const d = JSON.parse(emptyJson.stdout); assert.equal(d.sessionId, 'empty session'); assert.equal(d.receiptCount, 0); assert.deepEqual(d.steps, []); assert.equal(d.chain.valid, true); assert.equal(d.verdict, `${fail} No receipts exist for this session, so there is nothing to prove`); });
  cli('CLI-034', clean, ['explain', '--step', '1'], 0, ['# Step 1 of session ', '## Why', '## Cited receipts', 'PASS']);
  const stepJson = cli('CLI-034', clean, ['explain', '--step', '1', '--json'], 0);
  check('CLI-034', () => assert.equal(JSON.parse(stepJson.stdout).step, 1));
  cli('CLI-035', clean, ['explain', '--step', '99'], 1, ['has no step 99 (it has 8 receipts).']);
  const absent = cli('CLI-035', clean, ['explain', '--step', '99', '--json'], 1); check('CLI-035', () => assert.equal(absent.stdout.trim(), 'null'));
  cli('CLI-036', clean, ['explain', '--step', '0'], 2, ['explain --step takes a step number, got "0"']);
  cli('CLI-036', clean, ['explain', '--model', 'other'], 2, ['explain --model supports only "meterless", got "other"']);
  const packFile = join(temp, 'clean-pack.json');
  cli('CLI-037', clean, ['pack', packFile], 0, ['PASS no-secrets-read/v2: 8 receipts, chain intact, seal matches, proof verified', '8 receipts; no private key, no raw arguments']);
  cli('CLI-037', clean, ['pack', join(temp, 'from-pack.json'), '--from', exp], 0, ['PASS no-secrets-read/v2']);
  check('CLI-037', () => assert.equal(JSON.parse(readFileSync(packFile, 'utf8')).format, 'blackbox-pack/v1'));
  cli('CLI-038', empty, ['pack', join(temp, 'empty-pack.json')], 1, [`${fail} No receipts exist for this session, so there is nothing to prove`]);
  check('CLI-038', () => assert.ok(!existsSync(join(temp, 'empty-pack.json'))));
  cli('CLI-041', clean, ['verify-pack', packFile], 0, ['PASS no-secrets-read/v2', '  ok   format:', '  ok   key:', '  ok   chain:', '  ok   seal:', '  ok   property:'], { BLACKBOX_PUBLIC_KEY: publicKey });
  function packVariant(name, mutate) { const d = JSON.parse(readFileSync(packFile, 'utf8')); mutate(d); const f = join(temp, `${name}.json`); writeFileSync(f, JSON.stringify(d)); return f; }
  cli('CLI-042', clean, ['verify-pack'], 1, ['FAIL: cannot read pack (none given):']);
  const garbage = join(temp, 'garbage.json'); writeFileSync(garbage, '{'); cli('CLI-042', clean, ['verify-pack', garbage], 1, ['FAIL: cannot read pack']);
  const object = join(temp, 'object.json'); writeFileSync(object, '{}'); cli('CLI-042', clean, ['verify-pack', object], 1, ['Not a Blackbox pack (expected "format": "blackbox-pack/v1")']);
  cli('CLI-042', clean, ['verify-pack', packVariant('missing', p => delete p.receipts)], 1, ['Pack is missing its receipts or public key']);
  cli('CLI-042', clean, ['verify-pack', packVariant('empty', p => p.receipts = [])], 1, ['FAIL: the pack holds no receipts, so there is nothing to verify']);
  cli('CLI-043', clean, ['verify-pack', packVariant('edited-seven', p => p.receipts[6].tool += '-edited')], 1, ['FAIL at step 7: Receipt contents were changed']);
  cli('CLI-043', clean, ['verify-pack', packVariant('null', p => p.receipts[0] = null)], 1, ['FAIL format at step 1: receipt is not an object']);
  cli('CLI-043', clean, ['verify-pack', packFile], 1, ['FAIL: Pack public key does not match the pinned key'], { BLACKBOX_PUBLIC_KEY: wrongKey });
  const key = cli('CLI-049', clean, ['public-key'], 0);
  check('CLI-049', () => { assert.equal(key.stdout, publicKey); assert.equal(key.stderr, ''); assert.match(key.stdout, /^-----BEGIN PUBLIC KEY-----\n[\s\S]+-----END PUBLIC KEY-----\n$/); });
  const keyFile = join(temp, 'not-directory'); writeFileSync(keyFile, 'fixture');
  cli('CLI-050', clean, ['public-key'], 1, [/EEXIST|ENOTDIR/], { BLACKBOX_KEY_DIR: keyFile });
  cli('CLI-052', empty, ['tamper'], 1, ['Record a real tool call before running the tamper demonstration.']);
  cli('CLI-052', clean, ['tamper', '99'], 1, ['There is no block 99 in the current log (it has 8).']);
  cli('CLI-052', clean, ['tamper', '0'], 1, ['tamper takes a block step number, got "0"']);
  cli('CLI-054', clean, ['restore'], 1, ['Nothing to restore: no block has been tampered with.']);
  cli('CLI-051', clean, ['tamper', '1'], 0, [`Edited block 1 in ${join(clean.env.RECEIPTS_DIR, 'session.jsonl')}. Undo with: restore`]);
  check('CLI-051', () => assert.equal(readLog(clean)[0].tool, 'read_file-edited'));
  cli('CLI-004', clean, ['verify'], 1, ['"valid": false', '"brokenAt": 1', '"reason": "Receipt contents were changed"']);
  cli('CLI-008', clean, ['prove'], 1, [`FAIL no-secrets-read at step 1 ${policy}: Chain verification failed: Receipt contents were changed`]);
  cli('CLI-012', clean, ['prove-no-secrets'], 1, [`FAIL no-secrets-read at step 1 ${policy}: Chain verification failed: Receipt contents were changed`]);
  cli('CLI-029', clean, ['explain'], 0, ['FAIL', 'Nothing from step 1 on can be trusted.']);
  cli('CLI-029', clean, ['explain', '--json'], 0, ['"finding": "untrusted"']);
  cli('CLI-032', clean, ['explain', '--json'], 0, ['FAIL', 'untrusted']);
  cli('CLI-039', clean, ['pack', join(temp, 'tampered-pack.json')], 0, ['FAIL at step 1: Receipt contents were changed', 'pack written to']);
  cli('CLI-053', clean, ['restore'], 0, ['Restored block(s) 1 to their signed originals.']);
  cli('CLI-053', clean, ['verify'], 0, ['"valid": true']);
  cli('CLI-056', clean, ['not-a-command'], 2, ['Usage: blackbox-receipts [verify', 'no-secrets-read/v2']);
  cli('CLI-056', clean, ['verify', '--expect-policy', 'no-secrets-read/v0'], 2, ['--expect-policy no-secrets-read/v0 is neither a published policy (no-secrets-read/v2, no-secrets-read/v1) nor a readable policy file']);
  // Corrupt a copy of the real session, leaving the original reusable.
  const torn = workspace('torn'); cpSync(clean.env.RECEIPTS_DIR, torn.env.RECEIPTS_DIR, { recursive: true });
  torn.env.BLACKBOX_KEY_DIR = clean.env.BLACKBOX_KEY_DIR;
  cli('CLI-055', torn, ['tamper', '1'], 0);
  const tornFile = join(torn.env.RECEIPTS_DIR, 'session.jsonl');
  writeFileSync(tornFile, readFileSync(tornFile, 'utf8').split('\n')[0] + '\n{"step":2');
  const corrupt = 'session.jsonl is corrupt at line 2:';
  const suffix = 'The line is not one JSON record (an append cut short by a killed process, or an edit), so the log cannot be verified past it';
  const tv = cli('CLI-005', torn, ['verify'], 1, [corrupt, suffix], {}, true);
  check('CLI-005', () => { const d = JSON.parse(tv.stdout); assert.equal(d.valid, false); assert.equal(d.brokenAt, 2); assert.equal(d.corruptLine, 2); for (const k of ['receipts','root','sessionId']) assert.equal(d[k], null); assert.equal(d.seal, 'not checked'); });
  for (const [id, args] of [['CLI-009',['prove','--out',join(temp,'torn-proof.json')]], ['CLI-013',['prove-no-secrets']], ['CLI-017',['export',join(temp,'torn-export')]], ['CLI-030',['explain']], ['CLI-033',['explain','--json']], ['CLI-040',['pack',join(temp,'torn-pack.json')]], ['CLI-048',['attest-diff','--base',base]], ['CLI-055',['disclose','1']], ['CLI-055',['tamper','1']], ['CLI-055',['restore']]]) {
    const r = cli(id, torn, args, 1, [corrupt, suffix], {}, true);
    if (id === 'CLI-033') check(id, () => assert.equal(JSON.parse(r.stdout).corruptLine, 2));
  }
  for (const [id, f] of [['CLI-009','torn-proof.json'], ['CLI-017','torn-export'], ['CLI-040','torn-pack.json']]) check(id, () => assert.ok(!existsSync(join(temp, f))));
  // Witness failure and a denied attempt, always through the real proxy first.
  const denied = workspace('denied');
  const dp = await proxy(denied, 'MCP-002');
  await dp.call('CLI-014', 'read_file', { path: 'small.txt' });
  await dp.call('MCP-002', 'read_file', { path: '.env' }, true, 'Policy denied (no-secrets-read/v2): read_file touched secret path matching ".env*"');
  await dp.close('MCP-002');
  receipts('MCP-002', denied, r => { assert.equal(r[1].outcome, 'denied'); assert.equal(r[1].secretsAccessed, true); });
  cli('CLI-014', denied, ['prove'], 1, [`FAIL no-secrets-read at step 2 ${policy}: read_file touched secret path matching ".env*"`]);
  cli('CLI-039', denied, ['pack',join(temp,'denied-pack.json')], 0, ['FAIL no-secrets-read/v2 at step 2: No proof: step 2 (read_file .env) is signed as a secret access', 'pack written to']);
  cli('CLI-039', empty, ['pack',join(temp,'empty-from-pack.json'),'--from',emptyExp], 0, ['FAIL', 'pack written to']);
  const deniedExp = join(temp, 'denied-export'); cli('CLI-020', denied, ['export',deniedExp], 1);
  cli('CLI-020', denied, ['verify-export',deniedExp], 1, ['Chain intact and seal matches, but the export has no property proof. Prover reported:', '[']);
  const witness = workspace('witness'); cpSync(clean.env.RECEIPTS_DIR, witness.env.RECEIPTS_DIR,{ recursive:true }); witness.env.BLACKBOX_KEY_DIR=clean.env.BLACKBOX_KEY_DIR;
  const witnessFile=join(witness.env.RECEIPTS_DIR,'witness.jsonl'); const rawWitness=readFileSync(witnessFile,'utf8');
  rmSync(witnessFile); cli('CLI-014',witness,['prove'],1,['Raw arguments for this step are missing, so the policy cannot be evaluated']);
  const wsLines=rawWitness.trim().split('\n').map(JSON.parse); wsLines[0].args={path:'changed.txt'}; writeFileSync(witnessFile,wsLines.map(JSON.stringify).join('\n')+'\n');
  cli('CLI-014',witness,['prove'],1,['Stored arguments do not match the signed argsHash']);
  function exportVariant(name, change) { const dir=join(temp,name); cpSync(exp,dir,{recursive:true}); change(dir); return dir; }
  const editedExport=exportVariant('edited-export',dir=>{ const f=join(dir,'session.jsonl'); const r=readFileSync(f,'utf8').trim().split('\n').map(JSON.parse); r[0].tool+='-edited'; writeFileSync(f,r.map(JSON.stringify).join('\n')+'\n'); });
  cli('CLI-020',clean,['verify-export',editedExport],1,['FAIL no-secrets-read at step 1','Chain verification failed: Receipt contents were changed','[']);
  cli('CLI-020',clean,['verify-export',exportVariant('no-seal',dir=>rmSync(join(dir,'seal.json')))],1,['Seal is missing, so receipts removed from the end could not be detected','[']);
  cli('CLI-021',clean,['verify-export',exp],1,['Setup required: set BLACKBOX_PUBLIC_KEY (PEM of the proxy key). BLACKBOX_REQUIRE_PINNED_KEY is set but no BLACKBOX_PUBLIC_KEY is pinned, so the export\'s own key would be trusted'],{BLACKBOX_REQUIRE_PINNED_KEY:'1'});
  cli('CLI-021',clean,['verify-export',exp],1,['Exported public key does not match the pinned BLACKBOX_PUBLIC_KEY'],{BLACKBOX_PUBLIC_KEY:wrongKey});
  const tornExport=exportVariant('torn-export-input',dir=>writeFileSync(join(dir,'session.jsonl'),readFileSync(join(dir,'session.jsonl'),'utf8').split('\n')[0]+'\n{"step":2'));
  const invalidKey=exportVariant('bad-key-export',dir=>writeFileSync(join(dir,'public-key.pem'),'invalid public key'));
  const invalidProof=exportVariant('bad-proof-export',dir=>writeFileSync(join(dir,'proof-no-secrets.json'),'{'));
  for (const [dir,reason] of [[tornExport,corrupt],[invalidKey,'public-key.pem is not an Ed25519 SPKI public key (PEM)'],[invalidProof,'proof-no-secrets.json is not JSON (']]) {
    cli('CLI-022',clean,['verify-export',dir,exp],1,[reason,'PASS no-secrets-read','['],{},true);
    cli('CLI-040',clean,['pack',join(temp,'invalid-from.json'),'--from',dir],1,['FAIL: cannot pack',reason],{},true);
  }
  cli('CLI-048',clean,['attest-diff','--base',base,'--from',tornExport],1,[corrupt,'['],{},true);
  // Remaining MCP operations.
  const mw=workspace('mcp'); initGit(mw); writeFileSync(join(mw.cwd,'big.bin'),Buffer.alloc(3145728,0x61));
  const fifo=spawnSync('mkfifo',[join(mw.cwd,'pipe')]); assert.equal(fifo.status,0);
  const mp=await proxy(mw,'MCP-003');
  await mp.call('MCP-003','read_file',{path:'big.bin'},true,'read_file reads at most 2000000 bytes; big.bin is 3145728 bytes');
  await mp.call('MCP-003','read_file',{path:'pipe'},true,'read_file reads only regular files; pipe is not one');
  receipts('MCP-003',mw,r=>assert.deepEqual(r.map(x=>x.outcome),['error','error']));
  const written=await mp.call('MCP-004','write_file',{path:'folder/new.txt',content:'new\n'});
  const blob=createHash('sha1').update('blob 4\0new\n').digest('hex');
  check('MCP-004',()=>assert.deepEqual(JSON.parse(written.content[0].text),{written:'folder/new.txt',bytes:4,blob}));
  receipts('MCP-004',mw,r=>{assert.equal(r.at(-1).outcome,'ok');assert.deepEqual(r.at(-1).permissions,['workspace:file:write']);assert.deepEqual(r.at(-1).artifacts,[{path:'folder/new.txt',blob}]);});
  await mp.call('MCP-005','write_file',{path:'too-big.txt',content:'x'.repeat(1000001)},true,'write_file accepts at most 1000000 bytes');
  await mp.call('MCP-005','write_file',{path:'.env',content:'AUDIT-CANARY'},true,'Policy denied (no-secrets-read/v2): write_file touched secret path matching ".env*"');
  check('MCP-005',()=>assert.ok(!existsSync(join(mw.cwd,'.env'))));
  receipts('MCP-005',mw,r=>assert.deepEqual(r.slice(-2).map(x=>x.outcome),['error','denied']));
  const outside=join(temp,'outside');mkdirSync(outside);writeFileSync(join(outside,'outside.txt'),'OUTSIDE CANARY');
  symlinkSync(outside,join(mw.cwd,'escape'));symlinkSync(join(outside,'missing'),join(mw.cwd,'dangling'));symlinkSync('small.txt',join(mw.cwd,'alias.txt'));
  for(const tool of ['read_file','write_file']) for(const [path,message] of [['escape/outside.txt','Path must stay inside the current working directory'],['dangling/new.txt','Path must stay inside the current working directory (it goes through a symbolic link whose target does not exist)']]) await mp.call('MCP-006',tool,{path,...(tool==='write_file'?{content:'MUST NOT WRITE'}:{})},true,message);
  await mp.call('MCP-006','read_file',{path:'alias.txt'},false,'small\n');
  receipts('MCP-006',mw,r=>{assert.deepEqual(r.slice(-5,-1).map(x=>x.outcome),['error','error','error','error']);assert.deepEqual(r.at(-1).paths,['small.txt']);});
  check('MCP-006',()=>{assert.equal(readFileSync(join(outside,'outside.txt'),'utf8'),'OUTSIDE CANARY');assert.ok(!existsSync(join(outside,'missing/new.txt')));});
  for(const [action,args] of [['status',[]],['diff',['small.txt']],['log',[]],['show',['HEAD:small.txt']],['show_stat',[]]]) await mp.call('MCP-007','git',{action,args});
  receipts('MCP-007',mw,r=>{for(const x of r.slice(-5)){assert.equal(x.outcome,'ok');assert.deepEqual(x.permissions,['workspace:git:read']);}});
  for(const [action,args,message] of [['status',['x'],'git status does not accept additional arguments'],['log',['x'],'git log does not accept additional arguments'],['diff',[],'git diff requires explicit, literal file paths'],['show',['--output=bad:x'],'git show requires one revision:path argument with a plain revision (no options)'],['show_stat',['--bad'],'git show_stat accepts at most one plain revision']]) await mp.call('MCP-008','git',{action,args},true,message);
  receipts('MCP-008',mw,r=>assert.deepEqual(r.slice(-5).map(x=>x.outcome),Array(5).fill('error')));
  for(const command of ['pwd','ls','ls -a','ls -l','ls -la','ls -al','ls --','cat small.txt']) {const r=await mp.call('MCP-009','shell',{command});check('MCP-009',()=>{const d=JSON.parse(r.content[0].text);assert.equal(typeof d.stdout,'string');assert.equal(d.stderr,'');});}
  receipts('MCP-009',mw,r=>{for(const x of r.slice(-8)){assert.equal(x.outcome,'ok');assert.deepEqual(x.permissions,['workspace:shell:execute']);}});
  for(const [command,message] of [['cat small.txt; pwd','Shell allows only pwd, ls, and cat with direct arguments'],['echo x','Shell allows only pwd, ls, and cat with direct arguments'],['pwd extra','pwd does not accept additional arguments'],['ls -R','ls allows only -a and -l options'],['cat -n small.txt','cat options are not allowed'],['cat production','Policy denied production target']]) await mp.call('MCP-010','shell',{command},true,message);
  receipts('MCP-010',mw,r=>assert.deepEqual(r.slice(-6).map(x=>x.outcome),['error','error','error','error','error','denied']));
  const beforeExplain=readLog(mw).length;
  await mp.call('MCP-011','blackbox_explain',{},false,/# Session /);
  await mp.call('MCP-011','blackbox_explain',{step:1},false,/# Step 1 of session [\s\S]*## Cited receipts/);
  receipts('MCP-011',mw,r=>{assert.equal(r.length,beforeExplain+2);for(const x of r.slice(-2)){assert.equal(x.outcome,'ok');assert.deepEqual(x.permissions,['blackbox:explain']);}});
  await mp.call('MCP-012','blackbox_explain',{step:0},true,'step must be a positive integer, got 0');
  const count=readLog(mw).length;
  await mp.call('MCP-012','blackbox_explain',{step:99},true,new RegExp(`has no step 99 \\(it has ${count} receipts\\).`));
  receipts('MCP-012',mw,r=>assert.deepEqual(r.slice(-2).map(x=>x.outcome),['error','error']));
  // A real filesystem read error on the seal; the receipt log remains writable.
  const sealPath=join(mw.env.RECEIPTS_DIR,'seal.json');mkdirSync(sealPath);
  await mp.call('MCP-012','blackbox_explain',{},true,/^Could not explain the session: EISDIR:/);
  receipts('MCP-012',mw,r=>assert.equal(r.at(-1).outcome,'error'));rmSync(sealPath,{recursive:true});
  await mp.close('MCP-012');
  // Upstream is the specified real fixture server, never a sponsor/API substitute.
  const up=workspace('upstream');const upstreamLog=join(temp,'upstream-calls.jsonl');
  const upArgs=['--upstream',`${process.execPath} "${join(root,'test/fixtures/upstream-server.mjs')}"`];
  const u=await proxy(up,'MCP-013',upArgs,{UPSTREAM_LOG:upstreamLog});
  const ul=await u.rpc('MCP-013','tools/list');check('MCP-013',()=>{assert.deepEqual(ul.tools.map(t=>t.name),['echo','add','read_note','fail','env','blackbox_explain']);assert.deepEqual(ul.tools[1].inputSchema.required,['a','b']);});
  const cursorPage=await u.rpc('MCP-013','tools/list',{cursor:'audit-page'});check('MCP-013',()=>assert.deepEqual(cursorPage.tools,ul.tools.slice(0,-1)));
  await u.call('MCP-013','echo',{text:'hi'},false,'hi');const add=await u.call('MCP-013','add',{a:2,b:3});check('MCP-013',()=>assert.deepEqual(add.structuredContent,{sum:5}));
  await u.call('MCP-013','read_note',{path:'small.txt'},false,'small\n');
  await u.call('MCP-013','read_note',{path:'.env'},true,'Policy denied (no-secrets-read/v2): read_note touched secret path matching ".env*"');
  await u.call('MCP-013','fail',{},true,'upstream refused: this tool always fails');
  await u.call('MCP-013','blackbox_explain',{},false,/# Session /);
  await u.close('MCP-013');
  log('MCP-013',`UPSTREAM CALL LOG:\n${readFileSync(upstreamLog,'utf8')}`);
  check('MCP-013',()=>assert.deepEqual(readFileSync(upstreamLog,'utf8').trim().split('\n').map(JSON.parse).map(x=>x.name),['echo','add','read_note','fail']));
  receipts('MCP-013',up,r=>assert.deepEqual(r.map(x=>x.outcome),['ok','ok','ok','denied','error','ok']));
  for(const [args,code,msg] of [[['--cwd'],2,'blackbox-proxy: --cwd needs a directory'],[['--upstream'],2,'blackbox-proxy: --upstream needs a command'],[['--upstream','definitely-not-a-command-blackbox'],1,'blackbox-proxy: Could not start the upstream MCP server "definitely-not-a-command-blackbox"']]) run('MCP-014',process.execPath,[serverPath,...args],{cwd:up.cwd,env:up.env,code,matches:[msg]});
  // Store is inside the workspace with an innocuous name and a symlink alias.
  const boundary=workspace('boundary');boundary.env.RECEIPTS_DIR=join(boundary.cwd,'ledger');
  const bp=await proxy(boundary,'MCP-016');await bp.call('MCP-016','read_file',{path:'small.txt'});symlinkSync('ledger',join(boundary.cwd,'ledger-alias'));
  for(const path of ['ledger/session.jsonl','ledger-alias/session.jsonl']) await bp.call('MCP-016','read_file',{path},true,'Policy denied (no-secrets-read/v2): read_file touched the receipt store');
  await bp.close('MCP-016');
  receipts('MCP-016',boundary,r=>assert.deepEqual(r.slice(-2).map(x=>x.outcome),['denied','denied']));
  const ep=await proxy(up,'MCP-016',upArgs,{ZETARIS_API_KEY:'AUDIT-FIXTURE',METERLESS_TOKEN:'AUDIT-FIXTURE',METERLESS_STATE_DIR:join(temp,'absent-state'),GITLAB_TOKEN:'AUDIT-FIXTURE',CI_JOB_TOKEN:'AUDIT-FIXTURE',OPENROUTER_API_KEY:'AUDIT-FIXTURE',SOME_SERVICE_SECRET:'AUDIT-FIXTURE',GITHUB_TOKEN:'AUDIT-FIXTURE',BLACKBOX_UPSTREAM_ENV:'GITHUB_TOKEN,BLACKBOX_KEY_DIR',HARMLESS_SETTING:'kept'});
  for(const name of ['RECEIPTS_SIGNING_KEY','BLACKBOX_KEY_DIR','RECEIPTS_DIR','ZETARIS_API_KEY','METERLESS_TOKEN','METERLESS_STATE_DIR','GITLAB_TOKEN','CI_JOB_TOKEN','OPENROUTER_API_KEY','SOME_SERVICE_SECRET']) await ep.call('MCP-016','env',{name},false,'undefined');
  await ep.call('MCP-016','env',{name:'GITHUB_TOKEN'},false,'set:AUDIT-FIXTURE');await ep.call('MCP-016','env',{name:'HARMLESS_SETTING'},false,'set:kept');await ep.close('MCP-016');
  // Session lifecycle and refusal to resume a torn session.
  const life=workspace('lifecycle');let lp=await proxy(life,'MCP-015');await lp.call('MCP-015','read_file',{path:'small.txt'});await lp.close('MCP-015');
  const first=readLog(life)[0].sessionId;check('MCP-015',()=>assert.ok(existsSync(join(life.env.RECEIPTS_DIR,'seal.json'))));
  lp=await proxy(life,'MCP-015');await lp.call('MCP-015','read_file',{path:'small.txt'});await lp.close('MCP-015');
  check('MCP-015',()=>{assert.notEqual(readLog(life)[0].sessionId,first);const names=readdirSync(join(life.env.RECEIPTS_DIR,'sessions'));log('MCP-015',`ARCHIVES: ${JSON.stringify(names)}`);assert.ok(names.length>=3);});
  const lf=join(life.env.RECEIPTS_DIR,'session.jsonl');appendFileSync(lf,'{"step":2');const damaged=readFileSync(lf,'utf8');
  run('MCP-015',process.execPath,[serverPath],{cwd:life.cwd,env:{...life.env,RECEIPTS_RESUME:'1'},code:1,matches:[corrupt,'Not resuming it: start a new session (blackbox-call --new-session, or a proxy without RECEIPTS_RESUME), which keeps the damaged log under sessions/.']});
  check('MCP-015',()=>assert.equal(readFileSync(lf,'utf8'),damaged));
  lp=await proxy(life,'MCP-015');await lp.call('MCP-015','read_file',{path:'small.txt'});await lp.close('MCP-015');
  check('MCP-015',()=>{const names=readdirSync(join(life.env.RECEIPTS_DIR,'sessions'));log('MCP-015',`ARCHIVES: ${JSON.stringify(names)}`);assert.ok(names.some(x=>x.startsWith('corrupt-')));assert.equal(readLog(life).length,1);});
  // Resume after the seal creates a valid prefix seal while the proxy is running.
  const prefix=await proxy(clean,'CLI-002',[],{RECEIPTS_RESUME:'1'});await prefix.call('CLI-002','read_file',{path:'small.txt'});
  cli('CLI-002',clean,['verify'],0,['covers 8 of 9 receipts']);await prefix.close('CLI-002');
  // Remove one real receipt after shutdown: the signed seal must detect the cut.
  const complete=readFileSync(join(clean.env.RECEIPTS_DIR,'session.jsonl'),'utf8');writeFileSync(join(clean.env.RECEIPTS_DIR,'session.jsonl'),complete.trim().split('\n').slice(0,-1).join('\n')+'\n');
  cli('MCP-015',clean,['verify'],1,['seal']);writeFileSync(join(clean.env.RECEIPTS_DIR,'session.jsonl'),complete);
  const restore=workspace('restore-appended');let rp=await proxy(restore,'CLI-053');
  await rp.call('CLI-053','read_file',{path:'small.txt'});await rp.call('CLI-053','shell',{command:'pwd'});await rp.close('CLI-053');
  cli('CLI-053',restore,['tamper','2'],0);cli('CLI-053',restore,['tamper','1'],0);
  rp=await proxy(restore,'CLI-053',[],{RECEIPTS_RESUME:'1'});await rp.call('CLI-053','read_file',{path:'small.txt'});await rp.close('CLI-053');
  cli('CLI-053',restore,['restore'],0,['Restored block(s) 1, 2 to their signed originals.']);
  cli('CLI-053',restore,['verify'],0,['"valid": true','"receipts": 3']);
  check('CLI-053',()=>assert.ok(!existsSync(join(restore.env.RECEIPTS_DIR,'tamper-backup.json'))));
  await attestAndScripts(clean,empty,exp,publicKey,wrongKey);
  await sponsors(clean);
  tarball();
}

async function attestAndScripts(clean,empty,exp,publicKey,wrongKey) {
  const aw=workspace('attest');initGit(aw);writeFileSync(join(aw.cwd,'delete.txt'),'tracked baseline\n');git(aw,'add','delete.txt');git(aw,'commit','-qm','deletion baseline');const base=git(aw,'rev-parse','HEAD');const ap=await proxy(aw,'CLI-044');await ap.call('CLI-044','write_file',{path:'small.txt',content:'changed\n'});await ap.call('CLI-044','write_file',{path:'new.txt',content:'new\n'});await ap.close('CLI-044');
  const out=join(temp,'attest-output');mkdirSync(out);
  cli('CLI-044',aw,['attest-diff','--base',base,'--junit',join(out,'attest.xml'),'--out',join(out,'attest.json')],0,['ok   small.txt: matches the write signed at step 1','ok   new.txt: matches the write signed at step 2',`PASS attest-diff: 2 changed file(s) since ${base.slice(0,12)}, each produced by a signed write_file step`]);
  const verify=await import(pathToFileURL(join(root,'packages/verify/dist/index.js')));const attest=await import(pathToFileURL(join(root,'packages/proxy/dist/attest.js')));
  check('CLI-044',()=>{assert.match(readFileSync(join(out,'attest.xml'),'utf8'),/tests="2" failures="0"/);const a=JSON.parse(readFileSync(join(out,'attest.json'),'utf8'));assert.equal(a.kind,'blackbox-diff-attestation');assert.equal(a.ok,true);const {signature,...unsigned}=a;assert.equal(verify.verifyDigestSignature(verify.publicKeyFromPem(a.publicKey),attest.attestationDigest(unsigned),signature),true);});
  appendFileSync(join(aw.cwd,'small.txt'),'human edit\n');writeFileSync(join(aw.cwd,'bypass.txt'),'bypass\n');rmSync(join(aw.cwd,'delete.txt'));
  cli('CLI-045',aw,['attest-diff','--base',base],1,['FAIL small.txt changed after its recorded write (step 1 wrote','FAIL unrecorded change: bypass.txt','FAIL unrecorded change: delete.txt was deleted, and no signed step deletes files','FAIL attest-diff:']);
  // Restore exactly what the proxy wrote so the export gate has a clean diff.
  writeFileSync(join(aw.cwd,'small.txt'),'changed\n');writeFileSync(join(aw.cwd,'delete.txt'),'tracked baseline\n');rmSync(join(aw.cwd,'bypass.txt'));
  cli('CLI-046',aw,['attest-diff'],2,['Usage: blackbox-receipts attest-diff --base <sha> [--from exportDir] [--junit out.xml] [--out attestation.json] [--ignore glob]']);
  cli('CLI-046',empty,['attest-diff','--base',base],1,['FAIL attest-diff: No receipts exist for this session']);
  const exportDir=join(aw.cwd,'receipts/run');cli('CLI-047',aw,['export',exportDir],0);
  const pub=readFileSync(join(exportDir,'public-key.pem'),'utf8');
  cli('CLI-047',aw,['attest-diff','--base',base,'--from',exportDir],1,['Setup required: set BLACKBOX_PUBLIC_KEY (PEM of the proxy key). BLACKBOX_REQUIRE_PINNED_KEY is set but no BLACKBOX_PUBLIC_KEY is pinned, so the export\'s own key would be trusted'],{BLACKBOX_REQUIRE_PINNED_KEY:'1'});
  cli('CLI-047',aw,['attest-diff','--base',base,'--from',exportDir],1,['Export public key does not match the pinned BLACKBOX_PUBLIC_KEY'],{BLACKBOX_PUBLIC_KEY:wrongKey});
  cli('CLI-047',aw,['attest-diff','--base',base,'--from',exportDir,'--junit',join(out,'unpinned.xml')],0,['PASS attest-diff (UNPINNED: the export\'s own key was trusted; set BLACKBOX_PUBLIC_KEY)']);
  check('CLI-047',()=>assert.match(readFileSync(join(out,'unpinned.xml'),'utf8'),/UNPINNED"/));
  git(aw,'add','small.txt','new.txt','receipts');
  const gate=(id,args,code,matches,env={})=>run(id,'bash',[join(root,'scripts/ci/attest-diff-pr.sh'),...args],{cwd:aw.cwd,env:{...aw.env,...env},code,matches});
  gate('SCRIPT-005',[base,join(out,'unpin')],1,['FAIL attest-diff: Setup required: set BLACKBOX_PUBLIC_KEY (PEM of the proxy key). BLACKBOX_REQUIRE_PINNED_KEY is set but no BLACKBOX_PUBLIC_KEY is pinned, so the export\'s own key would be trusted']);
  gate('SCRIPT-006',[base,join(out,'pin')],0,['PASS attest-diff: 2 changed file(s)','2 test(s), 0 failure(s)'],{BLACKBOX_PUBLIC_KEY:pub});
  check('SCRIPT-006',()=>{for(const f of ['attest-diff.xml','attest-diff.json']) assert.ok(existsSync(join(out,'pin',f)));});
  gate('SCRIPT-007',[],2,['Usage: attest-diff-pr.sh <base-sha> [out-dir]']);
  gate('SCRIPT-007',[base],2,[`Setup required: ${join(temp,'no-cli.js')} not found (run pnpm install && pnpm build)`],{BLACKBOX_CLI:join(temp,'no-cli.js')});
  gate('SCRIPT-007',['f'.repeat(40)],1,[`FAIL attest-diff: base ${'f'.repeat(40)} is not a commit in this clone (fetch with full history)`]);
  // No export, ordinary vs explicitly agent branch, and then two exports.
  const no=workspace('no-export');const noBase=initGit(no);
  const gateNo=(code,msg,env={})=>run('SCRIPT-008','bash',[join(root,'scripts/ci/attest-diff-pr.sh'),noBase,join(out,'none')],{cwd:no.cwd,env:{...no.env,...env},code,matches:[msg]});
  gateNo(0,'NOT APPLICABLE attest-diff: this request adds no exported agent session (receipts/<session>/session.jsonl), so there are no receipts to gate it on.');
  gateNo(1,'FAIL attest-diff: blackbox/audit is an agent branch (blackbox/*) but adds no exported session (receipts/<session>/session.jsonl), so nothing vouches for its changes.',{BLACKBOX_AGENT_BRANCH:'blackbox/audit'});
  for(const name of ['one','two']) {mkdirSync(join(no.cwd,'receipts',name),{recursive:true});cpSync(exp,join(no.cwd,'receipts',name),{recursive:true});}git(no,'add','receipts');
  gateNo(1,'FAIL attest-diff: this request adds 2 exported sessions (receipts/one receipts/two); the gate checks one session per request.');
  // Bridge runs built call.js, which starts the built server.js.
  const bridge=workspace('bridge');initGit(bridge);
  const call=(id,args,code,matches=[])=>run(id,process.execPath,[callPath,...args],{cwd:bridge.cwd,env:bridge.env,code,matches});
  call('SCRIPT-001',['--new-session','read_file','{"path":"small.txt"}'],0,['small\n']);call('SCRIPT-001',['shell','{"command":"cat small.txt"}'],0,['small\n']);
  receipts('SCRIPT-001',bridge,r=>{assert.equal(r.length,2);assert.equal(r[0].sessionId,r[1].sessionId);});
  call('SCRIPT-002',[],2,['Usage: blackbox-call [--new-session]','read_file','git','shell']);
  call('SCRIPT-002',['read_file','{'],2,['Arguments must be a JSON object, got: {']);
  call('SCRIPT-002',['read_file','{"path":".env"}'],1,['DENIED or FAILED (receipt recorded): Policy denied (no-secrets-read/v2): read_file touched secret path matching ".env*"']);
  run('SCRIPT-003','bash',[join(root,'scripts/ci/verify-live-session.sh')],{cwd:root,code:0,matches:['verify-live-session: all expectations met']});
  run('SCRIPT-004','bash',[join(root,'scripts/ci/verify-agent-demo.sh')],{cwd:root,code:0,matches:[/verify-agent-demo: \d+ export\(s\) match their recorded verdicts/]});
  run('SCRIPT-004','bash',[join(root,'scripts/ci/verify-agent-demo.sh')],{cwd:empty.cwd,code:0,matches:['no agent-demo exports to check'],env:{BLACKBOX_CLI:cliPath}});
  run('SCRIPT-009','bash',[join(root,'scripts/demo-attest-diff.sh')],{cwd:root,code:0,matches:['agent/clean        ','agent/human-edit','agent/bypass','exit 0 (expected 0: green)','exit 1 (expected 1: red)','changed after its recorded write','FAIL unrecorded change: examples/injection-repo/src/debug.ts']});
  // Isolated setup fixtures: executable presence only; neither file is ever invoked as a model.
  const fixture=join(temp,'setup-fixture');mkdirSync(join(fixture,'scripts'),{recursive:true});copyFileSync(join(root,'scripts/demo-agent.sh'),join(fixture,'scripts/demo-agent.sh'));copyFileSync(join(root,'scripts/demo-attest-diff.sh'),join(fixture,'scripts/demo-attest-diff.sh'));
  const bin=join(temp,'isolated-bin');mkdirSync(bin);symlinkSync('/usr/bin/dirname',join(bin,'dirname'));
  run('SCRIPT-010','/bin/bash',[join(fixture,'scripts/demo-agent.sh')],{cwd:fixture,env:{PATH:bin},code:2,matches:['Setup required: install opencode (https://opencode.ai) and configure its OpenRouter provider']});
  // /usr/bin/false only makes command -v true. The missing build exits before opencode is run.
  symlinkSync('/usr/bin/false',join(bin,'opencode'));
  run('SCRIPT-010','/bin/bash',[join(fixture,'scripts/demo-agent.sh')],{cwd:fixture,env:{PATH:bin},code:2,matches:['Setup required: run pnpm install && pnpm build first']});
  run('SCRIPT-009','/bin/bash',[join(fixture,'scripts/demo-attest-diff.sh')],{cwd:fixture,env:{PATH:bin},code:2,matches:['Setup required: run pnpm install && pnpm build first']});
  for(const [id,files] of [['SCRIPT-012',['test/gitlab-flow.test.ts']],['SCRIPT-014',['test/ci-config.test.ts']]]) run(id,'pnpm',['exec','node','--conditions=source','--import','tsx','--test',...files],{cwd:root,code:0,matches:[/(?:#|ℹ) fail 0/]});
  // Inventory details are checked in addition to the regression tests.
  begin('SCRIPT-012');const flow=readFileSync(join(root,'.gitlab/duo/flows/blackbox-receipts.yaml'),'utf8');
  check('SCRIPT-012',()=>{for(const s of ['Blackbox Receipts reviewer','blackbox_reviewer','toolset: ["run_command", "create_merge_request_note", "create_issue_note"]','node packages/proxy/dist/call.js --new-session git','first 8 characters of the session id','These git commands and the export are not part of the receipt chain.','Copy that verdict line verbatim.'])assert.ok(flow.includes(s),s);});
  log('SCRIPT-012',`STATIC FLOW:\n${flow}\nMCP REGISTRATION:\n${readFileSync(join(root,'.gitlab/duo/mcp.json'),'utf8')}`);
  check('SCRIPT-012',()=>{const m=JSON.parse(readFileSync(join(root,'.gitlab/duo/mcp.json'),'utf8')).mcpServers['blackbox-receipts'];assert.equal(m.type,'stdio');assert.equal(m.command,'node');assert.deepEqual(m.args,['packages/proxy/dist/server.js']);assert.deepEqual(m.approvedTools,['read_file','git','shell']);});
  const inventory={'.github/workflows/ci.yml':['name: ci','build-and-test:','pnpm -r build','pnpm typecheck','pnpm lint','pnpm test','verify-live-session.sh','verify-agent-demo.sh'],'.github/workflows/attest-diff.yml':['name: attest-diff','attest-diff:','Every changed file must come from a signed write_file step'],'.github/workflows/pages.yml':['name: pages','  build:','  deploy:','Static export (landing + /verify)'],'.gitlab-ci.yml':['build:','test:','verify:live-session:','verify:agent-demo:','verify:exported-receipts:','verify:attest-diff:','pages:']};
  for(const [file,strings] of Object.entries(inventory)){const text=readFileSync(join(root,file),'utf8');log('SCRIPT-014',`STATIC ${file}:\n${text}`);check('SCRIPT-014',()=>{for(const s of strings)assert.ok(text.includes(s),`${file}: ${s}`);});}
}

async function sponsors(clean) {
  const z=await import(pathToFileURL(join(root,'packages/zetaris/dist/index.js')));
  const m=await import(pathToFileURL(join(root,'packages/meterless/dist/index.js')));
  function thrown(id,fn,type,message){begin(id);let error;try{fn();}catch(e){error=e;}log(id,`STDOUT: ${error?.name}: ${error?.message}\nSTDERR:\nEXIT CODE: 0 (caught expected exception; no request made)`);check(id,()=>{assert.ok(error instanceof type);assert.equal(error.message,message);});}
  const zMessage='Zetaris not configured: missing ZETARIS_API_KEY, ZETARIS_ORG_ID. Create an API key in the Zetaris Console and get your Org ID from Zetaris Support/Admin, then set them in .env.local.';
  thrown('EXT-001',()=>z.zetarisConfigFromEnv({}),z.ZetarisConfigError,zMessage);
  thrown('EXT-002',()=>z.zetarisConfigFromEnv({ZETARIS_API_KEY:'AUDIT-FIXTURE',ZETARIS_ORG_ID:'acme'}),z.ZetarisConfigError,'ZETARIS_ORG_ID must be an integer org id, got "acme".');
  check('EXT-002',()=>{assert.equal(z.zetarisConfigFromEnv({ZETARIS_API_KEY:'AUDIT-FIXTURE',ZETARIS_ORG_ID:'42'}).baseUrl,'https://api.saas.enterprise.zetaris.com');assert.equal(z.zetarisConfigFromEnv({ZETARIS_API_KEY:'AUDIT-FIXTURE',ZETARIS_ORG_ID:'42',ZETARIS_BASE_URL:'https://z.example///'}).baseUrl,'https://z.example');});
  for(const limit of [0,101]) thrown('EXT-002',()=>new z.ZetarisClient({apiKey:'AUDIT-FIXTURE',orgId:'42',baseUrl:'http://127.0.0.1:9'}).startSql('SELECT 1',limit),RangeError,'Zetaris pageLimit must be between 1 and 100');
  const mMessage='Meterless not configured: set METERLESS_TOKEN, or METERLESS_STATE_DIR (the runtime writes its token to <stateDir>/proxy-token). Meterless runs locally; there is no hosted API key.';
  thrown('EXT-006',()=>m.meterlessConfigFromEnv({}),m.MeterlessConfigError,mMessage);
  thrown('EXT-007',()=>m.meterlessConfigFromEnv({METERLESS_TOKEN:'rt-local'}),m.MeterlessConfigError,'Meterless token "rt-local" is a placeholder the runtime rejects; use the real token from <stateDir>/proxy-token.');
  begin('EXT-008');for(const input of ['127.0.0.1:8088','http://127.0.0.1:8088/v1','http://127.0.0.1:8088/v1/','http://127.0.0.1:8088/v1/chat/completions','http://127.0.0.1:8088/v1/models','http://127.0.0.1:8088/healthz','http://127.0.0.1:8088/v1/v1']){const normalized=m.normalizeMeterlessUrl(input);log('EXT-008',`${input} => ${normalized}`);check('EXT-008',()=>assert.equal(normalized,'http://127.0.0.1:8088/v1'));}
  const state=join(temp,'does-not-exist');let error;try{m.meterlessConfigFromEnv({METERLESS_STATE_DIR:state});}catch(e){error=e;}
  log('EXT-008',`STDOUT: ${error?.message}\nSTDERR:\nEXIT CODE: 0 (expected exception caught)`);check('EXT-008',()=>{assert.ok(error instanceof m.MeterlessConfigError);assert.ok(error.message.startsWith(`Meterless not configured: could not read ${join(state,'proxy-token')} (`));assert.ok(error.message.endsWith('Is the Meterless Runtime installed and has it run once?'));});
  const r=cli('EXT-009',clean,['explain','--model','meterless'],2,[]);
  check('EXT-009',()=>{assert.equal(r.stderr.trim(),`Setup required: ${mMessage}`);assert.doesNotMatch(r.stdout+r.stderr,/## Narrative/);});
  results.get('EXT-009').note=`stderr: “Setup required: ${mMessage}”`;
  const tests=run('EXT-014','pnpm',['exec','node','--conditions=source','--import','tsx','--test','test/zetaris.test.ts','test/meterless.test.ts'],{cwd:root,code:0,matches:['\n⚠️  SKIPPING LIVE ZETARIS TESTS: ZETARIS_API_KEY and ZETARIS_ORG_ID are not set. Nothing was called against Zetaris.\n','\n⚠️  SKIPPING LIVE METERLESS TESTS: METERLESS_TOKEN or METERLESS_STATE_DIR is not set. Nothing was called against a Meterless Runtime.\n',/(?:#|ℹ) fail 0/,/(?:#|ℹ) skipped 5/]});
  check('EXT-014',()=>assert.match(tests.stdout,/(?:#|ℹ) pass 8/));
  // Execute just the real missing-config branch, in isolation, with no server and no upload.
  begin('EXT-015');const route=readFileSync(join(root,'apps/web/app/api/anchor/route.ts'),'utf8');
  const guard=route.match(/  const publisher = process\.env\.WALRUS_PUBLISHER_URL;\n  if \(!publisher\) return ([^\n]+);/);
  check('EXT-015',()=>assert.ok(guard));
  if(guard){const file=join(temp,'walrus-setup.mjs');writeFileSync(file,`import { NextResponse } from ${JSON.stringify(pathToFileURL(join(root,'apps/web/node_modules/next/server.js')).href)};\nasync function POST(){\n${guard[0]}\nthrow new Error('must not reach upload');}\nconst r=await POST(); console.log(r.status);console.log(await r.text());\n`);run('EXT-015',process.execPath,[file],{code:0,matches:['503','{"error":"Walrus is not configured. Set WALRUS_PUBLISHER_URL to a funded publisher endpoint."}']});}
  const cliSource=readFileSync(join(root,'packages/proxy/src/cli.ts'),'utf8');const page=readFileSync(join(root,'apps/web/app/recorder/page.tsx'),'utf8');
  check('EXT-015',()=>{assert.doesNotMatch(cliSource,/command === ['"]walrus['"]/);for(const s of ['Setup required','Set WALRUS_PUBLISHER_URL','None is bundled, and the root is not anchored on-chain.'])assert.ok(page.includes(s),s);});
  log('EXT-015','Static recorder copy and absence of Walrus CLI checked; no Next server, upload, or on-chain flow invoked.');
}

function tarball() {
  const install=join(temp,'tarball');const target=join(install,'node_modules/@blackbox/verify');mkdirSync(target,{recursive:true});
  run('CLI-057','tar',['-xzf',join(root,'release/blackbox-verify-0.1.0.tgz'),'-C',target,'--strip-components=1'],{code:0});
  mkdirSync(join(install,'node_modules/@noble'),{recursive:true});for(const name of ['curves','hashes'])symlinkSync(realpathSync(join(root,'packages/verify/node_modules/@noble',name)),join(install,'node_modules/@noble',name));
  const manifest=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));check('CLI-057',()=>assert.equal(manifest.bin['blackbox-verify'],'./dist/bin.js'));
  const bin=(id,args,code,matches=[])=>run(id,process.execPath,[join(target,manifest.bin['blackbox-verify']),...args],{code,matches});
  bin('CLI-057',[],2,['Usage: blackbox-verify <pack.json>','--public-key','--expect-policy','--json','Exit codes: 0 PASS, 1 FAIL, 2 usage error or unreadable file.']);bin('CLI-057',['--help'],0,['Usage: blackbox-verify <pack.json>']);bin('CLI-057',['--version'],0,['0.1.0']);
  const passFile=join(temp,'historical-pass.json'),failFile=join(temp,'historical-fail.json');copyFileSync(join(root,'receipts/agent-demo/e51c6b41-baba-404e-97a9-9bb2270924a0/pack.json'),passFile);copyFileSync(join(root,'receipts/agent-demo/933f87da-c941-4588-8716-d6c8df98aded/pack.json'),failFile);
  bin('CLI-058',[passFile,'--expect-policy','no-secrets-read/v1'],0,['PASS no-secrets-read/v1: 14 receipts, chain intact, seal matches, proof verified']);
  bin('CLI-059',[passFile],1,['FAIL property: Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy (d1e72d1a6c22)','  ok   chain:','  ok   seal:']);
  bin('CLI-059',[passFile,'--expect-policy','no-secrets-read/v0'],2,['no-secrets-read/v0 is neither a published policy (no-secrets-read/v2, no-secrets-read/v1) nor a readable policy file']);
  bin('CLI-060',[join(temp,'missing-pack')],2,['FAIL: cannot read']);bin('CLI-060',[join(temp,'object.json')],2,['FAIL: cannot read']);
  bin('CLI-060',[failFile,'--expect-policy','no-secrets-read/v1'],1,['FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access']);
  const text=readFileSync(passFile,'utf8');const marker=text.indexOf('"step": 7,');const at=text.indexOf('"resultHash": "',marker)+'"resultHash": "'.length+63;const edited=text.slice(0,at)+(text[at]==='0'?'1':'0')+text.slice(at+1);const editedFile=join(temp,'historical-edited.json');writeFileSync(editedFile,edited);
  check('CLI-060',()=>assert.equal([...text].filter((c,i)=>c!==edited[i]).length,1));bin('CLI-060',[editedFile],1,['FAIL at step 7: Receipt contents were changed','step 8 untrusted:']);
  const missing=JSON.parse(text);delete missing.receipts[1].paths;const malformed=join(temp,'historical-malformed.json');writeFileSync(malformed,JSON.stringify(missing));const r=bin('CLI-060',[malformed],1,['FAIL format at step 2: receipt paths is not a list of strings']);check('CLI-060',()=>assert.doesNotMatch(r.stdout+r.stderr,/\n\s+at /));
}

function finish() {
  const untested=['EXT-003','EXT-004','EXT-005','EXT-010','EXT-011','EXT-012','EXT-013','EXT-016','SCRIPT-011','SCRIPT-013'];
  for(const id of untested){const row=canonical.find(x=>x.startsWith(`| ${id} |`));const cells=row.split('|');results.set(id,{status:'UNTESTED',errors:[],dependency:cells.at(-3).trim()});rmSync(join(evidence,`${id}.txt`),{force:true});}
  const escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
  const rows=ids.map(id=>{const r=results.get(id);if(r.status!=='UNTESTED')r.status=r.errors.length?'FAIL':'PASS';return `| ${id} | ${r.status} | ${r.dependency??`[audit/cli/${id}.txt](cli/${id}.txt)${r.note?`; ${escape(r.note)}`:''}`} | ${r.errors.length?escape(r.errors.join('; ')):'—'} |`;});
  writeFileSync(join(root,'audit/results-cli.md'),'| ID | status | evidence | fix |\n|---|---|---|---|\n'+rows.join('\n')+'\n');
  const counts={};for(const r of results.values())counts[r.status]=(counts[r.status]??0)+1;console.log(JSON.stringify({temp,counts,failures:[...results].filter(([,r])=>r.status==='FAIL')},null,2));
  process.exitCode = counts.FAIL ? 1 : 0;
}
try { await execute(); } catch(e) { console.error(e.stack); } finally { finish(); }
