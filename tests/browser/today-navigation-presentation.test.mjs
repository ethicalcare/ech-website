import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

const origin='https://ech-fixture.invalid';
const actor='10000000-0000-4000-8000-000000000001';
const draftId='70000000-0000-4000-8000-000000000001';
const assets=new Map(await Promise.all([['/admin/','index.html','text/html'],['/admin/admin.js','admin.js','text/javascript'],['/admin/admin.css','admin.css','text/css']].map(async([url,file,contentType])=>[url,{contentType,body:await readFile(new URL('../../dist/admin/'+file,import.meta.url))}])));
async function fixture(browser,{role='manager',create=true,entry='daily',applicationAdmin=false,technicalAdmin=false,scheduleCommands=false,profile=false}={}) {
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,serviceWorkers:'block'});
 let authorized=true;const requests=[],unexpected=[],errors=[];let releaseSave;const saveGate=new Promise(resolve=>{releaseSave=resolve;});
 await context.addInitScript(id=>{Object.defineProperty(crypto,'randomUUID',{value:()=>id});},draftId);
 await context.route('**/*',async route=>{const r=route.request(),u=new URL(r.url());requests.push({method:r.method(),path:u.pathname,body:r.postData()});
  if(u.origin!==origin){unexpected.push(r.url());return route.abort();}
  if(assets.has(u.pathname)&&r.method()==='GET')return route.fulfill(assets.get(u.pathname));
  if(u.pathname==='/favicon.ico')return route.fulfill({status:204});
  if(u.pathname==='/api/admin/session'&&r.method()==='GET')return authorized?route.fulfill({json:{authenticated:true,principal:{id:actor,email:'fictional@ech-fixture.invalid',technicalAdmin,applicationAdmin,operationalRole:role},capabilities:[role==='staff'?'leads.read_assigned':'leads.read_all',...(create?['leads.create']:[]),...(applicationAdmin?['users.manage','backup.export']:[]),...(technicalAdmin?['admin.status']:[])],operationsFeatures:{reads:true,scheduleCommands,scheduleRecurrence:false,visitActions:false}}}):route.fulfill({status:403,json:{error:'fixture denied'}});
  if(['/api/admin/memberships','/api/admin/access-requests'].includes(u.pathname)&&r.method()==='GET')return route.fulfill({status:503,json:{error:{code:'unavailable',message:'Fictional unavailable'}}});
  if(profile&&u.pathname==='/api/admin/staff-profile'&&r.method()==='GET')return route.fulfill({json:{schema:1,profile:{id:actor,revision:1,name:'Fictional worker',workerType:'care_aide',availability:'Fictional original',vacationStart:'',vacationEnd:'',credentials:[]},pending:null}});
  if(profile&&u.pathname==='/api/admin/staff-profile'&&r.method()==='POST'){await saveGate;return route.fulfill({json:{status:'pending_review',submissionId:'80000000-0000-4000-8000-000000000001'}});}
  if(u.pathname==='/api/admin/staff-profile'&&r.method()==='GET')return route.fulfill({status:404,json:{error:{code:'not_found',message:'Fictional profile unavailable'}}});
  if(['/api/admin/inquiries','/api/admin/partners'].includes(u.pathname)&&r.method()==='GET')return route.fulfill({json:{schema:1,mode:'shared',items:[],nextCursor:null}});
  if(u.pathname==='/api/admin/operations'&&r.method()==='GET'&&u.searchParams.has('from'))return route.fulfill({json:{schema:1,mode:'shared',visits:[],clients:[],staff:role==='staff'?[{id:actor,name:'Fictional worker'}]:[]}});
  if(u.pathname==='/api/admin/inquiries'&&r.method()==='POST')return route.fulfill({status:422,json:{error:'fictional no write'}});
  unexpected.push(r.method()+' '+u.pathname+u.search);return route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message)); await page.goto(origin+'/admin/?view='+entry);await page.getByRole('heading',{name:entry==='daily'?'Today':'Operations',exact:true}).waitFor();
 return {context,page,requests,unexpected,errors,releaseSave,deny:()=>{authorized=false;}};
}
const textName='Primary contact name';
test('Today cards show unavailable destinations and preserve desktop',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const spec of [{role:'manager'},{role:'owner',applicationAdmin:true}]){const f=await fixture(browser,spec);const p=f.page;const cards=p.getByRole('region',{name:'Today actions'});
   assert.equal(await cards.isVisible(),true);for(const name of ['Visits Today','Reports to Review','New Care Inquiries','Referral Follow-ups'])assert.equal(await cards.getByRole('button',{name:new RegExp(name)}).isDisabled(),true);
   if(process.env.ECH_PREVIEW_DIR)await p.screenshot({path:process.env.ECH_PREVIEW_DIR+'/ech-cards-isolated-'+spec.role+'.png'});
   await p.setViewportSize({width:1200,height:800});assert.equal(await cards.isVisible(),false);assert.equal(await p.locator('.sidebar').isVisible(),true);if(spec.role==='manager')await p.locator('.desktop-add-button').waitFor({state:'visible'});assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
  const staff=await fixture(browser,{role:'staff',create:false});assert.equal(await staff.page.getByRole('region',{name:'Today actions'}).count(),0);assert.deepEqual(staff.unexpected,[]);await staff.context.close();
 }finally{await browser.close();}
});
test('phone Add opens a menu before inquiry and Escape restores focus',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const spec of [{role:'manager',create:true},{role:'owner',applicationAdmin:true,technicalAdmin:true,create:true}]){const f=await fixture(browser,spec);const p=f.page;const plus=p.locator('.mobile-add-button');const before=p.url();
   await plus.tap();const menu=p.getByRole('dialog',{name:'Add'});await menu.waitFor();assert.equal(p.url(),before);assert.equal(await menu.getByRole('button',{name:'Record New Inquiry'}).count(),1);assert.equal(await p.locator('.shared-record-editor').count(),0);
   await p.keyboard.press('Escape');assert.equal(await menu.isVisible(),false);assert.equal(await plus.evaluate(e=>document.activeElement===e),true);
   await plus.press('Enter');await menu.waitFor();await menu.getByRole('button',{name:'Record New Inquiry'}).tap();await p.locator('.shared-record-editor').waitFor();assert.equal(await p.locator('#workspace-content').evaluate(e=>document.activeElement===e),true);assert.equal(await menu.isVisible(),false);assert.equal(f.requests.filter(r=>r.method==='POST').length,0);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
 }finally{await browser.close();}
});
test('manager shortcut retains intended synthetic draft from Today and Schedule; confirmation and invalidation',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const entry of ['daily','operations']) {const f=await fixture(browser,{entry});const {page}=f;
   await page.locator('.mobile-add-button').click(); await page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Record New Inquiry'}).click(); const editor=page.locator('.shared-record-editor');await editor.waitFor();
   await editor.getByLabel(textName).fill('Fictional draft '+entry); await page.waitForTimeout(150);
   const nav=page.getByRole('navigation',{name:'Primary navigation'});
   await nav.getByRole('button',{name:'Today'}).click();
   assert.equal(await editor.getByLabel(textName).inputValue(),'Fictional draft '+entry);
   await nav.getByRole('button',{name:'Schedule'}).click();
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
  await nav.getByRole('button',{name:'More'}).click();await p.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));assert.equal(await p.locator('.mobile-navigation-drawer').evaluate(e=>e.open),false);assert.equal(await nav.getByRole('button',{name:'More'}).evaluate(e=>document.activeElement===e),true);
  await nav.getByRole('button',{name:'More'}).click();await p.setViewportSize({width:900,height:800});await p.waitForFunction(()=>!document.querySelector('.mobile-navigation-drawer').open);assert.equal(await p.locator('#workspace-content').evaluate(e=>document.activeElement===e),true);
  assert.equal(await p.locator('.desktop-add-button').isVisible(),true);assert.equal(await p.locator('.mobile-tabbar').isVisible(),false);assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  const confirm=await fixture(browser);await confirm.page.locator('.mobile-add-button').click();await confirm.page.getByRole('dialog',{name:'Add'}).getByRole('button',{name:'Record New Inquiry'}).click();await confirm.page.locator('.shared-record-editor').getByLabel(textName).fill('Fictional unsaved value');await confirm.page.getByRole('navigation',{name:'Primary navigation'}).getByRole('button',{name:'Schedule'}).click();assert.equal(await confirm.page.locator('.shared-record-editor').getByLabel(textName).inputValue(),'Fictional unsaved value');assert.deepEqual(confirm.unexpected,[]);assert.deepEqual(confirm.errors,[]);await confirm.context.close();
  const staff=await fixture(browser,{role:'staff',create:false});assert.equal(await staff.page.locator('.mobile-tabbar').isVisible(),true);assert.equal(await staff.page.locator('.mobile-add-button').isDisabled(),true);assert.equal(await staff.page.locator('.mobile-navigation-trigger').isVisible(),false);assert.deepEqual(staff.unexpected,[]);assert.deepEqual(staff.errors,[]);await staff.context.close();
 }finally{await browser.close();}
});
test('phone navigation is restricted to manager and owner application administrator fixtures',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const spec of [
   {role:'manager',create:true,bar:true},
   {role:'owner',applicationAdmin:true,technicalAdmin:true,create:true,bar:true},
   {role:'owner',applicationAdmin:true,technicalAdmin:true,create:false,bar:true},
   {role:'owner',applicationAdmin:false,create:true,bar:true},
   {role:'staff',create:false,bar:true},
   {role:'staff',applicationAdmin:true,create:false,bar:true},
  ]) { const f=await fixture(browser,spec); const p=f.page; assert.equal(await p.evaluate(()=>innerWidth),390);
   assert.equal(await p.locator('.mobile-tabbar').count(),spec.bar?1:0);
   if(spec.bar){const nav=p.locator('.mobile-tabbar');assert.equal(await nav.isVisible(),true);assert.deepEqual((await nav.locator('button').allTextContents()).map(s=>s.trim()),spec.role==='staff'?['Home','Schedule','ReportsUnavailable']:['Today','Schedule','ReportsProposed','More']);assert.equal(await nav.locator('.mobile-tab-reports').isDisabled(),true);assert.equal(await p.locator('.mobile-add-button').isDisabled(),!spec.create);if(spec.role==='staff'&&!spec.applicationAdmin){await nav.getByRole('button',{name:'Schedule'}).click();await p.waitForFunction(()=>document.activeElement?.textContent==='Assigned visits');assert.equal(await nav.getByRole('button',{name:'Schedule'}).getAttribute('aria-current'),'page');assert.equal(await nav.getByRole('button',{name:'Home'}).getAttribute('aria-current'),null);}else if(spec.role==='staff')assert.equal(await nav.getByRole('button',{name:'Schedule'}).isDisabled(),true);}
   else assert.equal(await p.locator('.mobile-navigation-trigger').isVisible(),true);
   if(spec.role==='staff'&&spec.applicationAdmin){await p.locator('summary[aria-label="My account"]').click();const links=p.locator('.admin-staff-mobile-links');assert.equal(await links.isVisible(),true);for(const label of ['Care Inquiries','Referral Partners','Follow-ups','Operations','Overview','Assessments'])assert.equal(await links.getByRole('button',{name:label,exact:true}).isVisible(),true);const operationLink=links.getByRole('button',{name:'Operations',exact:true});await operationLink.focus();await operationLink.press('Enter');await p.getByRole('heading',{name:'Operations',exact:true}).waitFor();assert.equal(await p.locator('summary[aria-label="My account"]').evaluate(e=>document.activeElement===e),true);}
   if(process.env.ECH_PREVIEW_DIR&&(['manager'].includes(spec.role)||(spec.role==='staff'&&!spec.applicationAdmin)||(spec.role==='owner'&&spec.applicationAdmin&&spec.create))){await p.screenshot({path:process.env.ECH_PREVIEW_DIR+'/ech-allroles-'+(spec.role==='owner'?'superadmin':spec.role)+'.png'});}
   if(spec.role==='staff'){await p.setViewportSize({width:320,height:568});const fab=await p.locator('.mobile-add-button').boundingBox();for(const btn of await p.locator('.mobile-tabbar button').all()){const r=await btn.boundingBox();assert.ok(r.x+r.width<=fab.x||r.x>=fab.x+fab.width,'staff FAB does not overlap tab targets');}await p.locator('.mobile-tabbar button').first().focus();assert.equal(await p.locator('.mobile-tabbar button').first().evaluate(e=>document.activeElement===e),true);}
   const cdp=await f.context.newCDPSession(p);await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:34}});
   for(const height of [568,844]){await p.setViewportSize({width:390,height});const bar=p.locator('.mobile-tabbar');const initial=await bar.boundingBox();await p.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await p.waitForTimeout(50);const after=await bar.boundingBox();assert.ok(Math.abs(initial.y-after.y)<1,'bar remains fixed while scrolling');assert.ok(Math.abs(after.y+after.height-height)<1);assert.ok(await p.locator('main').evaluate(e=>e.getBoundingClientRect().bottom-parseFloat(getComputedStyle(e).paddingBottom)<=innerHeight-70));}
   await cdp.detach();
   await p.setViewportSize({width:1200,height:800});assert.equal(await p.locator('.mobile-tabbar').isVisible(),false);assert.equal(await p.locator('.sidebar > nav').isVisible(),true);if(spec.applicationAdmin){await p.locator('.accounts-toggle').click();await p.getByRole('heading',{name:'Accounts',exact:true}).first().waitFor();await p.locator('.accounts-toggle').click();assert.equal(await p.locator('.sidebar > nav').isVisible(),true);}
   assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
 }finally{await browser.close();}
});
test('staff returns from profile to assigned schedule with focus and active tab',async()=>{
 const browser=await chromium.launch({headless:true});try{const f=await fixture(browser,{role:'staff',create:false});const p=f.page;const nav=p.getByRole('navigation',{name:'Primary navigation'});
 await p.locator('summary[aria-label="My account"]').click();await p.locator('.account-actions').getByRole('button',{name:'My Staff Profile'}).click();await p.getByRole('heading',{name:'My Staff Profile',exact:true}).first().waitFor();
 await nav.getByRole('button',{name:'Schedule'}).click();await p.waitForFunction(()=>document.activeElement?.textContent==='Assigned visits');assert.equal(await nav.getByRole('button',{name:'Schedule'}).getAttribute('aria-current'),'page');assert.deepEqual(f.unexpected,[]);await f.context.close();
 }finally{await browser.close();}
});
test('profile draft and pending submission survive phone navigation',async()=>{
 const browser=await chromium.launch({headless:true});try{
  for(const destination of ['Schedule','Home','Back to Today']){const f=await fixture(browser,{role:'staff',create:false,profile:true});const p=f.page;const nav=p.getByRole('navigation',{name:'Primary navigation'});
   const openProfile=async()=>{await p.locator('summary[aria-label="My account"]').click();await p.locator('.account-actions').getByRole('button',{name:'My Staff Profile'}).click();};
   const leave=async()=>{if(destination==='Back to Today'){await p.getByRole('button',{name:'Back to Today',exact:true}).press('Enter');await p.waitForFunction(()=>document.activeElement?.matches('h1')&&document.activeElement.textContent==='Today');}else await nav.getByRole('button',{name:destination}).click();};
   await openProfile();const form=p.getByRole('form',{name:'Staff profile form'});await form.getByLabel('Availability').fill('Fictional unsaved availability');await leave();await openProfile();assert.equal(await form.getByLabel('Availability').inputValue(),'Fictional unsaved availability');
   await form.getByRole('button',{name:'Submit profile for approval'}).click();await form.getByRole('button',{name:'Saving…'}).waitFor();await leave();await openProfile();assert.equal(await form.getByLabel('Availability').inputValue(),'Fictional unsaved availability');assert.equal(await form.getByRole('button',{name:'Saving…'}).isDisabled(),true);
   assert.equal(f.requests.filter(r=>r.path==='/api/admin/staff-profile'&&r.method==='POST').length,1);f.releaseSave();await p.getByText('Submitted for admin approval.',{exact:false}).waitFor();assert.deepEqual(f.unexpected,[]);assert.deepEqual(f.errors,[]);await f.context.close();
  }
 }finally{await browser.close();}
});
test('meeting draft blocks new mobile navigation without data loss',async()=>{
 const browser=await chromium.launch({headless:true});try{const f=await fixture(browser,{entry:'operations',scheduleCommands:true});const p=f.page;
 await p.getByRole('button',{name:'New staff meeting draft'}).click();await p.getByLabel('Meeting title').fill('Fictional pending meeting');
 const nav=p.getByRole('navigation',{name:'Primary navigation'});await nav.getByRole('button',{name:'Today'}).click();assert.equal(await p.getByLabel('Meeting title').inputValue(),'Fictional pending meeting');assert.equal(await p.locator('.mobile-add-button').isDisabled(),true);assert.match(await p.locator('main').innerText(),/Finish or close the current editor or visit/);assert.deepEqual(f.unexpected,[]);await f.context.close();
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
