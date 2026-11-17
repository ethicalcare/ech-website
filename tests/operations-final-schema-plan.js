import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
export const schemaManifest = JSON.parse(readFileSync(new URL('./operations-schema-manifest.json', import.meta.url), 'utf8'));
export function schemaSources() {
  assert.equal(schemaManifest.schema,1);
  assert.equal(schemaManifest.executionAuthorized,false);
  assert.equal(schemaManifest.migrations.length,29);
  return schemaManifest.migrations.map(entry=>{
    assert.match(entry.file,/^migrations\/\d{8,14}_[a-z_]+\.sql$/u);
    const sql=readFileSync(new URL('../'+entry.file,import.meta.url),'utf8');
    assert.equal(createHash('sha256').update(sql).digest('hex'),entry.sha256,entry.file+' hash changed; review manifest update');
    return {...entry,sql};
  });
}
export function fictionalSources(owner) {
  assert.match(owner,/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u);
  const sources=schemaSources();
  const admin=sources.find(s=>s.file.endsWith('20261022_application_admin.sql'));
  const match=admin.sql.match(/where id='([0-9a-f-]{36})'::uuid and lower\(email\)='([^']+)'/u);
  assert.ok(match,'Canonical owner bootstrap must be explicitly located');
  assert.notEqual(owner,match[1],'Never use production owner identity in fixture');
  return sources.map(s=>({...s,sql:s.sql.replaceAll(match[1],owner).replaceAll(match[2],'owner@example.invalid')}));
}
