import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
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
  signedIn=session,fixtureVisits=visits,now='2026-01-15T20:00:00.000Z',denied=()=>false,existingBrowser,reportFixture,staffProfileFixture,partnerFixture,entryPath=entry,
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
        const partnerResponse=partnerFixture?.(request,url);
        if(partnerResponse)return route.fulfill(partnerResponse);
        if(url.pathname==='/api/admin/operations'&&reportFixture){
          if(request.headers()['x-ech-schedule-actor']!==signedIn.principal.id||request.headers()['x-ech-schedule-role']!==signedIn.principal.operationalRole)return reject();
          const response=reportFixture(request,url);
          if(response)return route.fulfill(response);
        }
        if(request.method()!=='GET')return reject();
        const asset = assets.get(url.pathname);
        if(asset&&(!url.search||url.pathname+url.search===entryPath))return route.fulfill(asset);
        const json = value=>route.fulfill({json:value});
        if(url.pathname==='/favicon.ico'&&!url.search)return route.fulfill({status:204});
        if(url.pathname==='/api/admin/session'&&!url.search)return json(signedIn);
        if(staffProfileFixture){
          const result=staffProfileFixture(url);
          if(result!==undefined)return json(result);
        }
        const staffSession=signedIn.principal.operationalRole==='staff'&&!signedIn.principal.applicationAdmin&&!signedIn.principal.technicalAdmin;
        if(staffSession&&['/api/admin/inquiries','/api/admin/partners','/api/admin/assignees','/api/admin/access-requests','/api/admin/memberships'].includes(url.pathname))return reject();
        if(['/api/admin/inquiries','/api/admin/partners'].includes(url.pathname)&&url.search==='?limit=20')return json(list);
        if(url.pathname!=='/api/admin/operations'||(staffSession&&!signedIn.operationsFeatures?.reads))return reject();
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
      await page.goto(origin+entryPath,{waitUntil:'domcontentloaded'});
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
      denied:()=>denyDetail,staffProfileFixture:url=>{
        if(url.pathname==='/api/admin/staff-profile'&&url.search==='?id='+staff)
          return {schema:1,profile:{id:staff,name:'Fictional worker',revision:1,workerType:'care_aide',credentials:[]},pending:null};
      }},async({page,detailReads,browser})=>{
      const schedule=page.getByRole('region',{name:'Shared schedule',exact:true});
      const myDay=schedule.getByRole('region',{name:'My day',exact:true});
      const current=myDay.getByRole('button',{name:'Open current visit',exact:true});
      const calendar=schedule.getByRole('region',{name:'Visit calendar',exact:true});
      const panel=schedule.getByRole('region',{name:'Selected visit details',exact:true});
      const heading=panel.getByRole('heading',{name:'Selected visit details',exact:true});
      const expected=detailFor(assigned.id).fields;

      await myDay.getByText('Fictional Ada',{exact:true}).waitFor();
      await page.getByRole('heading',{name:'Your day in focus.',exact:true}).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'),'daily');
      assert.equal(await calendar.count(),0);
      assert.equal(await page.getByRole('button',{name:'Record new inquiry',exact:true}).count(),0);
      assert.equal(await schedule.getByText('Fictional Bee',{exact:true}).count(),0);
      await current.tap();
      await panel.getByText('Fictional Ada',{exact:true}).waitFor();
      assert.equal(await heading.evaluate(e=>e===document.activeElement),true);
      assert.equal(await myDay.isVisible(),false,'current visit hides the roster until close');
      for(const value of [expected.address,expected.entry,expected.preferences,expected.contact.name,'Phone not provided'])
        assert.equal(await panel.getByText(value,{exact:true}).count(),1);
      assert.equal(await panel.getByText('Contact authority is unknown. Do not infer consent or decision-making authority.',{exact:true}).count(),1);
      assert.equal(await panel.getByText('Allergy status is unknown. Absence of information does not mean no allergies.',{exact:true}).count(),1);
      assert.equal(await panel.getByText('Fictional Bee',{exact:true}).count(),0);
      await panel.getByRole('button',{name:'Close visit details',exact:true}).press('Enter');
      await panel.waitFor({state:'hidden'});
      assert.equal(await current.evaluate(e=>e===document.activeElement),true,'Close returns focus to My day');
      assert.equal(await myDay.isVisible(),true);
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

      const header=page.locator('.topbar');
      await header.locator('summary[aria-label="My account"]').tap();
      await header.getByRole('button',{name:'Sign out',exact:true}).waitFor();
      await header.getByRole('button',{name:'My Staff Profile',exact:true}).tap();
      const profile=page.getByRole('region',{name:'My Staff Profile',exact:true});
      await profile.getByText('Fictional worker',{exact:true}).waitFor();
      assert.equal(await myDay.isVisible(),false);
      await profile.getByRole('button',{name:'Back to Today',exact:true}).tap();
      await current.waitFor();
      assert.equal(new URL(page.url()).searchParams.get('view'),'daily');

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
      await withPhoneFixture({signedIn:{...signedIn,operationsFeatures:{...signedIn.operationsFeatures,reads:false}},fixtureVisits:[],
        entryPath:'/admin/?view=partners&contact=fictional-excluded',existingBrowser:browser},async({page:unavailablePage})=>{
        await unavailablePage.getByText('Your assigned care visits aren’t available in this workspace yet.',{exact:true}).waitFor();
        const location=new URL(unavailablePage.url());
        assert.equal(location.searchParams.get('view'),'daily');
        assert.equal(location.searchParams.has('contact'),false);
        assert.equal(await unavailablePage.getByRole('region',{name:'My day',exact:true}).count(),0);
        assert.equal(await unavailablePage.getByText('No assigned visits to work on today.',{exact:true}).count(),0);
        await unavailablePage.getByRole('button',{name:/^Menu/}).tap();
        const menu=unavailablePage.getByRole('dialog');
        await menu.getByRole('button',{name:'My Staff Profile',exact:true}).waitFor();
        assert.equal(await menu.getByRole('button',{name:/^Care Inquiries$|^Referral Partners$|^Follow-ups$|^Overview$|^Accounts$/}).count(),0);
      });
    });
  });

