import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';

const require=createRequire(import.meta.url);
const rootUrl=new URL('../',import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('admin-src/app/shared/StaffProfileWorkspace.tsx',rootUrl))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},a=>({path:pathToFileURL(require.resolve(a.path)).href,external:true}));}}]});
const {StaffProfileWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('staff profile wires scoped responsive pairs and preserves long and private fields',async()=>{
 const css=readFileSync(new URL('admin-src/app/shared/staff-profile-workspace.css',rootUrl),'utf8');
 assert.match(readFileSync(new URL('admin-src/app/globals.css',rootUrl),'utf8'),/staff-profile-workspace\.css/);
 assert.match(css,/\.staff-profile-pair\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
 assert.match(css,/@container staff-profile \(min-width: 38rem\)\s*\{\s*\.staff-profile-pair\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
 const profile={id:'fictional-person',name:'Fictional staff',revision:1,workerType:'rn',availability:'Weekdays',vacationStart:'',vacationEnd:'',credentials:[],management:{payGrade:'Private grade',hourlyRate:'Private rate',performance:'Private notes'}};
 const view=mode=>React.createElement(StaffProfileWorkspace,{initialProfile:profile,mode,api:{},photoEnabled:false});
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 let root;
 try {
  await act(async()=>{root=create(view('admin_direct'));});
  const vacation=root.root.findByProps({'aria-label':'Vacation dates'});
  assert.equal(vacation.props.className,'staff-profile-pair');
  assert.deepEqual(vacation.findAllByType('input').map(el=>el.props['aria-label']),['Vacation start','Vacation end']);
  assert.equal(root.root.findByProps({'aria-label':'Availability'}).parent.props.className,'staff-profile-long');
  const management=root.root.findByProps({'aria-label':'Management-only information'});
  assert.deepEqual(management.findByProps({className:'staff-profile-pair'}).findAllByType('input').map(el=>el.props['aria-label']),['payGrade','hourlyRate']);
  assert.equal(management.findByType('textarea').props['aria-label'],'performance');
  assert.equal(root.root.findAllByProps({type:'file'}).length,0);
  await act(async()=>root.update(view('staff_submission')));
  assert.equal(root.root.findAllByProps({'aria-label':'Management-only information'}).length,0);
  assert.doesNotMatch(JSON.stringify(root.toJSON()),/Private grade|Private rate|Private notes/);
 } finally {
  await act(async()=>root?.unmount());
  delete globalThis.IS_REACT_ACT_ENVIRONMENT;
 }
});
