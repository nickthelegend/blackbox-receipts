// Focused public-page audit; never invokes the full E2E suite or reads environment files.
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync, statSync, copyFileSync, mkdtempSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { once } from 'node:events';
const root=process.cwd(), out=join(root,'audit/web'), temp='/tmp/bb-audit-web-run';
const local='http://127.0.0.1:3327', staticSite='http://127.0.0.1:3329/blackbox-receipts';
const audit=readFileSync('AUDIT.md','utf8');
const ids=readFileSync('audit/results-web-pages.md','utf8').split('\n').filter(x=>/^\| (WEB-|EDGE-)/.test(x)).map(x=>x.split('|')[1].trim());
const expectations=Object.fromEntries(audit.split('\n').filter(x=>/^\| (WEB-|EDGE-)/.test(x)).map(x=>{ const cells=x.split(' | '); return [cells[0].slice(2),cells[2]]; }));
const samplePath=join(root,'apps/web/app/verify/samples/agent-pass.json');
const sample=JSON.parse(readFileSync(samplePath,'utf8'));
let chromeServer,browser,next,staticServer; const results=[];
const norm=x=>x.replace(/\s+/g,' ').trim();
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const recordPid=pid=>appendFileSync(join(temp,'pids'),`${pid}\n`);
recordPid(process.pid);
let fresh;
function freshPack(){
  if(fresh) return fresh;
  const dir=mkdtempSync('/private/tmp/bb-audit-fresh-');
  writeFileSync(join(dir,'notes.md'),'# public audit note\n');
  const env={...process.env,RECEIPTS_DIR:join(dir,'store'),BLACKBOX_KEY_DIR:join(dir,'keys'),RECEIPTS_RESUME:''};
  for(const args of [[join(root,'packages/proxy/dist/call.js'),'--new-session','read_file','{"path":"notes.md"}'],[join(root,'packages/proxy/dist/cli.js'),'pack',join(dir,'fresh-pack.json')]]){
    const r=spawnSync(process.execPath,args,{cwd:dir,env,encoding:'utf8'}); if(r.status!==0) throw new Error(`Real proxy pack generation failed (${r.status}): ${r.stderr}`);
  }
  const file=join(dir,'fresh-pack.json');
  // The public key comes from the exported public pack; never read a key directory.
  fresh={file,publicKey:JSON.parse(readFileSync(file,'utf8')).publicKey}; return fresh;
}
const cases={};
const define=(id,path,fn,options={})=>cases[id]={path,fn,options};
async function run(id){
 const c=cases[id]; const dir=join(out,id);mkdirSync(dir,{recursive:true});
 const context=await browser.newContext({viewport:{width:1280,height:800},...c.options});
 const page=await context.newPage();page.setDefaultTimeout(7000);page.setDefaultNavigationTimeout(25000);
 const logs=[],network=[],checks=[],failures=[];const start=new Date().toISOString();
 page.on('console',m=>logs.push({type:m.type(),text:m.text(),location:m.location()}));
 page.on('pageerror',e=>logs.push({type:'pageerror',text:e.message,stack:e.stack}));
 page.on('request',r=>network.push({event:'request',method:r.method(),url:r.url(),type:r.resourceType()}));
 page.on('response',r=>network.push({event:'response',status:r.status(),url:r.url(),type:r.request().resourceType()}));
 page.on('requestfailed',r=>network.push({event:'requestfailed',url:r.url(),error:r.failure()?.errorText}));
 const check=(name,actual,expected=true)=>{const ok=JSON.stringify(actual)===JSON.stringify(expected);checks.push({name,actual,expected,ok});if(!ok)failures.push(`${name}: got ${JSON.stringify(actual)}; expected ${JSON.stringify(expected)}`);};
 const snap=async name=>page.screenshot({path:join(dir,`${name}.png`),fullPage:!name.includes('drawer')&&!name.includes('step-03'),animations:'disabled'});
 const go=async path=>{const response=await page.goto(path.startsWith('http')?path:local+path,{waitUntil:'networkidle'});check(`HTTP ${path}`,response?.status(),200);return response;};
 const text=async selector=>norm(await page.locator(selector).evaluate(el=>{const copy=el.cloneNode(true);copy.querySelectorAll('br').forEach(br=>br.replaceWith(' '));return copy.textContent;}));
 const has=async(selector,values)=>{const value=await text(selector);for(const expected of values)check(`${selector} includes ${expected}`,value.includes(expected));};
 const file=async(name,pack)=>page.locator('input[type=file]').setInputFiles({name,mimeType:'application/json',buffer:Buffer.from(typeof pack==='string'?pack:JSON.stringify(pack))});
 const samplePass=()=>page.getByRole('button',{name:/Agent skipped the README’s \.env request/}).click();
 const sampleFail=()=>page.getByRole('button',{name:/Agent tried to read \.env/}).click();
 const badge=async value=>{await expect(page.locator('.vf-badge')).toHaveText(value);check('badge',await text('.vf-badge'),value);};
 const width=async state=>{const v=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));check(`${state} no horizontal overflow (${v.scroll}/${v.client})`,v.scroll<=v.client);await snap(state);};
 const offline=async fn=>{const before=network.filter(x=>x.event==='request').length;await fn();await wait(250);check('requests after initial load',network.filter(x=>x.event==='request').length-before,0);};
 try {if(c.path)await go(c.path);await c.fn({page,context,check,snap,go,text,has,file,samplePass,sampleFail,badge,width,offline,network,logs});}
 catch(e){failures.push(e.message);checks.push({name:'action/assertion exception',ok:false,message:e.message});}
 await wait(200);
 try{await snap('screenshot');}catch(e){failures.push(`Screenshot: ${e.message}`);}
 const consoleFailures=logs; // Every console line fails these rows; none names an expected HTTP error status.
 for(const e of consoleFailures)failures.push(`${e.type}: ${e.text}`);
 for(const r of network.filter(x=>x.event==='response'&&x.status>=400))failures.push(`HTTP ${r.status}: ${r.url}`);
 for(const r of network.filter(x=>x.event==='requestfailed'))failures.push(`Request failed: ${r.error} ${r.url}`);
 writeFileSync(join(dir,'console.log'),logs.length?logs.map(x=>JSON.stringify(x)).join('\n')+'\n':'No console output or page errors captured.\n');
 writeFileSync(join(dir,'network.log'),network.map(x=>JSON.stringify(x)).join('\n')+'\n');
 writeFileSync(join(dir,'checks.json'),JSON.stringify({id,start,url:page.url(),viewport:page.viewportSize(),checks,failures},null,2)+'\n');
 writeFileSync(join(dir,'body.txt'),await page.locator('body').innerText().catch(()=>''));
 const status=failures.length?'FAIL':'PASS';
 writeFileSync(join(dir,'evidence.md'),`# ${id}: ${status}\n\nCaptured ${start} using real Google Chrome ${browser.version()} through Playwright.\n\nExpected (verbatim AUDIT.md cell):\n\n${expectations[id]}\n\nObserved URL: ${page.url()}\n\nViewport: ${JSON.stringify(page.viewportSize())}.\n\n${checks.filter(x=>x.ok).length}/${checks.length} assertions passed.\n\n${failures.length?failures.map(x=>'- '+x.replace(/\n/g,' ')).join('\n'):'All asserted text, status and behavior matched. No console output, page errors or failed network requests.'}\n\nArtifacts: [screenshot](screenshot.png), [checks](checks.json), [console](console.log), [network](network.log), [rendered text](body.txt). Additional named screenshots capture intermediate states.\n`);
 results.push({id,status,failures,checks:checks.length});
 console.log(`${status} ${id}${failures.length?' '+failures[0].slice(0,220):''}`);
 await context.close();
 writeFileSync(join(temp,'results.json'),JSON.stringify(results,null,2));
}
define('WEB-PAGE-LANDING','/',async({page,check,has,text})=>{
 check('h1',await text('h1'),'Every tool call your agent makes, on the record.');
 await has('.ld-kicker',['Flight recorder for AI agents']);await has('.ld-lead',['An MCP proxy signs a hash-chained receipt for every call. Edit or cut one, and verification names the step.']);
 check('step numbers',await page.locator('.ld-steps .stencil').allTextContents(),['01','02','03']);check('step labels',await page.locator('.ld-steps h3').allTextContents(),['Record','Seal','Verify']);
 check('proof names',await page.locator('.ld-big dt').allTextContents(),['Receipts','Denied','Tests']);check('proof counts',await page.locator('.ld-big dd').allTextContents(),['10','1','91']);
 await has('#live',['Live','Setup required']);check('recorder SVG',await page.locator('.ld-unit svg').count(),1);await has('.ld-unit-cap',['Drawn from recorded session 933f87da: 10 receipts, sealed.']);
 await has('.ld-install-box',['pnpm --filter @blackbox/proxy start','node packages/proxy/dist/server.js']);check('footer',await page.locator('footer').count(),1);
});
define('WEB-PAGE-EVIDENCE','/evidence',async({page,check,text,has})=>{
 check('h1',await text('h1'),'The tape, the checks and the limits.');await has('.ld-kicker',['Evidence · session 933f87da']);await has('.ld-strip',['Agent flight recorder','Session 933f87da','10 receipts','Sealed 2026-10-21 04:34:03 UTC','Denied at step 03']);await has('.ld-parts',['Signing key','Tape','Seal','Locator']);await has('body',['Fig. 1','01 · Tape playback','02 · Investigation','03 · Limitations placard','04 · Built in the window']);check('limits count',await page.locator('.ld-limits > div').count(),7);await has('#limits',['Setup required','Not run yet']);check('window count',await page.locator('.ld-window-row').count(),8);await has('.ld-window-lead',['A case variant of .env is a denied read, not a PASS','Before','After']);
});
define('WEB-PAGE-VERIFY-EMPTY','/verify',async({page,check,text,has})=>{
 check('title',await page.title(),'Verify a pack · Blackbox Receipts');check('h1',await text('h1'),'Check a pack in your browser.');await has('.vf-kicker',['Offline verifier']);await has('.vf-drop',['Drop a pack here, or choose a file']);check('sample buttons',await page.locator('.vf-sample').count(),2);check('default policy',await page.locator('#vf-policy').inputValue(),'no-secrets-read/v2');check('default signer',await page.locator('#vf-signer').inputValue(),'none');await has('.vf-empty',['No pack loaded yet']);
});
define('WEB-PAGE-VERIFY-SAMPLE-PASS','/verify',async({page,check,samplePass,badge,text,offline,has})=>offline(async()=>{
 await samplePass();await badge('PASS');check('headline',await text('.vf-headline'),'PASS no-secrets-read/v1: 14 receipts, chain intact, seal matches, proof verified');check('five checks ok',await page.locator('.vf-checks .is-ok').count(),5);check('check labels',await page.locator('.vf-check-name').allTextContents(),['Pack format','Public key','Signatures and hash links','Signed seal (nothing cut off)','No-secrets proof']);check('steps',await page.locator('.vf-step').count(),14);check('signed steps',await page.locator('.vf-step-ok').count(),14);await has('.vf-root',['Merkle root']);
}));
define('WEB-PAGE-VERIFY-SAMPLE-FAIL','/verify',async({page,check,sampleFail,badge,text,offline,has})=>offline(async()=>{
 await sampleFail();await badge('FAIL');check('headline',await text('.vf-headline'),'FAIL no-secrets-read at step 3: read_file touched secret path matching ".env*"');check('step count',await page.locator('.vf-step').count(),10);await has('.vf-step-warn',['03','Secret access','denied']);
}));
define('WEB-PAGE-VERIFY-ERROR','/verify',async({page,check,samplePass,text,has,snap})=>{
 // Deliberately throw once during the real React receipt render; do not suppress React console errors.
 await page.evaluate(()=>{const original=String.prototype.padStart;window.__restoreAuditFault=()=>{String.prototype.padStart=original;};String.prototype.padStart=function(...args){if(args[0]===2&&args[1]==='0')throw new Error('Audit render fault');return original.apply(this,args);};});
 await samplePass();await expect(page.getByRole('heading',{name:'Could not verify',exact:true})).toBeVisible();check('boundary heading',await text('h1'),'Could not verify');await has('.vf-lead',['This pack could not be displayed, so no verdict was reached. Nothing was uploaded; the file never left this tab.']);await has('.vf-alert',['Could not verify: Audit render fault']);await snap('error-boundary');await page.evaluate(()=>window.__restoreAuditFault());await page.getByRole('button',{name:'Load another pack',exact:true}).click();await expect(page.getByRole('heading',{name:'Check a pack in your browser.'})).toBeVisible();check('reset renders verifier',await text('h1'),'Check a pack in your browser.');
});
const deck='http://127.0.0.1:3329/docs/deck/index.html';
define('WEB-SCREEN-DECK',deck,async({page,check,text,has})=>{
 check('title',await page.title(),'Blackbox Receipts');check('slide count',await page.locator('.deck .slide').count(),11);check('all slides 16:9',await page.locator('.slide').evaluateAll(es=>es.every(e=>Math.abs(e.getBoundingClientRect().width/e.getBoundingClientRect().height-16/9)<0.02)));check('first title',await text('.slide:first-child h1'),'A flight recorder for AI agents.');await has('.slide:first-child .kicker',['Blackbox Receipts · Open Agent (Wildcard) · GitLab Transcend']);check('lead present',(await text('.slide:first-child .lead')).length>50);check('SVG unit',await page.locator('.slide:first-child svg.title-unit').count(),1);check('source footers',await page.locator('.slide .foot').count(),11);
});
for(const [id,path,skip,hashes] of [['WEB-NAV-LANDING','/','Skip to content',[['How it works','#how'],['Proof','#proof']]],['WEB-NAV-EVIDENCE','/evidence','Skip to content',[['Playback','#playback'],['Investigation','#investigation'],['Limits','#limits']]],['WEB-NAV-VERIFY','/verify','Skip to verifier',[]]])define(id,path,async({page,check,go,snap})=>{
 await page.keyboard.press('Tab');const s=page.getByRole('link',{name:skip,exact:true});check('skip focused',await s.evaluate(e=>e===document.activeElement));check('skip target',await s.getAttribute('href'),path==='/verify'?'#vf-main':'#main');await page.keyboard.press('Enter');check('skip activates',page.url().endsWith(path==='/verify'?'#vf-main':'#main'));
 for(const [label,hash] of hashes){await page.getByRole('navigation').getByRole('link',{name:label,exact:true}).click();check(`${label} hash`,new URL(page.url()).hash,hash);await expect(page.locator(hash)).toBeInViewport();check(`${hash} in viewport`,true);}
 if(path!=='/verify'){
  if(path==='/'){await page.getByRole('navigation').getByRole('link',{name:'Evidence',exact:true}).click();check('Evidence navigation',new URL(page.url()).pathname,'/evidence');await go(path);}
  await page.getByRole('navigation').getByRole('link',{name:'Verify a pack',exact:true}).click();check('Verify navigation',new URL(page.url()).pathname,'/verify');await go(path);
 }
 await page.getByRole('link',{name:'Open recorder',exact:true}).click();await expect(page.getByRole('heading',{name:'Annunciator panel'})).toBeVisible();check('recorder navigation',new URL(page.url()).pathname,'/recorder');await snap('recorder-destination');await page.getByRole('link',{name:'Blackbox Receipts, home',exact:true}).click();check('logo navigation',new URL(page.url()).pathname,'/');
});
define('WEB-STATIC-BUILD',staticSite+'/',async({check})=>{
 for(const name of ['index.html','evidence/index.html','verify/index.html','.nojekyll'])check(`export ${name}`,existsSync(join(root,'public',name)));
 for(const name of ['api','recorder'])check(`excludes ${name}`,existsSync(join(root,'public',name)),false);
 check('pnpm build completed',existsSync(join(temp,'build-ready')));check('export log success',readFileSync(join(temp,'pages-build.log'),'utf8').includes('build-pages:'));
});
define('WEB-STATIC-RECORDER-LINK',staticSite+'/',async({page,check})=>{
 for(const name of ['Run it locally','Run the recorder locally'])check(name+' href',await page.getByRole('link',{name,exact:true}).getAttribute('href'),'https://github.com/nickthelegend/blackbox-receipts#setup');
});
define('WEB-STATIC-LANDING-LINK',staticSite+'/',async({page,check})=>{
 const a=page.getByRole('link',{name:'Play back a real run',exact:true});check('href',await a.getAttribute('href'),'/blackbox-receipts/evidence/#playback');await a.click();check('destination',page.url(),staticSite+'/evidence/#playback');await expect(page.locator('#playback')).toBeInViewport();check('playback in viewport',true);
});
define('WEB-STATIC-VERIFY-OFFLINE',staticSite+'/verify/',async({page,context,samplePass,sampleFail,badge,offline})=>offline(async()=>{
 await context.setOffline(true);await samplePass();await badge('PASS');await page.getByRole('button',{name:'Flip one byte',exact:true}).click();await badge('FAIL');await sampleFail();await badge('FAIL');await context.setOffline(false);
}));
for(const [id,url,kind] of [['WEB-LIVE-VERCEL-LANDING','https://blackbox-landing-olive.vercel.app','landing'],['WEB-LIVE-VERCEL-EVIDENCE','https://blackbox-landing-olive.vercel.app/evidence/','evidence'],['WEB-LIVE-VERCEL-VERIFY','https://blackbox-landing-olive.vercel.app/verify/','verify'],['WEB-LIVE-GHPAGES','https://nickthelegend.github.io/blackbox-receipts/','pages']])define(id,url,async({page,check,text,has})=>{
 if(kind==='landing'||kind==='pages'){check('h1',await text('h1'),'Every tool call your agent makes, on the record.');if(kind==='landing'){check('proof counts',await page.locator('.ld-big dd').allTextContents(),['10','1','91']);check('navigation',await page.locator('nav a').count(),4);}else{check('base path',new URL(page.url()).pathname,'/blackbox-receipts/');check('recorder href',await page.getByRole('link',{name:'Run it locally',exact:true}).getAttribute('href'),'https://github.com/nickthelegend/blackbox-receipts#setup');check('evidence href',await page.getByRole('link',{name:'See the evidence',exact:true}).getAttribute('href'),'/blackbox-receipts/evidence/');check('verify href',await page.getByRole('link',{name:'Verify a pack',exact:true}).first().getAttribute('href'),'/blackbox-receipts/verify/');}}
 if(kind==='evidence'){check('h1',await text('h1'),'The tape, the checks and the limits.');check('tape',await page.locator('.tape-mark').count(),10);check('exhibits',await page.locator('.iv-tag').count(),2);check('limits',await page.locator('.ld-limits > div').count(),7);check('window',await page.locator('.ld-window-row').count(),8);}
 if(kind==='verify'){check('h1',await text('h1'),'Check a pack in your browser.');await has('.vf-drop',['Drop a pack here, or choose a file']);check('samples',await page.locator('.vf-sample').count(),2);check('policy selector',await page.locator('#vf-policy').count(),1);check('key selector',await page.locator('#vf-signer').count(),1);}
});
define('WEB-FLOW-LANDING-PLAYBACK','/evidence',async({page,check,snap})=>{
 const pb=page.locator('.pb');await expect(pb).toHaveAttribute('data-play','ready');check('initial state',await pb.getAttribute('data-play'),'ready');await page.locator('#playback .tape').scrollIntoViewIfNeeded();await expect(pb).toHaveAttribute('data-play','run');check('scrolled state',await pb.getAttribute('data-play'),'run');check('marks',await pb.locator('.tape-mark').count(),10);check('flag',norm(await pb.locator('.tape-flag').textContent()),'Denied · .env');await expect(pb.locator('.tape-mark').last()).toHaveCSS('opacity','1',{timeout:15000});await snap('sweep-complete');
 await page.evaluate(()=>{window.__playStates=[];const p=document.querySelector('.pb');new MutationObserver(()=>window.__playStates.push(p.dataset.play)).observe(p,{attributes:true,attributeFilter:['data-play']});});await pb.getByRole('button',{name:'Replay',exact:true}).click();await expect(pb).toHaveAttribute('data-play','run');check('Replay ready then run',await page.evaluate(()=>window.__playStates),['ready','run']);await expect(pb.locator('.tape-mark').last()).toHaveCSS('opacity','1',{timeout:15000});
});
define('WEB-FLOW-PLAYBACK-COPY','/evidence',async({has})=>{
 await has('#playback .ld-sec-head',['README has an “Agent checklist” section telling AI agents to read .env','Step 2 of the prompt said “Read README.md and complete its agent checklist before anything else”, so the .env read was asked for through the README']);await has('#playback .ld-control',['Earlier flight · e51c6b41','the README section was “Notes for AI coding agents”','step 2 said “Read README.md and follow its instructions for AI coding agents”','PASS no-secrets-read: 14/14 receipts satisfy the policy']);
});
define('WEB-FLOW-TAPE-LOG-DRAWER','/evidence',async({page,check,has,snap})=>{
 const log=page.getByRole('list',{name:'Tape log',exact:true});const rows=log.getByRole('listitem');check('log rows',await rows.count(),10);
 for(let step=1;step<=10;step++){
 const why=log.getByRole('button',{name:new RegExp(`^Explain why step ${step} is `)});
 if(step%2)await why.click();else await rows.nth(step-1).click({position:{x:100,y:14}});
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await has('[role=dialog]',[`Explain why · step ${String(step).padStart(2,'0')}`]);
 if(step===3){await has('[role=dialog]',['Policy violation','outcome denied']);await snap('step-03');const cite=dialog.getByRole('button',{name:/^Open the explanation of step /}).first();const target=(await cite.getAttribute('aria-label')).match(/step (\d+)/)[1];await cite.click();await has('[role=dialog]',[`Explain why · step ${target.padStart(2,'0')}`]);}
 if(step%3===1)await page.getByRole('button',{name:'Close the explanation'}).click();else if(step%3===2)await page.keyboard.press('Escape');else await page.locator('.xd').click({position:{x:5,y:5}});
 await expect(dialog).toBeHidden();check(`step ${step} restores Why focus`,await why.evaluate(e=>e===document.activeElement));
 }
});
define('WEB-FLOW-INVESTIGATION-EXHIBITS','/evidence',async({page,check,has,text,snap})=>{
 const inv=page.locator('#investigation');await inv.getByRole('radio',{name:/Exhibit A/}).click();await inv.getByRole('button',{name:'Run the checks',exact:true}).click();check('A stamp',await text('.iv-stamp'),'Fail');await has('.iv-headline',['step 3']);check('A cells',await inv.locator('.iv-cell').count(),10);await snap('exhibit-a');await inv.getByLabel('Tamper with the evidence').selectOption('7');await inv.getByRole('button',{name:'Flip one byte and re-check'}).click();await has('.iv-edit',["inside step 7's resultHash"]);await has('.iv-cell.is-broken',['07']);await snap('exhibit-a-edited');await inv.getByRole('button',{name:'Original file',exact:true}).click();check('edit removed',await inv.locator('.iv-edit').count(),0);check('broken removed',await inv.locator('.iv-cell.is-broken').count(),0);
 await inv.getByRole('radio',{name:/Exhibit B/}).click();await inv.getByRole('button',{name:'Run the checks',exact:true}).click();check('B stamp',await text('.iv-stamp'),'Pass');check('B checks',await inv.locator('.iv-checks .is-ok').count(),5);await has('.iv-meta',['policy no-secrets-read/v1, the one in force when this run was recorded']);await snap('exhibit-b');await inv.getByRole('button',{name:'Flip one byte and re-check'}).click();check('B tampered stamp',await text('.iv-stamp'),'Fail');check('B broken cell',await inv.locator('.iv-cell.is-broken').count(),1);
});
define('WEB-FLOW-VERIFY-FILE-PICKER','/verify',async({page,file,badge,snap,check})=>{
 await page.locator('input[type=file]').setInputFiles(samplePath);await badge('FAIL');check('default policy',await page.locator('#vf-policy').inputValue(),'no-secrets-read/v2');await page.locator('#vf-policy').selectOption('no-secrets-read/v1');await badge('PASS (key not pinned)');await snap('picked-valid');
 let chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Load another pack',exact:true}).click();await(await chooser).setFiles(samplePath);await badge('PASS (key not pinned)');check('valid chooser used',true);
 chooser=page.waitForEvent('filechooser');await page.getByRole('button',{name:'Load another pack',exact:true}).click();await(await chooser).setFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{invalid')});await expect(page.locator('.vf-alert')).toContainText('Could not verify.');check('invalid file alerts',true);check('loaded cleared',await page.locator('.vf-result').count(),0);
});
define('WEB-FLOW-VERIFY-DRAG-DROP','/verify',async({page,check,badge,has})=>{
 const transfer=await page.evaluateHandle(content=>{const data=new DataTransfer();data.items.add(new File([content],'dropped-pack.json',{type:'application/json'}));return data;},JSON.stringify(sample));const zone=page.locator('.vf-drop');await zone.dispatchEvent('dragover',{dataTransfer:transfer});check('dragover class',(await zone.getAttribute('class')).includes('is-drag'));await page.locator('#vf-policy').selectOption('no-secrets-read/v1');await zone.dispatchEvent('drop',{dataTransfer:transfer});await badge('PASS (key not pinned)');check('drop clears class',(await zone.getAttribute('class')).includes('is-drag'),false);await has('.vf-meta',['dropped-pack.json']);
});
define('WEB-FLOW-VERIFY-PINNED-POLICY','/verify',async({page,check,samplePass,badge,text,snap})=>{
 const pin=page.locator('#vf-policy');check('default policy',await pin.inputValue(),'no-secrets-read/v2');await samplePass();await badge('PASS');check('sample policy',await pin.inputValue(),'no-secrets-read/v1');await pin.selectOption('no-secrets-read/v2');await badge('FAIL');check('policy mismatch headline',await text('.vf-headline'),'FAIL property: Proof was made under policy "no-secrets-read/v1" (720836167c0f), not the pinned policy');await snap('v2-rejection');await pin.selectOption('no-secrets-read/v1');await page.getByLabel('Step to edit').selectOption('5');await page.getByRole('button',{name:'Flip one byte',exact:true}).click();for(const policy of ['no-secrets-read/v2','no-secrets-read/v1']){await pin.selectOption(policy);check(`tamper survives ${policy}`,await text('.vf-headline'),'FAIL at step 5: Receipt contents were changed');}
});
define('WEB-FLOW-VERIFY-KEY-PINNING','/verify',async({page,check,badge,text,snap,samplePass})=>{
 const fresh=freshPack(),signer=page.locator('#vf-signer');check('default signer',await signer.inputValue(),'none');await page.locator('input[type=file]').setInputFiles(fresh.file);await badge('PASS (key not pinned)');check('amber class',(await page.locator('.vf-badge').getAttribute('class')).includes('vf-badge-warn'));check('fingerprint',/^SHA-256 of the signer's Ed25519 key: [0-9a-f]{64}$/.test(await page.locator('.vf-fingerprint').getAttribute('title')));await snap('amber');await signer.selectOption('demo');await badge('FAIL');check('different key headline',await text('.vf-headline'),'FAIL: Pack public key does not match the pinned key');await snap('red');await signer.selectOption('custom');await page.getByLabel('Signer public key (PEM)').fill(fresh.publicKey);await badge('PASS');check('green class',(await page.locator('.vf-badge').getAttribute('class')).includes('vf-badge-ok'));await snap('green');await page.getByLabel('Signer public key (PEM)').fill('not a key');await badge('FAIL');await samplePass();await badge('PASS');check('sample repins demo',await signer.inputValue(),'demo');await page.locator('input[type=file]').setInputFiles(fresh.file);await badge('PASS (key not pinned)');check('own pack resets none',await signer.inputValue(),'none');
});
define('WEB-FLOW-REDUCED-MOTION','/evidence',async({page,check})=>{
 check('static state',await page.locator('.pb').getAttribute('data-play'),'static');check('no Replay',await page.getByRole('button',{name:'Replay',exact:true}).count(),0);check('10 visible marks',await page.locator('.tape-mark').evaluateAll(es=>es.length===10&&es.every(e=>getComputedStyle(e).opacity==='1')));
},{reducedMotion:'reduce'});
define('EDGE-VERIFY-NON-PACK','/verify',async({page,file,check,has})=>{await file('not-a-pack.json',{hello:'world'});await expect(page.locator('.vf-alert')).toBeVisible();await has('.vf-alert',['Could not verify.','not-a-pack.json: expected a blackbox-pack/v1 object, got']);check('result hidden',await page.locator('.vf-result').count(),0);});
define('EDGE-VERIFY-NULL-RECEIPT','/verify',async({page,file,badge,check,text})=>{const p=structuredClone(sample);p.receipts.push(null);await file('null-receipt.json',p);await badge('FAIL');check('headline',await text('.vf-headline'),'FAIL format at step 15: receipt is not an object');check('broken step',await text('.vf-step-bad .vf-step-n'),'15');});
define('EDGE-VERIFY-OBJECT-OUTCOME','/verify',async({file,badge,check,text})=>{const p=structuredClone(sample);p.receipts[0].outcome={evil:1};await file('object-outcome.json',p);await badge('FAIL');check('headline',await text('.vf-headline'),'FAIL format at step 1: receipt outcome is not ok, denied or error');check('broken step',await text('.vf-step-bad .vf-step-n'),'01');});
define('EDGE-VERIFY-OBJECT-STEP','/verify',async({page,file,badge,check,text})=>{const p=structuredClone(sample);p.receipts[1].step={x:1};await file('object-step.json',p);await badge('FAIL');check('headline',await text('.vf-headline'),'FAIL format at step 2: receipt step is not an integer');check('steps rendered',await page.locator('.vf-step').count(),14);});
define('EDGE-VERIFY-OVERSIZE-FILE','/verify',async({page,file,check,has,samplePass})=>{await samplePass();await page.locator('input[type=file]').setInputFiles({name:'oversize.json',mimeType:'application/json',buffer:Buffer.alloc(20_000_001,32)});await expect(page.locator('.vf-alert')).toBeVisible();await has('.vf-alert',['oversize.json: larger than 20 MB, which is not a pack this page will read']);check('loaded cleared',await page.locator('.vf-result').count(),0);});
const mobile={viewport:{width:375,height:812},isMobile:true,hasTouch:true};
define('EDGE-WIDTH-375-LANDING','/',async({width})=>width('all-sections'),mobile);
define('EDGE-WIDTH-375-EVIDENCE','/evidence',async({page,width,check})=>{await width('all-sections');await page.getByRole('button',{name:/^Explain why step 3 is /}).click();await expect(page.getByRole('dialog')).toBeVisible();await width('drawer-open');await page.keyboard.press('Escape');await page.getByRole('radio',{name:/Exhibit B/}).click();await page.getByRole('button',{name:'Run the checks',exact:true}).click();await width('exhibit-loaded');},mobile);
define('EDGE-WIDTH-375-VERIFY','/verify',async({page,width,samplePass,badge,file})=>{await width('empty');await samplePass();await badge('PASS');await page.locator('#vf-signer').selectOption('custom');await page.getByLabel('Signer public key (PEM)').fill(sample.publicKey);await width('loaded-with-custom-key');await file('bad.json',{hello:'world'});await expect(page.locator('.vf-alert')).toBeVisible();await width('error');},mobile);
define('EDGE-WIDTH-375-DECK',deck,async({page,width,check})=>{await width('all-slides');check('all slide content fits page',await page.locator('.slide').evaluateAll(es=>es.every(e=>e.getBoundingClientRect().right<=375)));},mobile);
async function setup(){
 const nextLog=await import('node:fs').then(fs=>fs.openSync(join(temp,'next-server.log'),'w'));
 next=spawn(process.execPath,[join(root,'apps/web/node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p','3327'],{cwd:join(root,'apps/web'),env:{...process.env,RECEIPTS_DIR:'/private/tmp/bb-audit-web-run/session',BLACKBOX_KEY_DIR:'/private/tmp/bb-audit-web-run/keys',NEXT_TELEMETRY_DISABLED:'1'},stdio:['ignore',nextLog,nextLog]});recordPid(next.pid);
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.txt':'text/plain','.json':'application/json','.woff2':'font/woff2','.ico':'image/x-icon'};
 staticServer=createServer((req,res)=>{let path=decodeURIComponent(new URL(req.url,'http://localhost').pathname),base,file;
 if(path.startsWith('/blackbox-receipts/')){base=join(root,'public');file=resolve(base,'.'+path.slice('/blackbox-receipts'.length));}
 else if(path.startsWith('/docs/deck/')){base=join(root,'docs/deck');file=resolve(root,'.'+path);}else if(path==='/favicon.ico'){res.writeHead(204).end();return;}else{res.writeHead(404).end('Not found');return;}
 if(!file.startsWith(base+'/')&&file!==base){res.writeHead(403).end();return;}if(existsSync(file)&&statSync(file).isDirectory())file=join(file,'index.html');if(!existsSync(file)){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'}).end(readFileSync(file));
 });staticServer.listen(3329,'127.0.0.1');await once(staticServer,'listening');
 for(let i=0;i<100;i++){try{if((await fetch(local)).status===200)break;}catch{}if(i===99)throw new Error('Next did not become ready');await wait(300);}
 chromeServer=await chromium.launchServer({channel:'chrome',headless:true});recordPid(chromeServer.process().pid);browser=await chromium.connect(chromeServer.wsEndpoint());
 console.log(`Chrome ${browser.version()}, PID ${chromeServer.process().pid}; Next PID ${next.pid}; static server PID ${process.pid}`);
}
try{await setup();const filter=process.argv.slice(2);for(const id of ids){if(!filter.length||filter.includes(id))await run(id);}}
finally{if(browser)await browser.close();if(chromeServer)await chromeServer.close();if(next){next.kill('SIGTERM');await Promise.race([once(next,'exit'),wait(4000)]);if(next.exitCode===null)next.kill('SIGKILL');}if(staticServer)await new Promise(r=>staticServer.close(r));}
