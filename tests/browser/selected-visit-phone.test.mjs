import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {chromium} from 'playwright-core';

const origin = 'https://ech-fixture.invalid';
const entry = '/admin/?view=operations';
const manager = '10000000-0000-4000-8000-000000000001';
const staff = '10000000-0000-4000-8000-000000000002';
const clients = [
  {id:'20000000-0000-4000-8000-000000000001',name:'Fictional Ada'},
  {id:'20000000-0000-4000-8000-000000000002',name:'Fictional Bee'},
];
const visits = clients.map((client,i)=>({
  id:'30000000-0000-4000-8000-00000000000'+(i+1),clientId:client.id,workerId:staff,
  service:'Home support',start:'2026-01-15T'+(18+i)+':00:00.000Z',
  end:'2026-01-15T'+(19+i)+':00:00.000Z',status:'Assigned',revision:1,
}));
const session = {
  authenticated:true,principal:{id:manager,email:'fictional.manager@ech-fixture.invalid',
    technicalAdmin:false,applicationAdmin:false,operationalRole:'manager'},
  capabilities:['leads.read_all'],
  operationsFeatures:{reads:true,scheduleCommands:false,scheduleRecurrence:false,visitActions:false},
};
const detailFor = id => ({visitId:id,revision:1,fields:{
  address:'Fictional address for browser QA',
  entry:'Fictional entry instructions for layout testing. '.repeat(17).trim(),
  preferences:'Fictional visit preferences for layout testing. '.repeat(17).trim(),
  contact:{name:'Fictional Logistics Contact',phone:null,purpose:'visit_logistics'},
},contactAuthority:'unknown',allergyStatus:'unknown'});
const list = {schema:1,mode:'shared',items:[],nextCursor:null};

