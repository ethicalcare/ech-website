import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
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

async function withPhoneFixture({
  signedIn=session,fixtureVisits=visits,now='2026-01-15T20:00:00.000Z',denied=()=>false,existingBrowser,reportFixture,
},run){
    const assets = new Map(await Promise.all([
      ['/admin/','index.html','text/html'],['/admin/admin.js','admin.js','text/javascript'],
      ['/admin/admin.css','admin.css','text/css'],
    ].map(async([url,file,contentType])=>[url,{
      contentType,body:await readFile(new URL('../../dist/admin/'+file,import.meta.url)),
    }])));
    const browser = existingBrowser??await chromium.launch({headless:true,timeout:15_000});
    let context;
    try {
      context = await browser.newContext({viewport:{width:390,height:660},hasTouch:true,serviceWorkers:'block'});
      const unexpected = [];
      const pageErrors = [];
      const detailReads = [];
      await context.route('**/*',async route=>{
        const request = route.request(), url = new URL(request.url());
        const reject = async()=>{
          unexpected.push({origin:url.origin,path:url.pathname,method:request.method()});
          await route.abort('blockedbyclient');
        };
        if(url.origin!==origin)return reject();
        if(url.pathname==='/api/admin/operations'&&reportFixture){
          if(request.headers()['x-ech-schedule-actor']!==signedIn.principal.id||request.headers()['x-ech-schedule-role']!=='staff')return reject();
          const response=reportFixture(request,url);
          if(response)return route.fulfill(response);
        }
        if(request.method()!=='GET')return reject();
        const asset = assets.get(url.pathname);
        if(asset&&(!url.search||url.pathname+url.search===entry))return route.fulfill(asset);
        const json = value=>route.fulfill({json:value});
        if(url.pathname==='/favicon.ico'&&!url.search)return route.fulfill({status:204});
        if(url.pathname==='/api/admin/session'&&!url.search)return json(signedIn);
        if(['/api/admin/inquiries','/api/admin/partners'].includes(url.pathname)&&url.search==='?limit=20')return json(list);
        if(url.pathname!=='/api/admin/operations')return reject();
        if(request.headers()['x-ech-schedule-actor']!==signedIn.principal.id||request.headers()['x-ech-schedule-role']!==signedIn.principal.operationalRole)
          return reject();
        const q=url.searchParams;
        if(q.size===2&&q.has('from')&&q.has('to')){
          const visible = fixtureVisits.filter(v=>v.start<q.get('to')&&v.end>q.get('from'));
          return json({schema:1,mode:'shared',visits:visible,clients:clients.filter(c=>visible.some(v=>v.clientId===c.id)),
            staff:[{id:signedIn.principal.operationalRole==='staff'?signedIn.principal.id:staff,name:'Fictional worker'}]});
        }
        const id=q.get('visit');
        if(q.size===2&&q.get('revision')==='1'&&fixtureVisits.some(v=>v.id===id)){
          detailReads.push(id);
          if(denied())return route.fulfill({status:403,json:{error:{code:'forbidden',message:'Fictional fixture denied the visit'}}});
          return json(detailFor(id));
        }
        return reject();
      });
      const page=await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.clock.setFixedTime(new Date(now));
      await page.goto(origin+entry,{waitUntil:'domcontentloaded'});
      await run({page,detailReads,browser});
      assert.deepEqual(unexpected,[],'only exact fictional fixture routes are used');
      assert.deepEqual(pageErrors,[]);
    } finally {
      if(existingBrowser)await context?.close();
      else await browser.close();
    }
}

test('selected visit details scroll, stay on the selected client and restore focus at phone width',
  {timeout:100_000},async()=>{
    await withPhoneFixture({},async({page,detailReads})=>{
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
    });
  });