test('staff submit an exact report and the manager opens its dashboard review actions at phone width',
  {timeout:70_000},async()=>{
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
      reportFixture},async({page,browser})=>{
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
      const reviewShortcut={name:'Go to care report actions',exact:true};
      const reviewChoice={name:'Approve or return report',exact:true};
      assert.equal(await history.getByRole('button',reviewShortcut).count(),0);
      assert.equal(await panel.getByRole('button',reviewChoice).count(),0);

      const managerSession={...session,operationsFeatures:{...session.operationsFeatures,visitActions:true}};
      await withPhoneFixture({signedIn:managerSession,
        fixtureVisits:[{...activeVisit,status:'Completed',revision:savedReport.visitRevision}],
        now:'2026-01-15T19:05:00.000Z', existingBrowser:browser,
        reportFixture:(request,url)=>request.method()==='GET'?reportFixture(request,url):undefined,
      },async({page:managerPage})=>{
        const schedule=managerPage.getByRole('region',{name:'Shared schedule',exact:true});
        await schedule.getByRole('button',{name:/^View visit details for Fictional Ada,/u}).first().tap();
        const managerPanel=managerPage.getByRole('region',{name:'Selected visit details',exact:true});
        await managerPanel.getByRole('button',{name:'View report history',exact:true}).tap();
        const managerHistory=managerPanel.getByRole('region',{name:'Visit report and review history',exact:true});
        await managerHistory.getByText(command.summary,{exact:true}).first().waitFor();
        const currentUrl=managerPage.url();
        assert.equal(new URL(currentUrl).searchParams.get('view'),'operations');
        await managerHistory.getByRole('button',reviewShortcut).tap();
        const actions=managerPanel.getByRole('region',{name:'Care report actions',exact:true});
        const actionHeading=actions.getByRole('heading',{name:'Care report actions',exact:true});
        assert.equal(await actionHeading.evaluate(node=>node===document.activeElement),true);
        assert.equal(managerPage.url(),currentUrl,'the shortcut does not leave the dashboard');
        assert.ok(await managerHistory.getByText(command.summary,{exact:true}).first().isVisible());
        await actions.getByRole('button',{name:'Edit latest report',exact:true}).waitFor();
        await actions.getByRole('button',reviewChoice).tap();
        await actions.getByLabel('Review note',{exact:true}).waitFor();
        await actions.getByRole('button',{name:'Approve report',exact:true}).waitFor();
        await actions.getByRole('button',{name:'Return report',exact:true}).waitFor();
        assert.ok(await actions.getByText(command.summary,{exact:true}).first().isVisible());
      });
      assert.equal(submissions,1,'opening manager controls sends no additional write');
    });
  });

