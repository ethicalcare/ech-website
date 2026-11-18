import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {schemaSources,fictionalSources} from './operations-final-schema-plan.js';
const sources=schemaSources();
const names=sources.map(s=>s.file.split('/').pop());
test('complete final schema matches reviewed source hashes and all repository SQL',()=>{
  assert.deepEqual([...names].sort(),readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort());
  assert.equal(new Set(names.map(n=>n.split('_')[0])).size,33);
  for(const {sql} of sources){assert.match(sql,/\bbegin\s*;/iu);assert.match(sql,/\bcommit\s*;\s*$/iu);}
});
test('full explicit dependency order includes partner and all Operations revisions',()=>{
  assert.deepEqual(names.slice(0,4),['20261020_ech_leads.sql','20261022_application_admin.sql','20261024_google_access_requests.sql','20261114_partner_account_administration.sql']);
  for(let n=1;n<=20;n++)assert.ok(names[n+3].startsWith('20261114'+String(n).padStart(4,'0')+'00_'));
  assert.equal(names[24],'20261115002100_account_decision_history.sql');
  assert.ok(names[25].startsWith('20261115002200_'));
  assert.ok(names[26].startsWith('20261115002300_'));
  assert.ok(names[27].startsWith('20261115002400_'));
  assert.ok(names[28].startsWith('20261116002500_'));
});
test('fictional owner substitution leaves source bytes untouched and no production owner literals',()=>{
  const fixture=fictionalSources('10000000-0000-4000-8000-000000000001');
  for(const item of fixture){assert.doesNotMatch(item.sql,/1fbc76c6-8521-4f9e-b0c9-f174ada676aa|erick@bloxlabs\.tech/u);}
  assert.deepEqual(schemaSources(),sources);
  assert.throws(()=>fictionalSources('1fbc76c6-8521-4f9e-b0c9-f174ada676aa'));
});
test('latest report source and explicit application read-grant warning remain visible',()=>{
  const latest=sources.find(s=>s.file.includes('02000_')).sql;
  assert.match(latest,/create or replace function public\.ech_visit_report_projection/iu);
  assert.match(latest,/create or replace function public\.ech_operations_visit_report_commit/iu);
  for(const n of [1,4,6,7,8])assert.match(sources[n+3].sql,/grant execute on function.*to authenticated/iu);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.doesNotMatch(JSON.stringify(pkg.scripts),/operations-final-schema-sql|supabase db push|psql/iu);
});
