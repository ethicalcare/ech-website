import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=await import(process.argv[2]||require.resolve('@electric-sql/pglite'));
const initial=await readFile(new URL('../migrations/20261020_ech_leads.sql',import.meta.url),'utf8');
const additive=await readFile(new URL('../migrations/20261022_application_admin.sql',import.meta.url),'utf8');
const admin='1fbc76c6-8521-4f9e-b0c9-f174ada676aa',other=randomUUID(),staff=randomUUID();
const sessions=new Map([[admin,randomUUID()],[other,randomUUID()],[staff,randomUUID()]]);
const boards=['1YlzNi4idvoAuErFXcVCYhNqtcvW21S4JN8RRTgAXf60','1K3Tn7UASsvSpPfw_qQh40yYc10z5wBrSkeGXaFRsRI8'];
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
function envelope(rank=1){const row=rank+6;return {schema:1,operationId:randomUUID(),expectedRevision:0,command:{type:'create',id:randomUUID(),fields:{organization:'Example partner',geography:'Vancouver',category:'Community',contactRoute:'Contact',stage:'Not contacted',sprint:'Top 15',openingAsk:'Ask permission',materials:'None',lastTouch:'2026-09-01',nextDate:'2026-10-30',contacted:false}},source:{origin:'executive-handoff',sourceKey:boards[0]+':689102916:'+row,rank,sourceVariants:boards.map(spreadsheetId=>({spreadsheetId,sheetId:689102916,tab:'Prospect Bank',row,url:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=689102916&range=A${row}:N${row}`,values:['FALSE',String(rank),'Top 15','Vancouver','Community','Example partner','Contact','Ask permission','Not contacted','Caller to be confirmed','None','2026-09-01','2026-10-30','Notes']})),brief:{documentId:'abcdefghijklmnopqrstuv',title:String(rank).padStart(2,'0')+' - Example brief',url:'https://docs.google.com/document/d/abcdefghijklmnopqrstuv/edit?usp=drivesdk',modifiedAt:'2026-10-22T00:00:00.000Z',text:'Prospect Bank #'+rank+' | Complete source brief retained.',sources:[{label:'Source',url:'https://example.test/source'}]},reviewFlags:['Review before outreach'],assignment:{status:'caller_tbc',sourceText:'Caller to be confirmed'}}};}
const setup=`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema auth,public to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`;
async function initialize(db){await db.exec(setup);await db.query("insert into auth.users values($1,'erick@bloxlabs.tech'),($2,'other@example.invalid'),($3,'staff@example.invalid')",[admin,other,staff]);await db.exec(initial);await db.exec(additive);}
async function as(db,id){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:sessions.get(id),exp:Math.floor(Date.now()/1000)+3600})]);await db.exec('set role authenticated');}
const denied=(fn,code)=>assert.rejects(fn,error=>error.code===code);
let passed=0;async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
let db=await PGlite.create(),snapshot;
try {
 await initialize(db);
 await db.query("insert into public.ech_memberships(user_id,display_name,operational_role,application_admin) values($1,'Second administrator','owner',true),($2,'Staff','staff',false)",[other,staff]);
 for(const id of [admin,other,staff]){await as(db,id);await db.query('select public.ech_register_session()');}
 const input=envelope();const commit=async value=>(await db.query('select public.ech_import_partner($1::jsonb) result',[JSON.stringify(value)])).rows[0].result;
 await check('anonymous and ordinary staff cannot import',async()=>{await db.exec('reset role;set role anon');await denied(()=>commit(input),'42501');await as(db,staff);await denied(()=>commit(input),'PT403');});
 let saved;
 await check('import preserves exact brief, source, full fingerprint and revision-one audit',async()=>{await as(db,admin);saved=await commit(input);assert.deepEqual(saved.record.source,input.source);assert.equal(saved.receipt.commandFingerprint,hash(input));assert.equal(saved.record.revision,1);assert.equal(saved.record.ownerId,null);await db.exec('reset role');assert.deepEqual((await db.query("select data->'source' source from public.ech_records where id=$1",[input.command.id])).rows[0].source,input.source);const event=(await db.query('select revision,details from public.ech_events where operation_id=$1',[input.operationId])).rows[0];assert.equal(event.revision,1);assert.deepEqual(event.details.source,input.source);assert(event.details.changedFields.includes('source'));await as(db,admin);});
 await check('unequal nonblank date columns map correctly and reversed dates are rejected',async()=>{
  assert.equal(saved.record.lastTouch,'2026-09-01');assert.equal(saved.record.nextDate,'2026-10-30');
  assert.equal(saved.record.source.sourceVariants[0].values[11],saved.record.lastTouch);assert.equal(saved.record.source.sourceVariants[0].values[12],saved.record.nextDate);
  const reversed=envelope(2);[reversed.command.fields.lastTouch,reversed.command.fields.nextDate]=[reversed.command.fields.nextDate,reversed.command.fields.lastTouch];await denied(()=>commit(reversed),'PT400');
 });
 await check('exact replay returns original receipt and changed-source replay conflicts',async()=>{assert.deepEqual(await commit(input),saved);const changed=structuredClone(input);changed.source.brief.text='Prospect Bank #1 | Changed source';await denied(()=>commit(changed),'PT409');});
 await check('standard create endpoint cannot replay an import receipt',async()=>{await denied(()=>db.query('select public.ech_commit($1,$2::jsonb)',['partner',JSON.stringify(Object.fromEntries(Object.entries(input).filter(([key])=>key!=='source')))]),'PT409');});
 await check('same source cannot create a different record for same or another actor',async()=>{const duplicate=structuredClone(input);duplicate.command.id=randomUUID();duplicate.operationId=randomUUID();await denied(()=>commit(duplicate),'PT409');await as(db,other);await denied(()=>commit({...duplicate,operationId:randomUUID()}),'PT409');await as(db,admin);});
 await check('existing record is never overwritten and failed imports leave no partial writes',async()=>{const duplicate=envelope(2);duplicate.command.id=input.command.id;await denied(()=>commit(duplicate),'PT409');await db.exec('reset role');for(const table of ['ech_records','ech_events','ech_command_receipts'])assert.equal(Number((await db.query(`select count(*) n from public.${table}`)).rows[0].n),1);await as(db,admin);});
 await check('SQL source validator independently rejects forged board, brief and envelope fields',async()=>{for(const mutate of [value=>value.source.sourceVariants[0].spreadsheetId='forged',value=>value.source.brief.url='https://example.test/wrong',value=>value.source.extra=true,value=>value.source.sourceVariants[0].values[0]=false,value=>value.source.rank=1.5]){const value=envelope(3);mutate(value);await denied(()=>commit(value),'PT400');}});
 await as(db,admin);
 await db.query('select public.ech_commit($1,$2::jsonb)',['partner',JSON.stringify({schema:1,operationId:randomUUID(),expectedRevision:1,command:{type:'save_person',id:input.command.id,fields:{person:{id:randomUUID(),name:'Example person',role:'Contact',methods:[]}}}})]);
 snapshot=(await db.query('select public.ech_application_backup() snapshot')).rows[0].snapshot;
 await check('revoked session and removed application grant cannot replay import receipt',async()=>{await db.query('select public.ech_logout_session()');await denied(()=>commit(input),'PT403');await as(db,other);await db.exec('reset role');await db.query('update public.ech_memberships set application_admin=false where user_id=$1',[other]);await as(db,other);await denied(()=>commit(input),'PT403');});
} finally {await db.close();}
db=await PGlite.create();
try {
 await initialize(db);
 await check('snapshot data restores in a fresh isolated database with matching canonical hashes and counts',async()=>{
  for(const member of snapshot.memberships)await db.query('insert into public.ech_memberships(user_id,display_name,active) values($1,$2,false) on conflict(user_id) do nothing',[member.userId,member.displayName]);
  const families={records:'ech_records',personKeys:'ech_person_keys',events:'ech_events',commandReceipts:'ech_command_receipts'};
  for(const [key,table] of Object.entries(families)){
   await db.query(`insert into public.${table} select * from jsonb_populate_recordset(null::public.${table},$1::jsonb)`,[JSON.stringify(snapshot[key])]);
   const restored=(await db.query(`select to_jsonb(r) item from public.${table} r`)).rows.map(row=>row.item);
   const sort=items=>items.map(canonical).sort();assert.equal(restored.length,snapshot[key].length);assert.equal(hash(sort(restored)),hash(sort(snapshot[key])));
  }
  await denied(()=>db.query('insert into public.ech_person_keys(id,partner_id) values($1,$2)',[randomUUID(),randomUUID()]),'23503');
  assert.deepEqual((await db.query("select data->'source' source from public.ech_records limit 1")).rows[0].source,snapshot.records[0].data.source);
 });
 await check('restore does not replay membership grants, administrative receipts or sessions',async()=>{
  assert.equal(Number((await db.query('select count(*) n from public.ech_sessions')).rows[0].n),0);
  assert.equal(Number((await db.query('select count(*) n from public.ech_membership_receipts')).rows[0].n),0);
  const member=(await db.query('select application_admin,technical_admin,operational_role,active from public.ech_memberships where user_id=$1',[other])).rows[0];assert.deepEqual(member,{application_admin:false,technical_admin:false,operational_role:null,active:false});
  await as(db,admin);assert.equal((await db.query('select public.ech_session_active() ok')).rows[0].ok,false);await denied(()=>db.query('select public.ech_application_backup()'),'PT403');
 });
 console.log(JSON.stringify({passed,migrationSha256:createHash('sha256').update(additive).digest('hex'),network:false,catalogQueries:0,restore:'fresh isolated synthetic database; data only; no sessions or source grants replayed'}));
} finally {await db.close();}
