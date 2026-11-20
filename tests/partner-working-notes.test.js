import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parseCommand} from '../lib/admin/shared-commands.js';

const editor=readFileSync(new URL('../admin-src/app/shared/RecordEditor.tsx',import.meta.url),'utf8');
const id='10000000-0000-4000-8000-000000000001';
const operationId='10000000-0000-4000-8000-000000000002';

test('working partner notes use a distinct gated Save and update only the notes field',()=>{
  const form=editor.match(/<form className="record-details-form" onSubmit=\{savePartnerNotes\}>(.*?)<\/form>/s)?.[1];
  assert.ok(form);
  assert.match(form,/Save description and notes/);
  assert.match(form,/disabled=\{pending \|\| !allowed \|\| uncertain \|\| needsReview\}/);
  assert.doesNotMatch(form,/setMadeContact|setOutcome|nextAction|record_activity/);
  const handler=editor.match(/async function savePartnerNotes\(event: FormEvent\) \{(.*?)\n  \}/s)?.[1];
  assert.ok(handler);
  assert.match(handler,/Object\.is\(fields\.notes, savedFields\.notes\)/);
  assert.match(handler,/await execute\('update', \{ notes: String\(fields\.notes \?\? ''\) \}\);/);
  assert.doesNotMatch(handler,/record_activity|contacted|nextAction|stage|source/);
  for(const notes of ['Description\nFictional community organization\n\nInternal notes\nVerify service area','']){
    const payload={schema:1,expectedRevision:5,operationId,command:{type:'update',id,fields:{notes}}};
    assert.deepEqual(parseCommand('partner',payload),payload);
  }
});

test('general save does not submit or drop the working notes draft; original research remains visible',()=>{
  assert.match(editor,/if \(kind === 'partner' && record\) delete values\.notes/);
  assert.match(editor,/!Object\.hasOwn\(values, 'notes'\) && !Object\.is\(currentDraft\.notes, base\.current\.notes\)/);
  assert.match(editor,/nextFields\.notes = currentDraft\.notes/);
  assert.match(editor,/<PartnerSourceInformation record=\{record as SharedPartner\}/);
});
