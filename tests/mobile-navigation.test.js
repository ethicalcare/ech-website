import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {create,act} from 'react-test-renderer';
const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/MobileNavigation.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {MobileNavigation}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const titles={daily:'Today',leads:'Care Inquiries',partners:'Referral Partners',followups:'Follow-ups',operations:'Operations',overview:'Overview',assessments:'Assessments','staff-profiles':'Staff Profiles'};
test('mobile menu closes on selection, preserves current Accounts and restricts shared sections',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const oldWindow=globalThis.window,oldDocument=globalThis.document;
 globalThis.window=Object.assign(new EventTarget(),{matchMedia:()=>Object.assign(new EventTarget(),{matches:false})});globalThis.document={body:{style:{overflow:''}}};
 const modal={open:false,showModal(){this.open=true;},close(){this.open=false;}};let focus=0,accounts=0;const routes=[];let root;
 const props={titles,view:'operations',section:'team',accountsOpen:false,sharedSchedule:false,manageAccounts:true,onNavigate:(...args)=>routes.push(args),onAccounts:()=>accounts++};
 try{
 await act(async()=>{root=create(React.createElement(MobileNavigation,props),{createNodeMock:e=>e.type==='dialog'?(e.props.className==='mobile-navigation-drawer'?modal:{open:false,showModal(){this.open=true;},close(){this.open=false;}}):e.type==='button'?{focus(){focus++;}}:null});});
 const button=name=>root.root.findAllByType('button').find(n=>n.props.children===name);
 const open=()=>root.root.findByProps({className:'mobile-navigation-trigger'}).props.onClick();
 await act(async()=>open());assert.equal(modal.open,true);assert.equal(document.body.style.overflow,'hidden');
 await act(async()=>button('Team & settings').props.onClick());assert.deepEqual(routes,[['operations','team']]);assert.equal(modal.open,false);assert.equal(document.body.style.overflow,'');assert.equal(focus,1);
 await act(async()=>root.update(React.createElement(MobileNavigation,{...props,accountsOpen:true,sharedSchedule:true})));
 await act(async()=>button('Accounts').props.onClick());assert.equal(accounts,0);
 assert.equal(button('Team & settings'),undefined);assert.ok(button('Schedule'));
 await act(async()=>root.update(React.createElement(MobileNavigation,{...props,staffProfilesLabel:'Staff Profiles',sharedSchedule:true})));
 assert.equal(root.root.findByProps({'aria-label':'Teams & Settings'}).findAllByType('button').length,2);
 await act(async()=>open());await act(async()=>button('Staff Profiles').props.onClick());
 assert.deepEqual(routes,[['operations','team'],['staff-profiles']]);assert.equal(modal.open,false);
 await act(async()=>root.update(React.createElement(MobileNavigation,{...props,view:'staff-profiles',staffProfilesLabel:'My Staff Profile',manageAccounts:false,sharedSchedule:true,titles:{...titles,'staff-profiles':'My Staff Profile'}})));
 assert.equal(button('My Staff Profile').props['aria-current'],'page');assert.equal(button('Accounts'),undefined);
 await act(async()=>root.update(React.createElement(MobileNavigation,{...props,staffProfilesLabel:null,manageAccounts:false})));
 assert.equal(button('Staff Profiles'),undefined);
 await act(async()=>open());await act(async()=>window.dispatchEvent(new Event('popstate')));assert.equal(modal.open,false);
 await act(async()=>open());await act(async()=>root.root.findByProps({className:'mobile-navigation-drawer'}).props.onCancel());assert.equal(root.root.findByProps({className:'mobile-navigation-trigger'}).props['aria-expanded'],false);
 }finally{if(root)await act(async()=>root.unmount());globalThis.window=oldWindow;globalThis.document=oldDocument;}
});
