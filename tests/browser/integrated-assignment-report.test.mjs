import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright-core';

// A single in-memory fictional provider is shared by three isolated browser sessions.
// This exercises the shipped UI and its wire protocol, not production authorization.
test('manager assigns, worker reports on phone, manager reloads, other worker is denied', {timeout:120000}, async()=>{
  const origin='https://ech-fixture.invalid';
  const manager='10000000-0000-4000-8000-000000000001', worker='10000000-0000-4000-8000-000000000002', other='10000000-0000-4000-8000-000000000003';
  const client='20000000-0000-4000-8000-000000000001', id='30000000-0000-4000-8000-000000000001';
  let visit={id,clientId:client,workerId:null,service:'Home support',start:'2026-01-15T18:00:00.000Z',end:'2026-01-15T19:00:00.000Z',status:'Open',revision:1};
  let report=null; const writes=[], reads=[], rosters=[], unexpected=[], errors=[];
  const assets=new Map(await Promise.all([['/admin/','index.html','text/html'],['/admin/admin.js','admin.js','text/javascript'],['/admin/admin.css','admin.css','text/css']].map(async([path,file,contentType])=>[path,{contentType,body:await readFile(new URL('../../dist/admin/'+file,import.meta.url))}])));
  const browser=await chromium.launch({headless:true});
  async function open(actor,role){
    const context=await browser.newContext({viewport:{width:390,height:660},hasTouch:true,serviceWorkers:'block'});
    await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url()),q=url.searchParams, h=req.headers();
      const json=(value,status=200)=>route.fulfill({status,json:value});
      if(url.origin!==origin){unexpected.push(req.url());return route.abort();}
      if(assets.has(url.pathname)&&req.method()==='GET')return route.fulfill(assets.get(url.pathname));
      if(url.pathname==='/favicon.ico')return route.fulfill({status:204});
      if(url.pathname==='/api/admin/session')return json({authenticated:true,principal:{id:actor,email:'fictional@ech-fixture.invalid',technicalAdmin:false,applicationAdmin:false,operationalRole:role},capabilities:role==='staff'?['leads.read_assigned']:['leads.read_all'],operationsFeatures:{reads:true,scheduleCommands:true,scheduleRecurrence:false,visitActions:true}});
      if(['/api/admin/inquiries','/api/admin/partners'].includes(url.pathname)&&role==='manager')return json({schema:1,mode:'shared',items:[],nextCursor:null});
      if(url.pathname!=='/api/admin/operations'||h['x-ech-schedule-actor']!==actor||h['x-ech-schedule-role']!==role){unexpected.push(req.method()+' '+url.pathname+url.search);return route.abort();}
      reads.push({actor,method:req.method(),query:url.search});
      if(req.method()==='POST'){
        const body=req.postDataJSON(), c=body.command;
        assert.equal(body.visitId,id); assert.equal(body.visitRevision,visit.revision); assert.equal(body.membershipRevision,7);
        if(c.type==='assign'&&actor===manager){assert.equal(c.workerId,worker);visit={...visit,workerId:worker,status:'Assigned',revision:visit.revision+1};writes.push(c.type);return json({visit,receipt:{operationId:body.operationId,expectedRevision:body.visitRevision,revision:visit.revision}});}
        if(c.type==='confirm'&&actor===worker){visit={...visit,status:'Confirmed',revision:visit.revision+1};writes.push(c.type);return json({visit,receipt:{operationId:body.operationId,expectedRevision:body.visitRevision,revision:visit.revision}});}
        if((c.type==='start'||c.type==='submit')&&actor===worker){
          visit={...visit,status:c.type==='start'?'In progress':'Completed',revision:visit.revision+1};writes.push(c.type);
          const receipt={schema:1,operationId:body.operationId,visitId:id,visitRevision:visit.revision,reportRevision:c.type==='start'?null:1,reportVersion:c.type==='start'?null:0,action:c.type,recordedAt:c.type==='start'?null:'2026-01-15T19:01:00.000Z'};
          if(c.type==='submit')report={schema:1,visitId:id,visitRevision:visit.revision,reportRevision:1,reviews:[],versions:[{revision:1,version:0,sourceRevision:null,actorId:worker,actorRole:'staff',recordedAt:receipt.recordedAt,outcome:c.outcome,summary:c.summary,issue:c.issue,observations:c.observations,actualStart:c.actualStart,actualEnd:c.actualEnd,completedTasks:c.completedTasks,reason:null}]};
          return json(receipt);
        }
        return json({error:{code:'forbidden'}},403);
      }
      if(q.has('scheduling')||q.has('commands'))return json({schema:1,enabled:true,membershipRevision:7});
      if(q.has('from')&&q.has('to')){const visible=role==='manager'||visit.workerId===actor;const roster={schema:1,mode:'shared',visits:visible?[{...visit}]:[],clients:visible?[{id:client,name:'Fictional Ada'}]:[],staff:actor===other?[{id:other,name:'Fictional other worker'}]:[{id:worker,name:'Fictional worker'}]};rosters.push({actor,roster});return json(roster);}
      if(q.has('scheduleVisit')||q.has('visit')||q.has('report')){
        if(role==='staff'&&visit.workerId!==actor)return json({error:{code:'forbidden',message:'Fictional fixture denied access'}},403);
        if(q.has('scheduleVisit'))return json({schema:1,visit});
        if(q.has('visit'))return json({visitId:id,revision:visit.revision,fields:{address:'Fictional address'},contactAuthority:'unknown',allergyStatus:'unknown'});
        return json(report||{schema:1,visitId:id,visitRevision:visit.revision,reportRevision:0,versions:[],reviews:[]});
      }
      unexpected.push(req.method()+' '+url.pathname+url.search);return route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-01-15T19:05:00.000Z'));
    await page.goto(origin+'/admin/?view=operations',{waitUntil:'domcontentloaded'});return {page,context};
  }
  try{
    const m=await open(manager,'manager');
    await m.page.getByRole('button',{name:/^View visit details for Fictional Ada,/}).first().tap();
    let panel=m.page.getByRole('region',{name:'Selected visit details',exact:true});
    await panel.getByLabel('Action',{exact:true}).selectOption('assign');
    await panel.getByLabel('Staff member',{exact:true}).selectOption(worker);
    await panel.getByLabel('Operational reason',{exact:true}).fill('Fictional assignment');
    await panel.getByRole('button',{name:'Save schedule change',exact:true}).tap();
    await panel.getByText('Waiting for the assigned worker to confirm this visit. Managers can review or change the assignment; this view does not confirm on the worker’s behalf.',{exact:true}).waitFor();
    assert.equal(visit.workerId,worker);assert.equal(visit.status,'Assigned');
    const w=await open(worker,'staff');
    await w.page.getByRole('region',{name:'My day',exact:true}).getByRole('button',{name:'Open current visit',exact:true}).tap();
    panel=w.page.getByRole('region',{name:'Selected visit details',exact:true});
    await panel.getByRole('button',{name:'Confirm assignment',exact:true}).tap();
    await panel.getByRole('button',{name:'Request visit start',exact:true}).tap();
    await panel.getByLabel('Outcome reported',{exact:true}).selectOption('completed');
    await panel.getByLabel(/^Factual summary/).fill('Fictional meal prepared.');
    await panel.getByLabel('Issue text',{exact:true}).fill('Fictional supply reminder.');
    await panel.getByLabel('Factual observations',{exact:true}).fill('Fictional preferences followed.');
    await panel.getByLabel('Completed tasks · one per line, at most 50',{exact:true}).fill('Fictional meal preparation');
    await panel.getByLabel('Actual start · Vancouver',{exact:true}).fill('2026-01-15T10:10');
    await panel.getByLabel('Actual end · Vancouver',{exact:true}).fill('2026-01-15T11:00');
    await panel.getByRole('button',{name:'Submit report',exact:true}).tap();
    await panel.getByRole('region',{name:'Selected visit assignment',exact:true}).getByText('Completed',{exact:true}).waitFor();
    assert.deepEqual(writes,['assign','confirm','start','submit']);
    const completedRevision=visit.revision, savedReportRevision=report.reportRevision;
    const reloadSession=await w.context.newCDPSession(w.page);
    await Promise.all([w.page.waitForEvent('load'),reloadSession.send('Page.reload',{ignoreCache:true})]);
    await reloadSession.detach();
    const myDay=w.page.getByRole('region',{name:'My day',exact:true});
    await myDay.waitFor({state:'visible'});
    await myDay.getByRole('button',{name:'Open assigned visit for Fictional Ada',exact:true}).tap();
    panel=w.page.getByRole('region',{name:'Selected visit details',exact:true});
    const freshStaffReport=w.page.waitForRequest(request=>{const url=new URL(request.url()),headers=request.headers();return request.method()==='GET'&&url.origin===origin&&url.pathname==='/api/admin/operations'&&headers['x-ech-schedule-actor']===worker&&headers['x-ech-schedule-role']==='staff'&&url.searchParams.get('report')===id&&url.searchParams.get('revision')===String(completedRevision);});
    await panel.getByRole('button',{name:'View report history',exact:true}).tap();
    await freshStaffReport;
    const staffHistory=panel.getByRole('region',{name:'Visit report and review history',exact:true});
    await staffHistory.getByText(`Checked on this load · report revision ${savedReportRevision}.`,{exact:false}).waitFor();
    for(const text of ['Fictional meal prepared.','Fictional supply reminder.','Fictional preferences followed.','Fictional meal preparation'])await staffHistory.getByText(text,{exact:true}).first().waitFor();
    assert.equal(report.visitRevision,completedRevision);assert.equal(report.reportRevision,1);
    assert.equal(writes.filter(type=>type==='submit').length,1);
    for(const name of ['Approve or return report','Approve report','Return report','Go to care report actions','Approve hours'])assert.equal(await panel.getByRole('button',{name,exact:true}).count(),0,`staff cannot see manager control: ${name}`);
    await m.page.reload({waitUntil:'domcontentloaded'});
    await m.page.getByRole('button',{name:/^View visit details for Fictional Ada,/}).first().tap();
    panel=m.page.getByRole('region',{name:'Selected visit details',exact:true});
    await panel.getByRole('button',{name:'View report history',exact:true}).tap();
    const history=panel.getByRole('region',{name:'Visit report and review history',exact:true});
    for(const text of ['Fictional meal prepared.','Fictional supply reminder.','Fictional preferences followed.','Fictional meal preparation'])await history.getByText(text,{exact:true}).first().waitFor();
    const o=await open(other,'staff');
    await o.page.getByText('No assigned visits to work on today.',{exact:true}).waitFor();
    assert.equal(await o.page.getByText('Fictional Ada',{exact:true}).count(),0);
    const denied=await o.page.evaluate(async({id,other,revision})=>{const r=await fetch('/api/admin/operations?report='+id+'&revision='+revision,{headers:{'X-ECH-Schedule-Actor':other,'X-ECH-Schedule-Role':'staff','X-ECH-Report-Features':'2'}});return r.status;},{id,other,revision:visit.revision});
    assert.equal(denied,403,'fictional provider denies the unrelated worker direct report read');
    assert.ok(reads.some(r=>r.actor===manager&&r.query.includes('report=')));
    for(const actor of [manager,worker,other]) assert.ok(rosters.some(r=>r.actor===actor), 'roster requested by '+actor);
    for(const {actor,roster} of rosters){
      assert.deepEqual(roster.staff.map(s=>s.id),[actor===other?other:worker]);
      if(actor===other){assert.deepEqual(roster.visits,[]);assert.deepEqual(roster.clients,[]);}
      else {assert.deepEqual(roster.visits.map(v=>v.id),[id]);assert.deepEqual(roster.clients.map(c=>c.id),[client]);}
    }
    assert.deepEqual(unexpected,[]);assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