test('Staff Profiles opens from Teams & Settings and pairs vacation dates only at wide widths',
  {timeout:65_000},async()=>{
    const signedIn={...session,principal:{...session.principal,applicationAdmin:true},
      capabilities:[...session.capabilities,'users.manage','backup.export']};
    const staffProfileFixture=url=>{
      if(url.pathname==='/api/admin/memberships'&&!url.search)
        return {schema:1,items:[{userId:staff,displayName:'Fictional worker',active:true,
          operationalRole:'staff',technicalAdmin:false,applicationAdmin:false}]};
      if(url.pathname!=='/api/admin/staff-profile'||url.searchParams.get('id')!==staff)return;
      if(url.searchParams.size===2&&url.searchParams.get('view')==='pending')return {schema:1,pending:false};
      if(url.searchParams.size===1)return {schema:1,profile:{
        id:staff,revision:1,name:'Fictional worker',workerType:'care_aide',availability:'Weekdays',
        vacationStart:'2026-02-03',vacationEnd:'2026-02-05',credentials:[],
        management:{payGrade:'',hourlyRate:'',performance:''},
      },pending:null};
    };
    await withPhoneFixture({signedIn,fixtureVisits:[],staffProfileFixture},async({page})=>{
      await page.setViewportSize({width:1440,height:900});
      await page.getByRole('button',{name:'Staff Profiles',exact:true}).click();
      await page.getByRole('region',{name:'Staff profile list'})
        .getByRole('button',{name:'Fictional worker',exact:true}).click();
      const form=page.getByRole('form',{name:'Staff profile form'});
      await form.getByLabel('Availability',{exact:true}).waitFor();
      const bounds=async()=>form.evaluate(el=>{
        const rect=label=>el.querySelector(`[aria-label="${label}"]`).getBoundingClientRect().toJSON();
        return {first:rect('Vacation start'),last:rect('Vacation end'),availability:rect('Availability'),
          panel:el.getBoundingClientRect().toJSON(),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
          documentWidth:document.documentElement.scrollWidth,viewportWidth:document.documentElement.clientWidth};
      });
      const desktop=await bounds();
      assert.ok(Math.abs(desktop.first.top-desktop.last.top)<2,'desktop dates align on the same row');
      assert.ok(desktop.last.left>=desktop.first.right+8,'desktop dates have separate columns');
      assert.ok(desktop.availability.width>desktop.first.width*1.5,'availability remains a full-width field');
      assert.ok(desktop.panel.width<=930,'desktop editor avoids the former full-screen width');
      await page.setViewportSize({width:390,height:660});
      // Wait for the same labeled controls to reflow after the viewport change.
      await page.waitForFunction(()=>{
        const first=document.querySelector('[aria-label="Vacation start"]')?.getBoundingClientRect();
        const last=document.querySelector('[aria-label="Vacation end"]')?.getBoundingClientRect();
        return first&&last&&last.top>first.bottom;
      });
      const phone=await bounds();
      assert.ok(Math.abs(phone.first.left-phone.last.left)<2,'phone dates stack in the same column');
      assert.ok(phone.scrollWidth<=phone.clientWidth+1,'the editor does not scroll horizontally');
      assert.ok(phone.documentWidth<=phone.viewportWidth+1,'the page does not scroll horizontally');
    });
  });