test('assigned worker opens approved visit details from My day at phone width',
  {timeout:60_000},async()=>{
    const signedIn={
      ...session,principal:{...session.principal,id:staff,email:'fictional.worker@ech-fixture.invalid',operationalRole:'staff'},
      capabilities:['leads.read_assigned'],
    };
    const assigned=visits[0];
    let denyDetail=false;
    await withPhoneFixture({signedIn,fixtureVisits:[assigned],now:'2026-01-15T18:30:00.000Z',
      denied:()=>denyDetail},async({page,detailReads,browser})=>{
      const schedule=page.getByRole('region',{name:'Shared schedule',exact:true});
      const myDay=schedule.getByRole('region',{name:'My day',exact:true});
      const current=myDay.getByRole('button',{name:'Open current visit',exact:true});
      const calendar=schedule.getByRole('region',{name:'Visit calendar',exact:true});
      const panel=schedule.getByRole('region',{name:'Selected visit details',exact:true});
      const heading=panel.getByRole('heading',{name:'Selected visit details',exact:true});
      const expected=detailFor(assigned.id).fields;

      await myDay.getByText('Fictional Ada',{exact:true}).waitFor();
      assert.equal(await calendar.isVisible(),true);
      assert.equal(await schedule.getByText('Fictional Bee',{exact:true}).count(),0);
      await current.tap();
      await panel.getByText('Fictional Ada',{exact:true}).waitFor();
      assert.equal(await heading.evaluate(e=>e===document.activeElement),true);
      assert.equal(await calendar.isVisible(),false,'current visit hides the calendar');
      for(const value of [expected.address,expected.entry,expected.preferences,expected.contact.name,'Phone not provided'])
        assert.equal(await panel.getByText(value,{exact:true}).count(),1);
      assert.equal(await panel.getByText('Contact authority is unknown. Do not infer consent or decision-making authority.',{exact:true}).count(),1);
      assert.equal(await panel.getByText('Allergy status is unknown. Absence of information does not mean no allergies.',{exact:true}).count(),1);
      assert.equal(await panel.getByText('Fictional Bee',{exact:true}).count(),0);
      await panel.getByRole('button',{name:'Close visit details',exact:true}).press('Enter');
      await panel.waitFor({state:'hidden'});
      assert.equal(await current.evaluate(e=>e===document.activeElement),true,'Close returns focus to My day');
      assert.equal(await calendar.isVisible(),true);
      assert.deepEqual(detailReads,[assigned.id]);

      // This mocks a denial to check client behavior, not backend authorization.
      denyDetail=true;
      await Promise.all([
        page.waitForResponse(response=>response.status()===403&&new URL(response.url()).searchParams.get('visit')===assigned.id),
        current.tap(),
      ]);
      const denied=panel.getByRole('alert');
      await denied.waitFor();
      assert.equal(await denied.textContent(),'Visit details could not be verified. Reload the schedule if this visit has changed.');
      assert.equal(await panel.getByRole('region',{name:'Selected visit assignment',exact:true}).count(),0);
      for(const value of ['Fictional Ada',expected.address,expected.entry,expected.preferences,expected.contact.name])
        assert.equal(await panel.getByText(value,{exact:true}).count(),0);
      assert.deepEqual(detailReads,[assigned.id,assigned.id]);
      await panel.getByRole('button',{name:'Close visit details',exact:true}).press('Enter');
      await panel.waitFor({state:'hidden'});
      assert.equal(await current.evaluate(e=>e===document.activeElement),true);

      const other={
        ...signedIn,principal:{...signedIn.principal,id:'10000000-0000-4000-8000-000000000003',
          email:'fictional.other@ech-fixture.invalid'},
      };
      await withPhoneFixture({signedIn:other,fixtureVisits:[],now:'2026-01-15T18:30:00.000Z',
        existingBrowser:browser},async({page:otherPage,detailReads:otherReads})=>{
        const otherSchedule=otherPage.getByRole('region',{name:'Shared schedule',exact:true});
        const otherDay=otherSchedule.getByRole('region',{name:'My day',exact:true});
        await otherDay.getByText('No assigned visits to work on today.',{exact:true}).waitFor();
        assert.equal(await otherDay.getByRole('button',{name:'Open current visit',exact:true}).count(),0);
        assert.equal(await otherSchedule.getByText('Fictional Ada',{exact:true}).count(),0);
        assert.equal(await otherSchedule.getByRole('region',{name:'Selected visit details',exact:true}).count(),0);
        assert.deepEqual(otherReads,[]);
      });
    });
  });

