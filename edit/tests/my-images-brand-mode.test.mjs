import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createImageQueue} from '../my-images-queue.js';
import {MY_IMAGE_MODEL} from '../my-images-branded.js';
const store=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const file=(text,name='foto.png')=>Object.assign(new Blob([text],{type:'image/png'}),{name});
function fixture({failOnce=false}={}){
 const storage=store(),records=new Map(),calls=[];let balance=5,shouldFail=failOnce;
 const ports={scope:'test-account',storage,uuid:randomUUID,readImage:async f=>f,
 requestCalendar:async id=>({ticket:id+'.'+'a'.repeat(43)}),
 readContext:async ticket=>({ok:true,requestId:ticket.slice(0,36),date:'2027-01-01',time:'18:00',remainingImages:balance}),
 submitImage:async input=>{calls.push(['original',input]);balance--;return{ok:true,requestId:input.requestId,status:'ready',planningId:'p',pedidoId:'o'}},
 submitBrandedImage:async input=>{calls.push(['ia4tube',input]);if(!records.has(input.requestId)){records.set(input.requestId,input);balance--;}if(shouldFail){shouldFail=false;throw Error('lost response');}return{ok:true,requestId:input.requestId,status:'queued',planningId:'p',pedidoId:'o'}}};
 return{ports,queue:createImageQueue(ports),calls,records,get balance(){return balance}};
}
async function prepare(q,id,text='Legenda'){q.setCaption(id,text);await q.schedule(id)}
test('original upload stays on the old path; two generated images share one selected logo and own schedules',async()=>{
 const f=fixture(),q=f.queue,logo=file('LOGO','logo.png');
 const orig=q.add([file('ORIGINAL')])[0];const branded=q.add([file('A'),file('B')],{mode:'ia4tube',logo});
 for(const row of [orig,...branded])await prepare(q,row.id,'Legenda '+row.id);
 await q.sendAll();assert.deepEqual(f.calls.map(x=>x[0]),['original','ia4tube','ia4tube']);
 assert.equal(f.calls[1][1].logo,logo);assert.equal(f.calls[2][1].logo,logo);
 assert.equal(new Set(f.calls.map(x=>x[1].requestId)).size,3);assert.equal(f.balance,2);
 await q.sendAll();assert.equal(f.calls.length,3);assert.ok(q.items().every(x=>x.status==='saved'));
});
test('logo required only for IA mode; a whole batch is validated before first debit',async()=>{
 const f=fixture(),q=f.queue;const row=q.add([file('A')],{mode:'ia4tube'})[0];await prepare(q,row.id);
 await assert.rejects(q.sendAll(),e=>e.code==='ready_image_logo_required');assert.equal(f.calls.length,0);
 q.setSharedLogo(file('LOGO'));await q.sendAll();assert.equal(f.balance,4);
});
test('lost confirmation retains one attempt; reload and restore cannot replace its logo or double debit',async()=>{
 const f=fixture({failOnce:true}),q=f.queue,original=file('A'),logo=file('LOGO');
 const row=q.add([original],{mode:'ia4tube',logo})[0];await prepare(q,row.id);await assert.rejects(q.sendAll(),/lost response/);
 assert.equal(q.items()[0].status,'pending');const id=f.calls[0][1].requestId;
 assert.throws(()=>q.setCaption(row.id,'Mudou'));
 const restored=createImageQueue(f.ports);assert.equal(restored.items()[0].needsLogo,true);
 restored.replaceFile(row.id,original);restored.setSharedLogo(file('OUTRA LOGO'));
 await assert.rejects(restored.sendAll(),e=>e.code==='ready_image_pending_mismatch');assert.equal(f.calls.length,1);
 restored.setSharedLogo(logo);await restored.sendAll();assert.equal(f.calls[1][1].requestId,id);assert.equal(f.balance,4);assert.equal(f.records.size,1);
});
test('internal recipe is not inserted among the public catalog models',async()=>{
 const {readFile}=await import('node:fs/promises');const text=await readFile(new URL('../catalog.json',import.meta.url),'utf8');assert.ok(!text.includes(MY_IMAGE_MODEL));
});