test('staff meetings are locally checked drafts and never become care visits on the shared calendar',
  {timeout:60_000},async()=>{
    const signedIn={...session,operationsFeatures:{...session.operationsFeatures,scheduleCommands:true}};
    await withPhoneFixture({signedIn},async({page,detailReads})=>{
      const schedule=page.getByRole('region',{name:'Shared schedule',exact:true});
      const calendar=schedule.getByRole('region',{name:'Visit calendar',exact:true});
      const care=calendar.getByRole('button',{name:/^View visit details for Fictional Ada,/u});
      const meeting=schedule.getByRole('button',{name:'New staff meeting draft',exact:true});
      await care.first().waitFor();
      await schedule.getByRole('button',{name:'New shared visit',exact:true}).waitFor();
      await schedule.getByRole('group',{name:'Calendar appointment types',exact:true})
        .getByText('Care visit',{exact:true}).waitFor();
      const before=await calendar.getByRole('button',{name:/^View visit details for /u}).count();

      await meeting.tap();
      const draft=schedule.getByRole('region',{name:'Staff meeting draft',exact:true});
      await draft.getByRole('heading',{name:'Staff meeting draft',exact:true}).waitFor();
      assert.equal(await draft.getByLabel('Reviewed client and service',{exact:true}).count(),0);
      assert.equal(await draft.getByRole('button',{name:/^Create shared visit$/u}).count(),0);
      await draft.getByLabel('Meeting title',{exact:true}).fill('Fictional team meeting');
      await draft.getByLabel('Meeting location',{exact:true}).fill('Fictional office');
      await draft.getByLabel('Meeting start · Vancouver',{exact:true}).fill('2026-01-15T09:00');
      await draft.getByLabel('Meeting end · Vancouver',{exact:true}).fill('2026-01-15T08:59');
      const check=draft.getByRole('button',{name:'Check meeting draft',exact:true});
      await check.tap();
      await draft.getByText('The meeting end must be after its start.',{exact:true}).waitFor();
      await draft.getByLabel('Meeting end · Vancouver',{exact:true}).fill('2026-01-15T09:30');
      await check.tap();
      await draft.getByText('Meeting draft checked. Nothing was saved.',{exact:true}).waitFor();
      assert.deepEqual(detailReads,[],'meeting draft does not read any client visit');
      page.once('dialog',dialog=>dialog.accept());
      await schedule.getByRole('button',{name:'Close meeting draft',exact:true}).tap();
      await schedule.getByRole('button',{name:'New shared visit',exact:true}).waitFor();
      await care.first().waitFor();
      assert.equal(await calendar.getByRole('button',{name:/^View visit details for /u}).count(),before);
      assert.equal(await calendar.getByText('Fictional team meeting',{exact:true}).count(),0);
    });
  });