test('selected visit details scroll, stay on the selected client and restore focus at phone width',
  {timeout:100_000},async()=>{
    const assets = new Map(await Promise.all([
      ['/admin/','index.html','text/html'],['/admin/admin.js','admin.js','text/javascript'],
      ['/admin/admin.css','admin.css','text/css'],
    ].map(async([url,file,contentType])=>[url,{
      contentType,body:await readFile(new URL('../../dist/admin/'+file,import.meta.url)),
    }])));
    const browser = await chromium.launch({headless:true,timeout:15_000});
    try {
      const context = await browser.newContext({viewport:{width:390,height:660},hasTouch:true,serviceWorkers:'block'});
      const unexpected = [];
      const pageErrors = [];
      const detailReads = [];
      await context.route('**/*',async route=>{
        const request = route.request(), url = new URL(request.url());
        const reject = async()=>{
          unexpected.push({origin:url.origin,path:url.pathname,method:request.method()});
          await route.abort('blockedbyclient');
        };
        if(url.origin!==origin||request.method()!=='GET')return reject();
        const asset = assets.get(url.pathname);
        if(asset&&(!url.search||url.pathname+url.search===entry))return route.fulfill(asset);
        const json = value=>route.fulfill({json:value});
        if(url.pathname==='/favicon.ico'&&!url.search)return route.fulfill({status:204});
        if(url.pathname==='/api/admin/session'&&!url.search)return json(session);
        if(['/api/admin/inquiries','/api/admin/partners'].includes(url.pathname)&&url.search==='?limit=20')return json(list);
        if(url.pathname!=='/api/admin/operations')return reject();
        if(request.headers()['x-ech-schedule-actor']!==manager||request.headers()['x-ech-schedule-role']!=='manager')
          return reject();
        const q=url.searchParams;
        if(q.size===2&&q.has('from')&&q.has('to')){
          const visible = visits.filter(v=>v.start<q.get('to')&&v.end>q.get('from'));
          return json({schema:1,mode:'shared',visits:visible,clients:clients.filter(c=>visible.some(v=>v.clientId===c.id)),
            staff:[{id:staff,name:'Fictional worker'}]});
        }
        const id=q.get('visit');
        if(q.size===2&&q.get('revision')==='1'&&visits.some(v=>v.id===id)){
          detailReads.push(id);return json(detailFor(id));
        }
        return reject();
      });
      const page=await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.clock.setFixedTime(new Date('2026-01-15T20:00:00.000Z'));
      await page.goto(origin+entry,{waitUntil:'domcontentloaded'});
      const schedule=page.getByRole('region',{name:'Shared schedule',exact:true});
      const visit=name=>schedule.getByRole('button',{name:new RegExp('^View visit details for '+name+',')});
      const first=visit('Fictional Ada'),second=visit('Fictional Bee');
      const panel=page.getByRole('region',{name:'Selected visit details',exact:true});
      const heading=panel.getByRole('heading',{name:'Selected visit details',exact:true});
      const close=panel.getByRole('button',{name:'Close visit details',exact:true});
      const lower=panel.getByRole('button',{name:'View report history',exact:true});

      await first.tap();
      await panel.getByText('Fictional Ada',{exact:true}).waitFor();
      assert.equal(await panel.getByText('Fictional Bee',{exact:true}).count(),0);
      assert.equal(await heading.evaluate(e=>e===document.activeElement),true);
      const narrow=await panel.evaluate(e=>({
        viewport:innerWidth,width:e.getBoundingClientRect().width,
        vertical:e.scrollHeight>e.clientHeight,wide:e.scrollWidth>e.clientWidth+1,
        heading:getComputedStyle(e.querySelector('header')).position,
      }));
      assert.equal(narrow.viewport,390);
      assert.ok(narrow.width<=narrow.viewport&&!narrow.wide,'detail panel fits phone width');
      assert.equal(narrow.vertical,true,'long approved instructions create a scrollable panel');
      assert.equal(narrow.heading,'sticky');
      await panel.evaluate(e=>e.scrollIntoView({block:'start'}));
      const before=await panel.evaluate(e=>e.scrollTop);
      // Playwright scrolls this real DOM control into view, including its
      // scrollable ancestors; then verify the control is inside the panel.
      await lower.scrollIntoViewIfNeeded();
      assert.ok(await panel.evaluate(e=>e.scrollTop)>before,'lower control scrolls within the panel');
      const lowerRect=await lower.boundingBox(),panelRect=await panel.boundingBox(),closeRect=await close.boundingBox();
      assert.ok(lowerRect&&panelRect&&closeRect);
      assert.ok(lowerRect.y>=Math.max(0,panelRect.y)-1&&lowerRect.y+lowerRect.height<=Math.min(660,panelRect.y+panelRect.height)+1);
      assert.ok(closeRect.y>=Math.max(0,panelRect.y)-1&&closeRect.y+closeRect.height<=Math.min(660,panelRect.y+panelRect.height)+1,
        'sticky Close remains in the panel after scrolling');
      await close.press('Enter');
      await panel.waitFor({state:'hidden'});
      assert.equal(await first.evaluate(e=>e===document.activeElement),true,'focus returns to the opened visit');

      await first.press('Enter');
      await panel.getByText('Fictional Ada',{exact:true}).waitFor();
      await second.tap();
      await panel.getByText('Fictional Bee',{exact:true}).waitFor();
      assert.equal(await panel.getByText('Fictional Ada',{exact:true}).count(),0);
      assert.equal(await heading.evaluate(e=>e===document.activeElement),true);
      await page.setViewportSize({width:1000,height:800});
      await panel.getByText('Fictional Bee',{exact:true}).waitFor();
      assert.equal(await panel.evaluate(e=>getComputedStyle(e.querySelector('header')).position),'static');
      await page.setViewportSize({width:390,height:660});
      assert.equal(await panel.evaluate(e=>getComputedStyle(e.querySelector('header')).position),'sticky');
      await close.press('Enter');
      await panel.waitFor({state:'hidden'});
      assert.equal(await second.evaluate(e=>e===document.activeElement),true);
      assert.deepEqual(detailReads,[visits[0].id,visits[0].id,visits[1].id]);
      assert.deepEqual(unexpected,[],'only exact fictional fixture routes are used');
      assert.deepEqual(pageErrors,[]);
    } finally {
      await browser.close();
    }
  });