test('active shift shortcuts focus the report fields and an exact fictional report is read back at phone width',
  {timeout:45_000},async()=>{
    const signedIn={
      ...session,principal:{...session.principal,id:staff,email:'fictional.worker@ech-fixture.invalid',operationalRole:'staff'},
      capabilities:['leads.read_assigned'],operationsFeatures:{...session.operationsFeatures,visitActions:true},
    };
    const activeVisit={...visits[0],status:'In progress'};
    const command={
      type:'submit',outcome:'completed',summary:'Completed fictional meal preparation.',
      issue:'Fictional supply reminder.',observations:'Fictional preferences were followed.',
      actualStart:'2026-01-15T18:10:00.000Z',actualEnd:'2026-01-15T19:00:00.000Z',
      completedTasks:['Fictional meal preparation'],
    };
    const recordedAt='2026-01-15T19:01:00.000Z';
    let submissions=0,receiptReadbacks=0,savedReport=null;
    function reportFixture(request,url){
      const headers=request.headers();
      if(request.method()==='POST'&&url.search===''&&submissions===0&&
        headers['content-type']==='application/json'&&headers['x-ech-visit-features']==='1'){
        let body;
        try{body=request.postDataJSON();}catch{return;}
        const operationId=body?.operationId;
        if(typeof operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)
          ||!isDeepStrictEqual(body,{schema:1,operationId,visitId:activeVisit.id,visitRevision:1,
            reportRevision:0,membershipRevision:7,command}))return;
        submissions++;
        const {type,outcome,summary,issue,observations,actualStart,actualEnd,completedTasks}=body.command;
        savedReport={schema:1,visitId:activeVisit.id,visitRevision:2,reportRevision:1,reviews:[],versions:[{
          revision:1,version:0,sourceRevision:null,actorId:staff,actorRole:'staff',recordedAt,
          outcome,summary,issue,observations,actualStart,actualEnd,completedTasks,reason:null,
        }]};
        return {json:{schema:1,operationId,visitId:activeVisit.id,visitRevision:2,
          reportRevision:1,reportVersion:0,action:type,recordedAt}};
      }
      if(request.method()!=='GET')return;
      const q=url.searchParams;
      if(url.search==='?commands=1'&&headers['x-ech-visit-features']==='1')
        return {json:{schema:1,enabled:true,membershipRevision:7}};
      if(q.size===2&&q.get('visit')===activeVisit.id&&q.get('revision')==='2'&&savedReport)
        return {json:{...detailFor(activeVisit.id),revision:2}};
      if(q.get('report')!==activeVisit.id||headers['x-ech-report-features']!=='2')return;
      if(q.size===2&&q.get('revision')==='1'&&!savedReport)
        return {json:{schema:1,visitId:activeVisit.id,visitRevision:1,reportRevision:0,versions:[],reviews:[]}};
      if(savedReport&&q.get('revision')==='2'){
        if(q.size===3&&q.get('reportRevision')==='1'){
          receiptReadbacks++;return {json:savedReport};
        }
        if(q.size===2)return {json:savedReport};
      }
    }

    await withPhoneFixture({signedIn,fixtureVisits:[activeVisit],now:'2026-01-15T19:05:00.000Z',
      reportFixture},async({page})=>{
      const myDay=page.getByRole('region',{name:'My day',exact:true});
      await myDay.getByRole('button',{name:'Open current visit',exact:true}).tap();
      const panel=page.getByRole('region',{name:'Selected visit details',exact:true});
      const observations=panel.getByLabel('Factual observations',{exact:true});
      const issue=panel.getByLabel('Issue text',{exact:true});
      await panel.getByRole('button',{name:'Jump to visit notes',exact:true}).tap();
      assert.equal(await observations.evaluate(e=>e===document.activeElement),true);
      await observations.fill(command.observations);
      await panel.getByRole('button',{name:'Jump to visit issue',exact:true}).tap();
      assert.equal(await issue.evaluate(e=>e===document.activeElement),true);
      await issue.fill(command.issue);
      assert.equal(submissions,0,'shortcuts only focus the report fields');
      await panel.getByLabel('Outcome reported',{exact:true}).selectOption(command.outcome);
      await panel.getByLabel(/^Factual summary/).fill(command.summary);
      await panel.getByLabel('Completed tasks · one per line, at most 50',{exact:true}).fill(command.completedTasks[0]);
      await panel.getByLabel('Actual start · Vancouver',{exact:true}).fill('2026-01-15T10:10');
      await panel.getByLabel('Actual end · Vancouver',{exact:true}).fill('2026-01-15T11:00');
      await panel.getByRole('button',{name:'Submit report',exact:true}).tap();
      await panel.getByRole('region',{name:'Selected visit assignment',exact:true})
        .getByText('Completed',{exact:true}).waitFor();
      assert.equal(submissions,1);
      assert.equal(receiptReadbacks,1);
      await panel.getByRole('button',{name:'View report history',exact:true}).tap();
      const history=panel.getByRole('region',{name:'Visit report and review history',exact:true});
      await history.getByText(command.summary,{exact:true}).first().waitFor();
      for(const written of [command.issue,command.observations,command.completedTasks[0]])
        assert.ok(await history.getByText(written,{exact:true}).count()>0);
    });
  });
