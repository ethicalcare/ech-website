import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {PGlite}=await import(process.argv[2]||require.resolve('@electric-sql/pglite'));
const initial=await readFile(new URL('../migrations/20261020_ech_leads.sql',import.meta.url),'utf8');
const additive=await readFile(new URL('../migrations/20261022_application_admin.sql',import.meta.url),'utf8');
const db=await PGlite.create();
const ids={admin:'1fbc76c6-8521-4f9e-b0c9-f174ada676aa',owner:randomUUID(),staff:randomUUID(),newUser:randomUUID()};
const emails={admin:'erick@bloxlabs.tech',owner:'owner@example.invalid',staff:'staff@example.invalid',newUser:'new@example.invalid'};
const sessions=Object.fromEntries(Object.keys(ids).map(key=>[key,randomUUID()]));
let passed=0;
async function as(key){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[key],session_id:sessions[key],exp:Math.floor(Date.now()/1000)+3600})]);await db.exec('set role authenticated');}
async function denied(fn,code){await assert.rejects(fn,error=>error.code===code);}
async function check(name,fn){await fn();passed++;console.log('PASS '+name);}
const command=(email,revision,fields={},operationId=randomUUID())=>({schema:1,operationId,expectedRevision:revision,command:{type:'upsert',email,fields:{displayName:'Team member',technicalAdmin:false,operationalRole:'staff',applicationAdmin:false,active:true,...fields}}});
const commit=async value=>(await db.query('select public.ech_membership_commit($1::jsonb) result',[JSON.stringify(value)])).rows[0].result;
try {
  await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);grant usage on schema auth,public to anon,authenticated;create function auth.uid() returns uuid language sql stable as $$select (current_setting('request.jwt.claims',true)::jsonb->>'sub')::uuid$$;create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
  for(const key of Object.keys(ids))await db.query('insert into auth.users values($1,$2)',[ids[key],emails[key]]);
  await db.exec(initial);
  await db.query("insert into public.ech_memberships(user_id,display_name,technical_admin,operational_role) values($1,'Existing owner',true,'owner'),($2,'Existing staff',false,'staff')",[ids.owner,ids.staff]);
  await db.exec(additive);
  await check('bootstrap updates exact account and preserves other permissions',async()=>{
    const rows=(await db.query('select user_id,technical_admin,operational_role,application_admin,active,revision from public.ech_memberships order by user_id')).rows;
    const owner=rows.find(row=>row.user_id===ids.owner);assert.deepEqual(owner,{user_id:ids.owner,technical_admin:true,operational_role:'owner',application_admin:false,active:true,revision:1});
    const admin=rows.find(row=>row.user_id===ids.admin);assert.equal(admin.application_admin,true);assert.equal(admin.operational_role,'owner');assert.equal(rows.length,3);
  });
  for(const key of ['admin','owner','staff']){await as(key);assert.equal((await db.query('select public.ech_register_session() ok')).rows[0].ok,true);}
  await check('anonymous has no administration functions',async()=>{await db.exec('reset role;set role anon');await denied(()=>db.query('select public.ech_membership_list()'),'42501');await denied(()=>db.query('select public.ech_application_backup()'),'42501');});
  await check('owner and technical roles do not imply application administration',async()=>{await as('owner');await denied(()=>db.query('select public.ech_membership_list()'),'PT403');await denied(()=>commit(command(emails.staff,1)),'PT403');await denied(()=>db.query('select public.ech_application_backup()'),'PT403');});
  await check('direct membership and receipt writes are denied',async()=>{await as('admin');await denied(()=>db.query('update public.ech_memberships set active=false'),'42501');await denied(()=>db.query('select * from public.ech_membership_receipts'),'42501');});
  await check('last active application administrator cannot demote or disable self',async()=>{await as('admin');await denied(()=>commit(command(emails.admin,1,{operationalRole:'owner',technicalAdmin:true,active:false,applicationAdmin:true})),'PT409');await denied(()=>commit(command(emails.admin,1,{operationalRole:'owner',technicalAdmin:true,applicationAdmin:false})),'PT409');});
  let saved,envelope;
  await check('existing account only, exact fields and stale revision are enforced',async()=>{await denied(()=>commit(command('unknown@example.invalid',0)),'PT400');const value=command(emails.staff,1);value.command.fields.rogue=true;await denied(()=>commit(value),'PT400');await denied(()=>commit(command(emails.staff,0)),'PT409');const fraction=command(emails.staff,1.1);await denied(()=>commit(fraction),'PT400');});
  await check('membership creation is atomic, fingerprinted and duplicate safe',async()=>{envelope=command(emails.newUser,0);saved=await commit(envelope);assert.equal(saved.member.userId,ids.newUser);assert.equal(saved.member.revision,1);assert.equal(saved.receipt.operationId,envelope.operationId);const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);assert.equal(saved.receipt.commandFingerprint,createHash('sha256').update(canonical(envelope)).digest('hex'));assert.deepEqual(await commit(envelope),saved);await denied(()=>commit({...envelope,command:{...envelope.command,fields:{...envelope.command.fields,displayName:'Altered'}}}),'PT409');});
  await check('second administrator allows demotion and lost admin cannot replay receipt',async()=>{await commit(command(emails.staff,1,{applicationAdmin:true}));await commit(command(emails.admin,1,{operationalRole:'owner',technicalAdmin:true,applicationAdmin:false}));await denied(()=>commit(envelope),'PT403');await as('staff');assert.equal((await db.query('select public.ech_membership_list() items')).rows[0].items.length,4);});
  await check('backup includes all data families without auth credentials or sessions',async()=>{
    await as('owner');const partnerId=randomUUID();
    await db.query('select public.ech_commit($1,$2::jsonb)',['partner',JSON.stringify({schema:1,operationId:randomUUID(),expectedRevision:0,command:{type:'create',id:partnerId,fields:{organization:'Example',geography:'Vancouver'}}})]);
    await db.query('select public.ech_commit($1,$2::jsonb)',['partner',JSON.stringify({schema:1,operationId:randomUUID(),expectedRevision:1,command:{type:'save_person',id:partnerId,fields:{person:{id:randomUUID(),name:'Example person',role:'Contact',methods:[]}}}})]);
    await as('staff');const snapshot=(await db.query('select public.ech_application_backup() snapshot')).rows[0].snapshot;
    assert.equal(snapshot.format,'ech-application-snapshot');assert.equal(snapshot.version,1);assert.equal(snapshot.restorePolicy,'isolated-data-only-no-automatic-grants');
    assert.equal(snapshot.records.length,1);assert.equal(snapshot.personKeys.length,1);assert.equal(snapshot.events.length,2);assert.equal(snapshot.commandReceipts.length,2);assert.equal(snapshot.memberships.length,4);assert.equal(snapshot.membershipReceipts.length,3);
    assert.deepEqual(Object.keys(snapshot).sort(),['format','version','exportedAt','exportedBy','restorePolicy','records','personKeys','events','commandReceipts','memberships','membershipReceipts'].sort());
    for(const token of Object.values(sessions))assert(!JSON.stringify(snapshot).includes(token));
  });
  await check('revoked app-admin session loses list, update and backup access',async()=>{await db.query('select public.ech_logout_session()');await denied(()=>db.query('select public.ech_membership_list()'),'PT403');await denied(()=>commit(command(emails.newUser,1)),'PT403');await denied(()=>db.query('select public.ech_application_backup()'),'PT403');});
  console.log(JSON.stringify({passed,migrationSha256:createHash('sha256').update(additive).digest('hex'),network:false,catalogQueries:0}));
} finally {await db.close();}
