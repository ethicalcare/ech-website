import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsIncidents} from './fixtures/visit-incidents/operations-incidents.js';
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const visit=id(1),other=id(2);
function actor(n,role){
 const actor=id(n);
 return {principal:{id:actor,operationalRole:role},member:{user_id:actor,operational_role:role,active:true,revision:8}};
}
const staff=actor(3,'staff'),manager=actor(4,'manager'),peer=actor(5,'manager');
const req=(a,method='GET',target=visit)=>new Request('https://ech-fiction.invalid/api/admin/operations?incidents=1'+
 (method==='GET'?'&visit='+target+'&revision=4':''),{method,headers:{
 'x-ech-schedule-actor':a.principal.id,'x-ech-schedule-role':a.principal.operationalRole}});
test('same selected visit shares receipt-bound filing and tracked manager follow-up',async()=>{
 const items=new Map(),ops=new Map();
 const port={async withVisitTransaction(a,requested,work){
   if(requested!==visit)return null;
   const who=a.principal.id,role=a.principal.operationalRole;
   return work({current:{actor:who,role,visit,revision:4,membershipRevision:8,assigned:role==='staff',cancelled:false},
     list:async()=>[...items.values()],
     async commit({actor,command}){
       assert.equal(actor,who);
       const existing=ops.get(command.operation);
       if(existing){assert.deepEqual(existing.command,command);return existing.receipt;}
       let item=items.get(command.id);
       if(command.action==='file'&&!item)item={id:command.id,visit,summary:command.summary,owner:null,state:'open',followUpRecorded:false};
       else if(command.action==='pickup'&&item?.state==='open'&&!item.owner)item={...item,owner:actor};
       else if(command.action==='follow-up'&&item?.owner===actor&&item.state==='open')item={...item,followUpRecorded:true};
       else if(command.action==='close'&&item?.owner===actor&&item.state==='open'&&item.followUpRecorded)item={...item,state:'closed'};
       else return null;
       items.set(item.id,item);
       const receipt={status:'recorded',id:item.id,operation:command.operation,visit,action:command.action};
       ops.set(command.operation,{command,receipt});return receipt;
     }});
 }};
 const open=(a,target)=>operationsIncidents(a,req(a,'GET',target),null,port);
 const post=(a,body)=>operationsIncidents(a,req(a,'POST'),body,port);
 const base={id:id(9),visit,revision:4,membershipRevision:8};
 const first={...base,operation:id(10),action:'file',summary:'Fictional submitted incident'};
 assert.equal((await open(staff)).mayFile,true);
 const receipt=await post(staff,first);assert.deepEqual(await post(staff,first),receipt);
 await post(staff,{...first,id:id(20),operation:id(21),summary:'Separate fictional incident'});
 assert.equal((await open(staff)).items.length,0);
 assert.equal((await open(manager)).items.length,2);
 assert.equal((await open(manager)).items[0].summary,first.summary);
 await assert.rejects(open(manager,other),{status:403});
 await post(manager,{...base,operation:id(11),action:'pickup'});
 assert.equal((await open(peer)).items[0].owner,manager.principal.id);
 await assert.rejects(post(manager,{...base,operation:id(12),action:'close'}),{status:503});
 await assert.rejects(post(staff,{...base,operation:id(13),action:'follow-up',note:'Not permitted'}),{status:503});
 await post(manager,{...base,operation:id(14),action:'follow-up',note:'Fictional follow-up'});
 await post(manager,{...base,operation:id(15),action:'close'});
 assert.deepEqual((await open(peer)).items.map(r=>[r.state,r.followUpRecorded]),[['closed',true],['open',false]]);
});
test('host disablement and stale current access stay fail-closed',async()=>{
 await assert.rejects(operationsIncidents(manager,req(manager),null,undefined),{status:404});
 const port={withVisitTransaction:(a,v,work)=>work({current:{actor:a.principal.id,role:'manager',visit:v,revision:4,
   membershipRevision:9},list:()=>assert.fail('stale membership read')})};
 await assert.rejects(operationsIncidents(manager,req(manager),null,port),{status:403});
});
