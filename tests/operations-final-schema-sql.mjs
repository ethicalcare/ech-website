// Native PostgreSQL ONLY, private disposable socket, never a supplied database.
// Default validates source and prints plan; --run-fictional explicitly creates
// a temporary fictional cluster. No hosted connection or production activation.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {fictionalSources} from './operations-final-schema-plan.js';
const args=process.argv.slice(2);
assert.ok(args.length===0 || (args.length===1 && args[0]==='--run-fictional'),'Only --run-fictional supported; no connection/URL arguments');
const owner=randomUUID();
const sources=fictionalSources(owner);
console.log('PREPARATION: 30 source hashes verified. Applying migrations grants some authenticated reads; this harness uses only a private disposable cluster.');
if(!args.length){console.log(sources.map(s=>s.file).join('\n'));console.log('NOT EXECUTED. Use --run-fictional with preinstalled native PostgreSQL for schema/ACL verification. This is not hosted-provider or behavioral verification.');process.exit(0);}
const bin=n=>process.env.PG_BIN?join(resolve(process.env.PG_BIN),n):n;
// Do not inherit a default server, database, service file or credentials.
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));
function run(name,args,input){const p=spawnSync(bin(name),args,{input,encoding:'utf8',env,timeout:120000,maxBuffer:8*1024*1024});assert.ifError(p.error);assert.equal(p.status,0,p.stderr);return p.stdout.trim();}
// Check binaries BEFORE creating any filesystem or database state.
for(const n of ['initdb','pg_ctl','psql'])run(n,['--version']);
const root=mkdtempSync(join(tmpdir(),'ech-final-fictional-'));
const data=join(root,'data');let started=false;let stopped=false;
const psql=['-XqAt','-h',root,'-p','5432','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'];
const sql=q=>run('psql',psql,`set statement_timeout='20s';set lock_timeout='2s';\n${q}`);
const quote=s=>"'"+s.replaceAll("'","''")+"'";
let passed=0;
function check(label,fn){fn();passed++;console.log('PASS '+label);}
try{
 run('initdb',['-D',data,'-U','postgres','-A','trust','--no-locale','--encoding=UTF8']);
 run('pg_ctl',['-D',data,'-l',join(root,'server.log'),'-o',`-k '${root}' -p 5432 -c listen_addresses='' -c shared_buffers=16MB`,'-w','start']);started=true;
 check('private fixture server identity',()=>{assert.equal(sql('show data_directory'),data);assert.equal(sql('show listen_addresses'),'');});
 sql(`create role anon;create role authenticated;create role supabase_auth_admin;create role service_role bypassrls;
 create schema auth;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb,banned_until timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz,created_at timestamptz not null default now());
 create table auth.identities(user_id uuid,provider text,identity_data jsonb);
 grant usage on schema auth,public to anon,authenticated,service_role;
 create function auth.jwt() returns jsonb language sql stable as $$select current_setting('request.jwt.claims',true)::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 insert into auth.users(id,email,email_confirmed_at) values('${owner}','owner@example.invalid',now());`);
 for(const source of sources){sql(source.sql);console.log('APPLIED-FICTIONAL '+source.file+' sha256='+source.sha256);}
 check('fictional protected owner bootstrapped',()=>assert.equal(sql(`select count(*) from public.ech_memberships where user_id='${owner}' and active and application_admin and operational_role='owner'`),'1'));
 check('partner schema present',()=>assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='ech_memberships' and column_name in ('delegated_user_admin','sessions_valid_after')"),'2'));
 check('latest report event time schema and writer installed',()=>{
 assert.equal(sql("select count(*) from information_schema.columns where table_schema='public' and table_name='ech_visit_report_events' and column_name='note_event_at'"),'1');
 assert.equal(sql("select position('note_event_at' in pg_get_functiondef('public.ech_operations_visit_report_commit(jsonb)'::regprocedure))>0"),'t');
 });
 check('writers and account-history RPC remain unactivated',()=>{
 for(const sig of ['public.ech_operations_visit_commit(jsonb)','public.ech_operations_visit_report_commit(jsonb)','public.ech_account_decision_history(uuid,bigint,integer)']){
 for(const role of ['anon','authenticated'])assert.equal(sql(`select has_function_privilege(${quote(role)},${quote(sig)},'execute')`),'f',role+' '+sig);
 }
 });
 check('migration-installed read grants are explicitly accounted for',()=>{
 for(const sig of ['public.ech_operations_schedule(timestamptz,timestamptz,text)','public.ech_operations_visit_detail(uuid,bigint,text,bigint)','public.ech_operations_visit_report(uuid,bigint,text,bigint,bigint)','public.ech_operations_schedule_visit(uuid,text,bigint)','public.ech_operations_schedule_sources(text,bigint)']){
 assert.equal(sql(`select has_function_privilege('authenticated',${quote(sig)},'execute')`),'t',sig);
 assert.equal(sql(`select has_function_privilege('anon',${quote(sig)},'execute')`),'f',sig);
 }
 });
 check('Operations migration did not seed records or permissions',()=>{
 for(const table of ['ech_operations_grants','ech_schedule_clients','ech_schedule_workers','ech_schedule_visits','ech_schedule_events','ech_schedule_operation_receipts','ech_visit_report_events'])assert.equal(sql('select count(*) from public.'+table),'0',table);
 });
 check('core Operations tables have RLS and deny direct app mutations',()=>{
 for(const table of ['ech_operations_grants','ech_schedule_visits','ech_schedule_events','ech_visit_report_events']){
 assert.equal(sql(`select relrowsecurity from pg_class where oid=${quote('public.'+table)}::regclass`),'t',table);
 for(const role of ['anon','authenticated'])for(const privilege of ['INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal(sql(`select has_table_privilege(${quote(role)},${quote('public.'+table)},${quote(privilege)})`),'f',role+' '+table+' '+privilege);
 }
 });
 console.log(`${passed} final-schema installation/catalog/ACL checks passed. No writer activation; no behavioral or real-provider sign-in claim.`);
}finally{
 if(started){run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);stopped=true;}
 // Never remove a running cluster if stop failed. Path created by this process only.
 if(!started||stopped){rmSync(root,{recursive:true,force:true});console.log('CLEANUP: only owned disposable fictional cluster removed.');}
}
