import test from 'node:test';
import assert from 'node:assert/strict';
import {activityDayGroups} from '../admin-src/app/shared/activity-day-groups.ts';
test('Vancouver event day differs from UTC and recording day, without modifying input',()=>{
 const events=[{id:'a',actual:'2026-11-17T06:59:59.999999Z',recorded:'2026-11-18T12:00:00Z'},{id:'b',actual:'2026-11-17T07:00:00Z',recorded:'2026-11-17T07:01:00Z'}];
 const before=JSON.stringify(events);const groups=activityDayGroups(events,e=>e.actual);
 assert.deepEqual(groups.map(g=>g.day),['2026-11-16','2026-11-17']);assert.deepEqual(groups.map(g=>g.events.map(e=>e.id)),[['a'],['b']]);assert.equal(JSON.stringify(events),before);
});
test('offset-equivalent timestamps share a day and preserve original/correction order',()=>{
 const events=[{version:1,time:'2026-11-16T23:00:00-07:00'},{version:2,time:'2026-11-17T06:00:00Z'}];
 assert.deepEqual(activityDayGroups(events,e=>e.time),[{day:'2026-11-16',events}]);assert.deepEqual(activityDayGroups([],e=>e.time),[]);
});
test('winter date boundary uses Vancouver convention rather than fixed summer offset',()=>{
 assert.deepEqual(activityDayGroups(['2025-01-16T07:59:00Z','2025-01-16T08:00:00Z'],s=>s).map(g=>g.day),['2025-01-15','2025-01-16']);
});
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
test('task activity renders separate Vancouver day sections while retaining limited-visibility warning',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../admin-src/app/shared/SharedVisitTaskTimeline.tsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'external-react',setup(b){b.onResolve({filter:/^react(?:\/.*)?$/},args=>({path:pathToFileURL(require.resolve(args.path)).href,external:true}));}}]});
 const {SharedVisitTaskTimeline}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const snapshot={plan:[{id:'category',label:'Support',tasks:[{id:'task',text:'Fictional task'}]}],additions:[],resultVisibility:'limited',results:[{taskId:'task',version:1,outcome:'done',observation:'Original observation',actualAt:'2026-11-17T06:59:59Z',recordedAt:'2026-11-18T12:00:00Z',actorId:'fictional',reason:null},{taskId:'task',version:2,outcome:'declined',observation:'Corrected observation',actualAt:'2026-11-17T07:00:00Z',recordedAt:'2026-11-18T12:01:00Z',actorId:'fictional',reason:'Factual correction'}]};
 const html=renderToStaticMarkup(React.createElement(SharedVisitTaskTimeline,{snapshot}));
 assert(html.includes('Task activity on 2026-11-16 Vancouver'));assert(html.includes('Task activity on 2026-11-17 Vancouver'));assert(html.indexOf('Original observation')<html.indexOf('Corrected observation'));assert(html.includes('not a complete visit history'));assert(html.includes('Factual correction'));
});
