import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const origin='https://ech-fixture.invalid';
const actor='10000000-0000-4000-8000-000000000001';
const draftId='70000000-0000-4000-8000-000000000001';
const assets=new Map(await Promise.all([['/admin/','index.html','text/html'],['/admin/admin.js','admin.js','text/javascript'],['/admin/admin.css','admin.css','text/css']].map(async([url,file,contentType])=>[url,{contentType,body:await readFile(new URL('../../dist/admin/'+file,import.meta.url))}])));
async function fixture(browser,{role='manager',create=true,entry='daily'}={}) {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 let authorized=true;const requests=[],unexpected=[],errors=[];
 await context.addInitScript(id=>{Object.defineProperty(crypto,'randomUUID',{value:()=>id});},draftId);
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());requests.push({method:r.method(),path:u.pathname,body:r.postData()});
  if(u.origin!==origin){unexpected.push(r.url());return route.abort();}
  if(assets.has(u.pathname)&&r.method()==='GET')return route.fulfill(assets.get(u.pathname));
  if(u.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(u.pathname==='/api/admin/session'&&r.method()==='GET')return authorized?route.fulfill({json:{authenticated:true,principal:{id:actor,email:'fictional@ech-fixture.invalid',technicalAdmin:false,applicationAdmin:false,operationalRole:role},capabilities:[role==='staff'?'leads.read_assigned':'leads.read_all',...(create?['leads.create']:[])],operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false}}}):route.fulfill({status:403,json:{error:'fixture denied'}});
  if(['/api/admin/inquiries','/api/admin/partners'].includes(u.pathname)&&r.method()==='GET')return route.fulfill({json:{schema:1,mode:'shared',items:[],nextCursor:null}});
  if(u.pathname==='/api/admin/operations'&&r.method()==='GET'&&u.searchParams.has('from'))return route.fulfill({json:{schema:1,mode:'shared',visits:[],clients:[],staff:[]}});
  if(u.pathname==='/api/admin/inquiries'&&r.method()==='POST')return route.fulfill({status:422,json:{error:'fictional no write'}});
  unexpected.push(r.method()+' '+u.pathname+u.search);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message)); await page.goto(origin+'/admin/?view='+entry);await page.getByRole('heading',{name:entry==='daily'?'Today':'Operations',exact:true}).waitFor();
 return {context,page,requests,unexpected,errors,deny:()=>{authorized=false;}};
}
const textName='Primary contact name';
test('manager shortcut retains intended synthetic draft from Today and Schedule; confirmation and invalidation',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const entry of ['daily','operations']) {const f=await fixture(browser,{entry});const {page}=f;
   await page.locator('.mobile-add-button').click(); const editor=page.locator('.shared-record-editor');await editor.waitFor();
   await editor.getByLabel(textName).fill('Fictional draft '+entry); await page.waitForTimeout(150);
   const nav=page.getByRole('navigation',{name:'Primary navigation'});
   page.once('dialog',dialog=>dialog.dismiss());await nav.getByRole('button',{name:'Today'}).click();
   assert.equal(await editor.getByLabel(textName).inputValue(),'Fictional draft '+entry);
   page.once('dialog',dialog=>dialog.dismiss());await nav.getByRole('button',{name:'Schedule'}).click();
   assert.equal(await editor.getByLabel(textName).inputValue(),'Fictional draft '+entry);
   // Fill required synthetic data; the intercepted POST is never sent to a service.
   for(const [label,value] of [['Phone number','555-0100'],['Person receiving care','Fictional recipient'],['City or service area','Fictional city'],['Main help requested','Fictional help'],['Next action','Fictional follow-up']]) await editor.getByLabel(label,{exact:true}).fill(value);
   await editor.getByRole('button',{name:'Save inquiry'}).click();
   await page.waitForTimeout(100);
   const post=f.requests.find(r=>r.method==='POST'&&r.path==='/api/admin/inquiries');assert.ok(post,'synthetic save command');assert.equal(JSON.parse(post.body).command.id,draftId);
   f.deny(); await page.locator('summary[aria-label="My account"]').click();await page.getByRole('button',{name:'Refresh account and records'}).click();
   await page.getByText('Session or record access is unverified.',{exact:false}).waitFor();assert.equal(await editor.count(),0);
   await page.waitForTimeout(150);assert.equal(await editor.count(),0,'invalidated pending draft cannot resurrect');assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
 } finally {await browser.close();}
});
test('manager tabs, denial, staff exclusion and modal focus on history and resize',async()=>{
 const browser=await chromium.launch({headless:true});try{
  const f=await fixture(browser,{create:false});let p=f.page;const nav=p.getByRole('navigation',{name:'Primary navigation'});
  assert.deepEqual((await nav.locator('button').allTextContents()).map(x=>x.trim()),['Today','Schedule','ReportsProposed','More']);
  assert.equal(await p.locator('.mobile-add-button').isDisabled(),true);assert.equal(await nav.locator('.mobile-tab-reports').isDisabled(),true);
  await nav.getByRole('button',{name:'More'}).click();await p.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));assert.equal(await p.locator('dialog').evaluate(e=>e.open),false);assert.equal(await nav.getByRole('button',{name:'More'}).evaluate(e=>document.activeElement===e),true);
  await nav.getByRole('button',{name:'More'}).click();await p.setViewportSize({width:900,height:800});await p.waitForFunction(()=>!document.querySelector('dialog').open);assert.equal(await p.locator('#workspace-content').evaluate(e=>document.activeElement===e),true);
  assert.equal(await p.locator('.desktop-add-button').isVisible(),true);assert.equal(await p.locator('.mobile-tabbar').isVisible(),false);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  const confirm=await fixture(browser);await confirm.page.locator('.mobile-add-button').click();await confirm.page.locator('.shared-record-editor').getByLabel(textName).fill('Fictional unsaved value');confirm.page.once('dialog',dialog=>dialog.accept());await confirm.page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Schedule'}).click();await confirm.page.getByRole('heading',{name:'Operations',exact:true}).waitFor();assert.equal(await confirm.page.locator('.shared-record-editor').count(),0);assert.deepEqual(confirm.unexpected,[]);assert.deepEqual(confirm.errors,[]);await confirm.context.close();
  const staff=await fixture(browser,{role:'staff',create:false});assert.equal(await staff.page.locator('.mobile-tabbar').count(),0);assert.equal(await staff.page.locator('.mobile-add-button').count(),0);assert.equal(await staff.page.locator('.mobile-navigation-trigger').isVisible(),true);assert.deepEqual(staff.unexpected,[]);assert.deepEqual(staff.errors,[]);await staff.context.close();
 }finally{await browser.close();}
});
test('narrow and safe-area inset retain reachable controls and bottom content',async()=>{
 const browser=await chromium.launch({headless:true});try{const f=await fixture(browser);const p=f.page;const cdp=await f.context.newCDPSession(p);
  await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:34}});
  for(const width of [320,360,390]){await p.setViewportSize({width,height:700});const nav=p.locator('.mobile-tabbar'),fab=p.locator('.mobile-add-button');const b=await nav.boundingBox(),a=await fab.boundingBox();assert.ok(a.x>=0&&a.x+a.width<=width);assert.ok(a.y<b.y&&a.y+a.height>b.y);for(const button of await nav.locator('button').all()){const r=await button.boundingBox();assert.ok(r.x+r.width<=a.x||r.x>=a.x+a.width,'FAB must not overlap tab hit target');}
   const layout=await p.evaluate(()=>({width:document.documentElement.scrollWidth,viewport:innerWidth,padding:parseFloat(getComputedStyle(document.querySelector('.main-content')).paddingBottom),safe:parseFloat(getComputedStyle(document.querySelector('.mobile-tabbar')).paddingBottom)}));assert.ok(layout.width<=layout.viewport);assert.ok(layout.padding>=134);assert.ok(layout.safe>=38);
   await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));assert.ok(await p.locator('main').evaluate(e=>e.getBoundingClientRect().bottom-parseFloat(getComputedStyle(e).paddingBottom)<=innerHeight-70));
  }
  await cdp.detach();assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
 }finally{await browser.close();}
});