test('saving working partner notes does not log contact or alter follow-up and originals', {timeout:45_000}, async()=>{
  const partnerId='40000000-0000-4000-8000-000000000001';
  const at='2026-01-15T20:00:00.000Z';
  const original='Fictional board research stays as imported.';
  const brief='Fictional imported outreach brief stays unchanged.';
  const notes='Description\nFictional support organization\n\nInternal notes\nAsk about the service area.';
  const entryPath='/admin/?view=partners';
  const signedIn={...session,capabilities:[...session.capabilities,'leads.update_all']};
  const initial={
    id:partnerId,revision:2,organization:'Fictional Partner Organization',category:'Community support',geography:'Fictional service area',
    contactRoute:'fictional.partner@ech-fixture.invalid',stage:'Conversation underway',ownerId:null,
    nextAction:'Confirm fictional service area',nextDate:'2026-01-19',notes:'Fictional initial working notes.',
    openingAsk:'Ask about options',materials:'None',lastTouch:'2026-01-12',callScript:'Fictional original script',contacted:true,
    sprint:'Top 15',people:[],createdAt:at,updatedAt:at,
    source:{sourceVariants:[{values:[...Array(13).fill(''),original]}],brief:{title:'Fictional original brief',text:brief}},
  };
  let current=initial, event, detailReads=0, updates=0;
  const collection=()=>({schema:1,mode:'shared',items:[current],nextCursor:null});
  function partnerFixture(request,url){
    if(url.pathname==='/api/admin/history'&&request.method()==='GET'
      &&url.search==='?recordType=partner&id='+partnerId+'&cursor=0&limit=20'){
      return {json:{items:event?[event]:[],nextCursor:null}};
    }
    if(url.pathname!=='/api/admin/partners')return;
    if(request.method()==='GET'&&url.search==='?limit=20')return {json:collection()};
    if(request.method()==='GET'&&url.search==='?id='+partnerId){detailReads++;return {json:collection()};}
    if(request.method()!=='POST'||url.search||updates!==0||request.headers()['content-type']!=='application/json')return;
    let payload;
    try{payload=request.postDataJSON();}catch{return;}
    const operationId=payload?.operationId;
    if(typeof operationId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operationId)
      ||!isDeepStrictEqual(payload,{schema:1,operationId,expectedRevision:2,command:{type:'update',id:partnerId,fields:{notes}}}))return;
    updates++;
    current={...current,notes,revision:3};
    event={id:'50000000-0000-4000-8000-000000000001',operationId,recordType:'partner',recordId:partnerId,
      actorId:manager,actorLabel:'Fictional manager',at,action:'update',revision:3,details:{changedFields:['notes']}};
    return {json:{schema:1,mode:'shared',record:current,
      receipt:{operationId,expectedRevision:2,revision:3,commandFingerprint:createHash('sha256').update(request.postData()).digest('hex')}}};
  }
  await withPhoneFixture({signedIn,entryPath,partnerFixture},async({page})=>{
    const open=async()=>{
      await page.getByRole('button',{name:/Fictional Partner Organization/u}).tap();
      await page.getByRole('heading',{name:'Fictional Partner Organization',exact:true}).waitFor();
    };
    await open();
    const working=page.getByLabel('Working description and internal notes',{exact:true});
    assert.equal(await working.inputValue(),initial.notes);
    await working.fill(notes);
    await page.getByRole('button',{name:'Save description and notes',exact:true}).tap();
    await page.getByText('Saved and confirmed by the server.',{exact:true}).waitFor();
    assert.equal(updates,1);

    // A fresh dashboard navigation must load the value from the fictional server,
    // not from RecordEditor's preserved in-memory draft.
    await page.goto(origin+entryPath,{waitUntil:'domcontentloaded'});
    await open();
    assert.equal(await working.inputValue(),notes);
    assert.ok(detailReads>=2,'the partner was read again after reopening');
    assert.equal(await page.getByLabel('Contact has been made',{exact:true}).isChecked(),initial.contacted);
    assert.equal(await page.getByLabel('Relationship stage',{exact:true}).inputValue(),initial.stage);
    assert.equal(await page.getByLabel('Next action',{exact:true}).inputValue(),initial.nextAction);
    assert.equal(await page.getByLabel('Follow-up / next meeting date',{exact:true}).inputValue(),initial.nextDate);
    assert.equal(await page.getByLabel('Last logged touch date',{exact:true}).inputValue(),initial.lastTouch);
    await page.getByText('Partner updated',{exact:true}).waitFor();
    assert.equal(await page.getByText('Activity recorded',{exact:true}).count(),0);
    const source=page.getByRole('region',{name:'Research and source information',exact:true});
    await source.getByText('Read notes from the original lists',{exact:true}).tap();
    await source.getByText(original,{exact:true}).waitFor();
    await source.getByText('Research and outreach draft',{exact:true}).tap();
    await source.getByText(brief,{exact:true}).waitFor();
    assert.equal(updates,1);
  });
});
