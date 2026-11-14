import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../admin-src/app/shared/named-runtime.js', import.meta.url), 'utf8');
const start = source.indexOf('function finishDialog(reportNone=false){');
const end = source.indexOf('\nfunction taskSummary(', start);
assert.ok(start >= 0 && end > start);
const finishSource = source.slice(start, end);

function scenario(results) {
  const elements = new Map();
  const values = { '#report-start':'2026-11-02T09:03', '#report-end':'2026-11-02T11:55',
    '#report-outcome':'Service not completed', '#report-summary':'', '#report-issue':'',
    '#note-recipient':'No addressed note', '#next-note':'' };
  for (const [key,value] of Object.entries(values)) elements.set(key,{value});
  for (const key of ['#modal-done','#report-none','#cancel-action','#report-form']) elements.set(key,{});
  const visit = {id:'visit',status:'In progress',worker:'Jamie'};
  const data = {case:{report:null},appointments:[visit],calendar:{}};
  const observed = {dialogs:[],errors:[],data};
  const ctx = { state:{case:{},role:'worker'}, people:{worker:{name:'Jamie'}}, reportStorageChanged:false,
    selectedEvent:()=>visit, canFinishReport:()=>true,
    visitTasks:()=>results.map((result,i)=>({id:String(i),category:'Task',name:'Example',time:'',result,resultNote:'Recorded detail'})),
    esc:String, taskSummary:()=>'', closeModal:()=>{}, finishModal:()=>{}, auditEvent:()=>{},
    modal:(title,body,footer)=>observed.dialogs.push({title,body,footer}),
    info:(title)=>observed.dialogs.push({title}), formError:(message)=>observed.errors.push(message),
    saveReportDraft:(update,done)=>{update(data);done();}, $:key=>elements.get(key) };
  runInNewContext(finishSource+'; this.finishDialog=finishDialog;',ctx);
  return {ctx,elements,observed};
}

test('no completed tasks require an explanation and preserve unrecorded results',()=>{
  const {ctx,elements,observed}=scenario(['Not recorded','Not completed']);
  ctx.finishDialog();
  assert.match(observed.dialogs.at(-1).footer,/Report no tasks completed/);
  elements.get('#report-none').onclick();
  assert.match(observed.dialogs.at(-1).body,/What happened and why were no tasks completed\?/);
  assert.match(observed.dialogs.at(-1).body,/<textarea id="report-summary" required><\/textarea>/);
  const submit=()=>elements.get('#report-form').onsubmit({preventDefault(){}});
  submit();
  assert.equal(observed.data.case.report,null);
  elements.get('#report-summary').value='Visit interrupted before the work began.';
  elements.get('#report-outcome').value='Service completed';
  submit();
  assert.equal(observed.data.case.report,null);
  assert.match(observed.errors.at(-1),/no tasks were completed/);
  elements.get('#report-outcome').value='Service not completed';
  submit();
  assert.equal(observed.data.case.report.summary,'Visit interrupted before the work began.');
  assert.deepEqual(Array.from(observed.data.case.report.tasks,t=>t.result),['Not recorded','Not completed']);
  assert.equal(observed.data.case.report.start,'2026-11-02T09:03');
});
test('recorded completed work cannot use the no-task path',()=>{
  const {ctx,observed}=scenario(['Completed','Not recorded']);
  ctx.finishDialog();
  assert.doesNotMatch(observed.dialogs.at(-1).footer,/Report no tasks completed/);
  ctx.finishDialog(true);
  assert.equal(observed.dialogs.at(-1).title,'Completed work is already recorded');
});
test('all recorded but unfinished work still has a blank required explanation',()=>{
  const {ctx,observed}=scenario(['Not completed','Needs help']);
  ctx.finishDialog();
  assert.match(observed.dialogs.at(-1).body,/<textarea id="report-summary" required><\/textarea>/);
  assert.doesNotMatch(observed.dialogs.at(-1).body,/No clean pillowcase/);
  assert.match(observed.dialogs.at(-1).body,/<textarea id="next-note"><\/textarea>/);
});
