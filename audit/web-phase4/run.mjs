// Focused phase 4 audit, real Chrome and real local proxy calls. Never runs the E2E suite.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
const root=process.cwd(), out=resolve('audit/web-phase4'), slot='/tmp/grokbot-heavy-slots/slot1', heavy='/Volumes/Extreme SSD/Projects/grokbot/tools/heavy-slot.sh';
const state=mkdtempSync('/private/tmp/blackbox-web-phase4-');
const env=Object.fromEntries(['PATH','HOME','TMPDIR','USER','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
Object.assign(env,{RECEIPTS_DIR:join(state,'session'),BLACKBOX_KEY_DIR:join(state,'ephemeral-signing'),NEXT_TELEMETRY_DISABLED:'1'});
const audit=readFileSync('AUDIT.md','utf8');
const expected=id=>audit.split('\n').find(x=>x.startsWith(`| ${id} |`))?.split(' | ')[2];
const selected=new Set(process.argv.slice(2));
const results=selected.size?JSON.parse(readFileSync(join(out,'results.json'),'utf8')).filter(r=>!selected.has(r.id)):[], serverPids=[], chromePids=[];
let server, browser, origin, cleanupPromise;
const lifecycle=s=>appendFileSync(join(out,'lifecycle.log'),`${new Date().toISOString()} ${s}\n`);
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const save=(dir,name,value)=>writeFileSync(join(dir,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
async function cleanup(){
 return cleanupPromise??=(async()=>{
  try{
   if(browser)await browser.close();
   if(server&&server.exitCode===null){server.kill('SIGTERM');await Promise.race([once(server,'exit'),wait(4000)]);if(server.exitCode===null){server.kill('SIGKILL');await once(server,'exit');}}
   await wait(200);
   const alive=[...serverPids,...chromePids].filter(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});
   for(const pid of alive){try{process.kill(pid,'SIGKILL');}catch{}}
   rmSync(state,{recursive:true,force:true});
   lifecycle(`Next PIDs=${serverPids}; Chrome PIDs=${chromePids}; alive after graceful shutdown=${JSON.stringify(alive)}; throwaway state removed`);
  }finally{
   const release=spawnSync(heavy,['release','bb-audit-web'],{encoding:'utf8'});
   lifecycle(`release bb-audit-web exit=${release.status}; slot exists=${existsSync(slot)}`);
  }
 })();
}
for(const sig of ['SIGINT','SIGTERM','SIGHUP'])process.once(sig,()=>void cleanup().finally(()=>process.exit(1)));
function call(path,fresh=false,denied=false){
 const r=spawnSync(process.execPath,[join(root,'packages/proxy/dist/call.js'),...(fresh?['--new-session']:[]),'read_file',JSON.stringify({path})],{cwd:state,env,encoding:'utf8'});
 lifecycle(`real MCP read_file ${JSON.stringify({path})} exit=${r.status}; expectedDenied=${denied}`);
 assert.equal(r.status,denied?1:0,`Proxy fixture call failed: ${r.stderr}`);
}
async function row(id,path,work){
 if(selected.size&&!selected.has(id))return;
 const dir=join(out,id);mkdirSync(dir,{recursive:true});
 const context=await browser.newContext({viewport:{width:1280,height:900}});
 await context.tracing.start({screenshots:true,snapshots:true,sources:false});
 const page=await context.newPage();page.setDefaultTimeout(10000);
 const logs=[], network=[], checks=[], failures=[], artifacts={};
 page.on('console',m=>logs.push({type:m.type(),text:m.text(),location:m.location()}));
 page.on('pageerror',e=>logs.push({type:'pageerror',text:e.message,stack:e.stack}));
 page.on('request',r=>network.push({event:'request',method:r.method(),url:r.url(),type:r.resourceType()}));
 page.on('response',r=>network.push({event:'response',status:r.status(),url:r.url(),method:r.request().method()}));
 page.on('requestfailed',r=>network.push({event:'requestfailed',url:r.url(),error:r.failure()?.errorText}));
 const check=(name,actual,wanted)=>{const ok=JSON.stringify(actual)===JSON.stringify(wanted);checks.push({name,actual,expected:wanted,ok});if(!ok)failures.push(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(wanted)}`);};
 const text=selector=>page.locator(selector).textContent().then(s=>s.replace(/\s+/g,' ').trim());
 const snap=async name=>{await page.screenshot({path:join(dir,`${name}.png`),fullPage:true,animations:'disabled'});save(dir,`${name}.txt`,await page.locator('body').innerText());};
 const request=async(path,method='GET')=>{const r=await page.evaluate(async({path,method})=>{const r=await fetch(path,{method,cache:'no-store'});return{status:r.status,url:r.url,body:await r.json()};},{path,method});save(dir,`api-${method}-${path.split('/').pop()}-${Object.keys(artifacts).length}.json`,r);artifacts[`${method} ${path} ${Object.keys(artifacts).length}`]=r;check(`${method} ${path} status`,r.status,200);return r.body;};
 try{
  check('navigation status',(await page.goto(origin+path,{waitUntil:'networkidle'})).status(),200);
  await work({page,context,check,text,snap,request,network,dir});
 }catch(e){failures.push(e.stack??e.message);}
 await wait(200);await snap('screenshot');
 const allowed=id==='WEB-PAGE-VERIFY-ERROR'?logs.filter(m=>m.type==='error'&&m.text.startsWith('Error: Audit render fault\n')&&m.text.includes('String.padStart')):[];
 for(const m of logs)if(m.type==='pageerror'||(m.type==='error'&&!allowed.includes(m)))failures.push(`Unexpected ${m.type}: ${m.text}`);
 for(const r of network)if((r.event==='response'&&r.status>=400)||r.event==='requestfailed')failures.push(`Unexpected network failure: ${JSON.stringify(r)}`);
 if(id==='WEB-PAGE-VERIFY-ERROR')check('only injected React error logged',allowed.length,1);
 const status=failures.length?'FAIL':'PASS';
 save(dir,'console.json',logs);save(dir,'network.json',network);save(dir,'checks.json',{id,status,checks,failures,artifacts,chrome:browser.version(),url:page.url(),viewport:page.viewportSize()});
 const quote=allowed.length?`\nAllowed React console.error (captured without suppression):\n\n\`\`\`text\n${allowed.map(m=>m.text).join('\n')}\n\`\`\`\n`:'';
 save(dir,'evidence.md',`# ${id}: ${status}\n\nReal Google Chrome ${browser.version()} via Playwright; ${new Date().toISOString()}.\n\nAUDIT.md expected cell as present in this worktree:\n\n${expected(id)}\n\nThe phase 4 user corrections override older wording for the evidence seal time, sample-fail headline, boundary console exception, pinned policy suffix, and non-pack error. See checks.json for exact expected/observed assertions.\n\n${checks.filter(c=>c.ok).length}/${checks.length} exact checks passed. ${failures.length?failures.join('\n'):'No unexpected console errors, page errors, failed requests, or HTTP error statuses.'}\n${quote}\nEvidence: [checks](checks.json), [console](console.json), [network](network.json), [rendered text](screenshot.txt), [screenshot](screenshot.png), [trace](trace.zip).\n`);
 await context.tracing.stop({path:join(dir,'trace.zip')});await context.close();
 results.push({id,status,checks:checks.length,failures});save(out,'results.json',results);
 console.log(`${status} ${id}${failures.length?' '+failures[0]:''}`);
}
try{
 assert.ok(readFileSync(join(slot,'owner'),'utf8').startsWith('bb-audit-web '),'Acquire bb-audit-web before running');
 writeFileSync(join(slot,'owner'),`bb-audit-web ${process.pid} ${new Date().toISOString()}\n`);
 lifecycle(`runner pid=${process.pid}; acquired slot transferred to live runner; state=${state}`);
 for(const name of ['.env','.env.local','.env.production','.env.production.local'])assert.equal(existsSync(join(root,'apps/web',name)),false,'Next env files must be absent; do not read them');
 for(const name of ['one.md','two.md','three.md'])writeFileSync(join(state,name),`Public Phase 4 fixture ${name}\n`);
 call('one.md',true);call('two.md');call('three.md');
 if(selected.size&&!selected.has('API-POST-PROVE-FAIL')){call('secrets/phase4-never-created.txt',false,true);call('one.md');}
 const port=await new Promise((ok,fail)=>{const s=net.createServer();s.on('error',fail);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>ok(p));});});
 origin=`http://127.0.0.1:${port}`;
 const require=createRequire(join(root,'apps/web/package.json'));const next=join(dirname(require.resolve('next/package.json')),'dist/bin/next');
 const log=(await import('node:fs')).openSync(join(out,'server.log'),'w');
 server=spawn(process.execPath,[next,'start','-H','127.0.0.1','-p',String(port)],{cwd:join(root,'apps/web'),env,stdio:['ignore',log,log]});serverPids.push(server.pid);
 lifecycle(`Next pid=${server.pid}; origin=${origin}; env is minimal with throwaway RECEIPTS_DIR and BLACKBOX_KEY_DIR; external service credentials absent`);
 for(let i=0;i<100;i++){assert.equal(server.exitCode,null,'Next exited');try{if((await fetch(origin+'/verify')).ok)break;}catch{}if(i===99)throw new Error('Next readiness timed out');await wait(100);}
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const cdp=await browser.newBrowserCDPSession();chromePids.push(...(await cdp.send('SystemInfo.getProcessInfo')).processInfo.map(p=>p.id));await cdp.detach();lifecycle(`Google Chrome ${browser.version()}; PIDs=${chromePids}`);
 await row('WEB-PAGE-EVIDENCE','/evidence',async({page,check,text})=>{
  check('h1',await text('h1'),'The tape, the checks and the limits.');check('kicker',await text('.ld-kicker'),'Evidence · session 933f87da');
  const strip=await text('.ld-strip');for(const s of ['Agent flight recorder','Session 933f87da','10 receipts','Denied at step 03'])check(`strip ${s}`,strip.includes(s),true);
  check('signed seal time (CSS casing allowed)',/sealed 2026-10-21 04:26:20 UTC/i.test(strip),true);check('old seal time absent',strip.includes('04:34:03'),false);
  for(const s of ['Signing key','Tape','Seal','Locator'])check(`diagram ${s}`,(await text('.ld-parts')).includes(s),true);
  for(const s of ['Fig. 1','01 · Tape playback','02 · Investigation','03 · Limitations placard','04 · Built in the window'])check(`section ${s}`,(await text('body')).includes(s),true);
  check('limitations',await page.locator('.ld-limits > div').count(),7);for(const s of ['Setup required','Not run yet'])check(`limit ${s}`,(await text('#limits')).includes(s),true);
  check('window entries',await page.locator('.ld-window-row').count(),8);for(const s of ['A case variant of .env is a denied read, not a PASS','Before','After'])check(`window lead ${s}`,(await text('.ld-window-lead')).includes(s),true);
 });
 await row('WEB-PAGE-VERIFY-SAMPLE-FAIL','/verify',async({page,check,text,network})=>{
  const before=network.filter(r=>r.event==='request').length;
  await page.getByRole('button',{name:/Agent tried to read \.env/}).click();await expect(page.locator('.vf-badge')).toHaveText('FAIL');
  check('badge',await text('.vf-badge'),'FAIL');check('headline',await text('.vf-headline'),'FAIL no-secrets-read/v1 at step 3: No proof: step 3 (read_file .env) is signed as a secret access');
  check('step count',await page.locator('.vf-step').count(),10);
  const step=page.locator('.vf-step').nth(2);check('flagged step number',await step.locator('.vf-step-n').innerText(),'03');check('flagged step badge',await step.locator('.vf-pill').innerText(),'Secret access');check('flagged outcome',await step.locator('.vf-outcome').innerText(),'denied');check('flagged tool',await step.locator('strong').innerText(),'read_file');check('flagged path',await step.locator('.vf-step-what code').innerText(),'.env');
  await wait(300);check('network requests after load',network.filter(r=>r.event==='request').length-before,0);
 });
 await row('WEB-PAGE-VERIFY-ERROR','/verify',async({page,check,text,snap})=>{
  await page.evaluate(()=>{const original=String.prototype.padStart;window.__restoreAuditFault=()=>{String.prototype.padStart=original;};String.prototype.padStart=function(...args){if(args[0]===2&&args[1]==='0')throw new Error('Audit render fault');return original.apply(this,args);};});
  await page.getByRole('button',{name:/Agent skipped the README/}).click();await expect(page.getByRole('heading',{name:'Could not verify',exact:true})).toBeVisible();
  check('heading',await text('h1'),'Could not verify');check('lead',await text('.vf-lead'),'This pack could not be displayed, so no verdict was reached. Nothing was uploaded; the file never left this tab.');check('alert',await text('.vf-alert[role=alert]'),'Could not verify: Audit render fault');await snap('error-boundary');
  await page.evaluate(()=>window.__restoreAuditFault());await page.getByRole('button',{name:'Load another pack',exact:true}).click();await expect(page.locator('.vf-empty')).toBeVisible();
  check('reset h1',await text('h1'),'Check a pack in your browser.');check('reset alert absent',await page.locator('.vf-alert').count(),0);check('reset verdict absent',await page.locator('.vf-result').count(),0);
 });
 await row('WEB-FLOW-VERIFY-PINNED-POLICY','/verify',async({page,check,text,snap,network})=>{
  const before=network.filter(r=>r.event==='request').length,pin=page.locator('#vf-policy');check('default policy',await pin.inputValue(),'no-secrets-read/v2');
  await page.getByRole('button',{name:/Agent skipped the README/}).click();await expect(page.locator('.vf-badge')).toHaveText('PASS');check('sample policy',await pin.inputValue(),'no-secrets-read/v1');check('sample badge',await text('.vf-badge'),'PASS');
  await pin.selectOption('no-secrets-read/v2');await expect(page.locator('.vf-badge')).toHaveText('FAIL');check('policy mismatch',await text('.vf-headline'),'FAIL property: Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy (d1e72d1a6c22)');await snap('v2-rejection');
  await pin.selectOption('no-secrets-read/v1');await page.getByLabel('Step to edit').selectOption('5');await page.getByRole('button',{name:'Flip one byte',exact:true}).click();
  for(const policy of ['no-secrets-read/v1','no-secrets-read/v2','no-secrets-read/v1']){await pin.selectOption(policy);check(`tamper under ${policy}`,await text('.vf-headline'),'FAIL at step 5: Receipt contents were changed');check('tamper badge',await text('.vf-badge'),'FAIL');}await wait(200);check('requests after load',network.filter(r=>r.event==='request').length-before,0);
 });
 await row('EDGE-VERIFY-NON-PACK','/verify',async({page,check,text,network})=>{
  const before=network.filter(r=>r.event==='request').length;
  await page.locator('input[type=file]').setInputFiles({name:'not-a-pack.json',mimeType:'application/json',buffer:Buffer.from('{"hello":"world"}')});await expect(page.locator('.vf-alert')).toBeVisible();
  check('alert',await text('.vf-alert'),'Could not verify. not-a-pack.json: Not a Blackbox pack (expected "format": "blackbox-pack/v1")');check('no verdict section',await page.locator('.vf-result').count(),0);check('no badge',await page.locator('.vf-badge').count(),0);await wait(200);check('requests after load',network.filter(r=>r.event==='request').length-before,0);
 });
 await row('API-POST-PROVE-FAIL','/verify',async({check,request})=>{
  // Supplement the requested FAIL response with verification of the changed proof fields on a real clean session.
  const b=await request('/api/prove','POST');check('clean status',b.status,'PASS');check('clean step',b.step,null);check('clean reason',b.reason,null);check('clean policyId',b.policyId,'no-secrets-read/v2');check('clean chain',b.chainBrokenAt,null);check('clean count',b.steps,3);
  const p=b.proof;check('proof format',p.format,'blackbox-property-proof/v1');check('proof policyId',p.policyId,'no-secrets-read/v2');check('proof count',p.count,3);for(const k of ['sessionId','policyHash','root','publicKey'])check(`proof ${k} string`,typeof p[k],'string');check('root ties to session',p.root,b.sessionRoot);check('proof leaves count',p.leaves.length,3);check('commitment count',p.commitments.length,3);
  for(const l of p.leaves){check('leaf step type',typeof l.step,'number');for(const k of ['leafHash','receiptHash','signature'])check(`leaf ${k} type`,typeof l[k],'string');check('inclusion path array',Array.isArray(l.inclusionPath)&&l.inclusionPath.every(x=>typeof x==='string'),true);}
  for(const c of p.commitments){check('commitment step type',typeof c.step,'number');for(const k of ['commitment','opening'])check(`commitment ${k} type`,typeof c[k],'string');}
  const {verifyPropertyProof,stableJson,sha256Hex}=await import('../../packages/verify/dist/core.js');check('native proof verifies',verifyPropertyProof(p,p.publicKey).valid,true);
  const receipts=(await request('/api/session')).receipts;for(const c of p.commitments){const r=receipts.find(r=>r.step===c.step);check(`commitment opening ${c.step}`,c.commitment,sha256Hex(stableJson({property:p.property,policyHash:p.policyHash,step:c.step,leaf:r.hash,argsHash:r.argsHash,verdict:'pass',salt:c.opening})));}
  call('secrets/phase4-never-created.txt',false,true);call('one.md');
  const f=await request('/api/prove','POST');check('FAIL keys',Object.keys(f).sort(),['status','step','reason','policyId','sessionRoot','chainBrokenAt'].sort());check('failure status',f.status,'FAIL');check('failure step',f.step,4);check('failure reason',f.reason,'read_file touched secret path matching "secrets/**"');check('failure policyId',f.policyId,'no-secrets-read/v2');check('root shape',/^[0-9a-f]{64}$/.test(f.sessionRoot),true);check('failure chain',f.chainBrokenAt,null);
 });
 await row('API-GET-EXPLAIN-SUCCESS','/verify',async({check,request})=>{
  const b=await request('/api/explain');for(const k of ['sessionId','verdict','policyId'])check(`${k} string`,typeof b[k],'string');check('policyId',b.policyId,'no-secrets-read/v2');check('policy alias',b.policyId,b.policy);check('steps count',b.steps.length,5);
  for(const s of b.steps){check('step number',typeof s.step,'number');for(const k of ['receipt','timestamp','command','outcome'])check(`${k} string`,typeof s[k],'string');check('finding enum',['allowed','tool-error','violation','untrusted','unchecked'].includes(s.finding),true);check('detail nullable string',s.detail===null||typeof s.detail==='string',true);check('why strings',Array.isArray(s.why)&&s.why.every(v=>typeof v==='string'),true);check('cites array',Array.isArray(s.cites),true);for(const c of s.cites){check('cite step',typeof c.step,'number');for(const k of ['role','hash','note'])check(`cite ${k}`,typeof c[k],'string');}}
  check('denied step',b.steps[3].outcome,'denied');check('denied finding',b.steps[3].finding,'violation');
 });
 await row('WEB-FLOW-RECORDER-TAMPER-CYCLE','/recorder',async({page,check,text,snap})=>{
  const lamp=name=>page.locator('.rc-lamp').filter({has:page.locator('.rc-lamp-label',{hasText:new RegExp(`^${name}$`)})}).locator('b');
  await expect(lamp('Chain')).toHaveText('Verified');for(const name of ['Zetaris','Meterless'])await expect(lamp(name)).toHaveText('Setup required');
  await page.getByRole('button',{name:'Prove: no secrets read',exact:true}).click();await expect(lamp('No-secrets proof')).toHaveText('Fail · 04');
  await page.getByLabel('Block to tamper').selectOption('2');await page.getByRole('button',{name:'Tamper',exact:true}).click();await expect(page.locator('.rc-notice')).toHaveText('Block 2 edited on disk. Verification now rejects its signature.');check('tamper notice',await text('.rc-notice'),'Block 2 edited on disk. Verification now rejects its signature.');
  for(const [name,value]of [['Chain','Broken · 02'],['Tamper test','Edited · 02'],['No-secrets proof','Stale']]){await expect(lamp(name)).toHaveText(value);check(name,await lamp(name).textContent(),value);}
  check('status',(await text('.rc-rec')).includes('Tamper detected'),true);check('rejected signature',await text('#block-2 .rc-pill'),'Signature fails');
  for(const n of [3,4,5])check(`downstream ${n}`,await text(`#block-${n} .rc-pill`),'Untrusted');
  const rejected=page.getByLabel('Readouts').locator('div').filter({has:page.locator('.stencil',{hasText:/^Rejected$/})}).locator('b');check('Rejected count',await rejected.innerText(),'01');await snap('tampered');
  const response=page.waitForResponse(r=>r.url()===origin+'/api/session'&&r.request().method()==='GET');await page.getByRole('button',{name:'Re-verify',exact:true}).click();check('reverify status',(await response).status(),200);await expect(lamp('Chain')).toHaveText('Broken · 02');check('reverify rejected count',await rejected.innerText(),'01');for(const n of [3,4,5])check(`reverify downstream ${n}`,await text(`#block-${n} .rc-pill`),'Untrusted');await snap('reverified');
  await page.getByRole('button',{name:'Restore',exact:true}).click();await expect(page.locator('.rc-notice')).toHaveText('Restored block(s) 2 to their signed originals.');check('restore notice',await text('.rc-notice'),'Restored block(s) 2 to their signed originals.');await expect(lamp('Chain')).toHaveText('Verified');check('restored chain',await lamp('Chain').textContent(),'Verified');check('restored tamper',await lamp('Tamper test').textContent(),'Off');check('Restore disabled',await page.getByRole('button',{name:'Restore',exact:true}).isDisabled(),true);check('restored Rejected',await rejected.innerText(),'00');
 });
}finally{await cleanup();}
const pass=results.filter(r=>r.status==='PASS').length,fail=results.filter(r=>r.status==='FAIL').length;
writeFileSync(resolve('audit/results-web-phase4.md'),`# Phase 4 web re-check\n\n${pass} PASS, ${fail} FAIL across ${results.length} requested IDs. Real Google Chrome; production Next server built from this worktree. No full pnpm test:e2e run.\n\n| ID | Result | Evidence |\n| --- | --- | --- |\n${results.map(r=>`| ${r.id} | ${r.status} | [evidence](web-phase4/${r.id}/evidence.md) |`).join('\n')}\n\nExpectations: Phase 4 user corrections are authoritative for the five corrected page rows; this worktree's AUDIT.md still contains older text for those rows and was left unchanged. API expectations were read verbatim from AUDIT.md. The API prove row additionally verifies the changed success proof aliases, native signature proof, and commitment openings before recording the denied call.\n\nBoundary injection: a deliberate String.padStart render fault reaches the actual React error boundary. Its one React console.error is quoted in full in that row's evidence; no console output was suppressed. Any additional console error, page error or HTTP failure fails a row.\n\nIsolation: fresh real proxy receipts and ephemeral signing material in a unique /private/tmp directory; only public fixture files read. The denied secrets/ path does not exist and is refused before filesystem access. No .env, pre-existing keys, seeds or wallets read. Server environment excludes external credentials; no Zetaris, Meterless or Walrus publisher call. Their recorder lamps show Setup required.\n\nVerification: pnpm install --frozen-lockfile and pnpm build passed; [build log](web-phase4/build.log). No product changes were necessary unless explicitly listed below. No commit or push. AUDIT.md, packages/ sources, receipts/, release/, and audit/web/ were left unchanged.\n\nCleanup: Chrome and Next processes stopped, temporary receipt/key directory removed, heavy slot bb-audit-web released. [Lifecycle log](web-phase4/lifecycle.log).\n${fail?'\nFailures:\n'+results.filter(r=>r.status==='FAIL').map(r=>`- ${r.id}: ${r.failures.join('; ')}`).join('\n'):''}`);
console.log(`${pass} PASS, ${fail} FAIL; slot released`);process.exitCode=fail?1:0;
