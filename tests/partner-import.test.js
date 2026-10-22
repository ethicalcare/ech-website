import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePartnerImport, importPartner } from '../lib/admin/partner-import.js';
import { commandFingerprint } from '../lib/admin/shared-commands.js';
const boards=['1YlzNi4idvoAuErFXcVCYhNqtcvW21S4JN8RRTgAXf60','1K3Tn7UASsvSpPfw_qQh40yYc10z5wBrSkeGXaFRsRI8'];
export function importEnvelope(){return {schema:1,operationId:'00000000-0000-4000-8000-000000000001',expectedRevision:0,command:{type:'create',id:'00000000-0000-4000-8000-000000000002',fields:{organization:'Example partner',geography:'Vancouver',category:'Community',contactRoute:'Contact',stage:'Not contacted',sprint:'Top 15',openingAsk:'Ask permission',materials:'None',lastTouch:'2026-09-01',nextDate:'2026-10-30',contacted:false}},source:{origin:'executive-handoff',sourceKey:boards[0]+':689102916:7',rank:1,sourceVariants:boards.map(spreadsheetId=>({spreadsheetId,sheetId:689102916,tab:'Prospect Bank',row:7,url:`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=689102916&range=A7:N7`,values:['FALSE',String(1),'Top 15','Vancouver','Community','Example partner','Contact','Ask permission','Not contacted','Caller to be confirmed','None','2026-09-01','2026-10-30','Notes']})),brief:{documentId:'abcdefghijklmnopqrstuv',title:'01 - Example brief',url:'https://docs.google.com/document/d/abcdefghijklmnopqrstuv/edit?usp=drivesdk',modifiedAt:'2026-10-22T00:00:00.000Z',text:'Prospect Bank #1 | Complete source brief retained.',sources:[{label:'Source',url:'https://example.test/source'}]},reviewFlags:['Review before outreach'],assignment:{status:'caller_tbc',sourceText:'Caller to be confirmed'}}};}
const current={config:{base:'https://example.test',key:'public'},token:'token',member:{active:true,application_admin:true}};
test('import preserves exact native source and full-envelope fingerprint',async()=>{
  const value=importEnvelope();const record={...value.command.fields,id:value.command.id,revision:1,ownerId:null,source:value.source};const result={record,receipt:{operationId:value.operationId,expectedRevision:0,revision:1,commandFingerprint:await commandFingerprint(value)}};
  assert.deepEqual(parsePartnerImport(value),value);
  const answer=await importPartner(current,value,async(url,options)=>{assert(url.endsWith('/ech_import_partner'));assert.deepEqual(JSON.parse(options.body),{p_envelope:value});return new Response(JSON.stringify(result));});
  assert.deepEqual(answer.record.source,value.source);
  const changed=structuredClone(value);changed.source.brief.text='Changed';assert.notEqual(await commandFingerprint(changed),result.receipt.commandFingerprint);
});
test('import requires explicit active application admin before RPC',async()=>{
  for(const member of [{active:true,technical_admin:true,operational_role:'owner'},{active:false,application_admin:true}])await assert.rejects(()=>importPartner({...current,member},importEnvelope(),()=>{throw Error('must not call');}),{status:403});
});
test('source validation rejects forgery, unknown fields, wrong board, rank mismatch, link mismatch and unsafe links',()=>{
  const edits=[v=>v.extra=true,v=>v.source.extra=true,v=>v.expectedRevision=1,v=>v.command.type='update',v=>v.source.rank=51,v=>v.source.sourceVariants[0].row=8,v=>v.source.sourceKey='other',v=>v.source.sourceVariants[1].spreadsheetId=boards[0],v=>v.source.sourceVariants[0].url='https://example.test',v=>v.source.sourceVariants[0].values[0]=false,v=>v.source.brief.url='https://docs.google.com/document/d/different/edit',v=>v.source.brief.sources[0].url='javascript:alert(1)',v=>v.source.assignment.status='assigned',v=>v.source.brief.text='x'.repeat(25000),v=>v.command.fields.organization='Different',v=>v.source.sourceVariants[1].values[4]='Different',v=>v.source.assignment.sourceText='Different',v=>v.source.brief=null,v=>v.source.brief.title='02 - Wrong rank',v=>v.source.brief.text='Prospect Bank #11 | Wrong rank'];
  for(const edit of edits){const value=importEnvelope();edit(value);assert.throws(()=>parsePartnerImport(value));}
});
test('import rejects unverified source or receipt response',async()=>{
  const value=importEnvelope();const record={id:value.command.id,revision:1,ownerId:null,source:{...value.source,brief:null}};const receipt={operationId:value.operationId,expectedRevision:0,revision:1,commandFingerprint:await commandFingerprint(value)};
  await assert.rejects(()=>importPartner(current,value,async()=>new Response(JSON.stringify({record,receipt}))),{status:502});
});

test('board notes may differ while native values remain intact',()=>{const value=importEnvelope();value.source.sourceVariants[1].values[13]='Other board note';assert.deepEqual(parsePartnerImport(value),value);});

test('column 11 is last touch and column 12 is next action date with unequal nonblank dates',()=>{
  const value=importEnvelope();const parsed=parsePartnerImport(value);
  assert.equal(parsed.command.fields.lastTouch,'2026-09-01');assert.equal(parsed.source.sourceVariants[0].values[11],'2026-09-01');
  assert.equal(parsed.command.fields.nextDate,'2026-10-30');assert.equal(parsed.source.sourceVariants[0].values[12],'2026-10-30');
  [value.command.fields.lastTouch,value.command.fields.nextDate]=[value.command.fields.nextDate,value.command.fields.lastTouch];
  assert.throws(()=>parsePartnerImport(value));
});
