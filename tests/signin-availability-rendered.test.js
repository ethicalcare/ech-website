import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import React from 'react';
import {act,create} from 'react-test-renderer';

const require=createRequire(import.meta.url);
const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SignIn.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
const {SignIn}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));

test('existing staff see which sign-in methods are unavailable when the security check is not configured',async()=>{
 globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 for(const googleEnabled of [true,false]){
  const accesses=[];
  const client=new Proxy({},{get(_target,key){accesses.push(key);throw Error('No sign-in request expected');}});
  let root;
  try{
   await act(async()=>{root=create(React.createElement(SignIn,{session:{authenticated:false,principal:null,capabilities:[],login:{method:'email_password',siteKey:null,googleEnabled}},client,onVerified:()=>assert.fail('no verification')}));});
   const buttons=()=>root.root.findAllByType('button');
   const button=(label)=>buttons().find(b=>b.props.children===label);
   const google=()=>buttons().find(b=>b.props.className==='google-signin-button');
   const alert=()=>root.root.findAll(n=>n.type==='p'&&n.props.role==='alert').map(n=>n.props.children).join(' ');
   assert.equal(button('Sign in').props.disabled,true);
   assert.equal(!!google(),googleEnabled);
   if(googleEnabled){
    assert.equal(google().props.disabled,false);
    assert.match(alert(),/Password and email-code sign-in are unavailable right now. You can still use Google with an authorized account./u);
   }else{
    assert.match(alert(),/Sign-in setup is unavailable./u);
    assert.doesNotMatch(alert(),/You can still use Google/u);
   }
   await act(async()=>button('Use an email code').props.onClick());
   assert.equal(button('Request sign-in code').props.disabled,true);
   assert.match(alert(),/unavailable/u);
   assert.deepEqual(accesses,[]);
  }finally{if(root)await act(async()=>root.unmount());}
 }
});
