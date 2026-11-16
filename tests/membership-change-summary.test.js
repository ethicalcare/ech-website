import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const bundle=buildSync({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/MembershipChangeSummary.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',logLevel:'silent'}).outputFiles[0].text;
const {MembershipChangeSummary}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const fields={displayName:'Fictional staff',active:true,operationalRole:'manager',technicalAdmin:false,applicationAdmin:false};
const render=f=>renderToStaticMarkup(createElement(MembershipChangeSummary,{fields:{...fields,...f}}));
test('retained command shows requested identity, role and all access flags',()=>{
 const html=render({technicalAdmin:true,applicationAdmin:true,delegatedUserAdmin:false});
 for(const text of ['Fictional staff','Allow sign-in','CRM role: manager','Technical status access: Enabled','Application administrator access: Enabled','Delegated account management: Disabled']) assert.ok(html.includes(text),text);
});
test('deactivation explains session termination without suggesting role changes re-enable sign-in',()=>{
 const html=render({active:false,operationalRole:'staff'});
 assert.match(html,/Deactivate account and end existing sessions/);assert.match(html,/Not granted for this role/);assert.doesNotMatch(html,/Allow sign-in/);
});
test('omitted delegation is distinguished from an explicit owner change',()=>{
 assert.match(render({}),/Not explicitly changed by this save/);
 assert.match(render({delegatedUserAdmin:true}),/Delegated account management: Enabled/);
 assert.match(render({delegatedUserAdmin:false}),/Delegated account management: Disabled/);
});
test('summary renders names as text, including untrusted provider characters',()=>{
 assert.match(render({displayName:'<script>alert(1)</script>'}),/&lt;script&gt;/);
});
test('confirmation and retained retry both summarize the exact command fields',()=>{
 const source=readFileSync(new URL('../admin-src/app/shared/AdminTools.tsx',import.meta.url),'utf8');
 assert.match(source,/<MembershipChangeSummary fields=\{operation.body.command.fields\}/);
 assert.match(source,/<MembershipChangeSummary fields=\{buildMembershipOperation\('', draft\).command.fields\}/);
});
