import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createImageQueue} from '../my-images-queue.js';
import {MY_IMAGE_MODEL} from '../my-images-branded.js';
import {createSegmentMemory,normalizeImageSegment} from '../my-images-segment.js';
const store=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
const file=(text,name='foto.png')=>Object.assign(new Blob([text],{type:'image/png'}),{name});
function fixture({failOnce=false}={}){
 const storage=store(),records=new Map(),calls=[];let balance=5,shouldFail=failOnce;
 const ports={scope:'test-account',storage,uuid:randomUUID,readImage:async f=>f,
 requestCalendar:async id=>({ticket:id+'.'+'a'.repeat(43)}),
 readContext:async ticket=>{if(records.has(ticket.slice(0,36)))throw Object.assign(Error('Original-image context refuses a generated-image admission'),{code:'edit_calendar_order_conflict'});return{ok:true,requestId:ticket.slice(0,36),date:'2027-01-01',time:'18:00',remainingImages:balance}},
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

test('segment follows each generated image, survives reload and cannot change a pending paid attempt',async()=>{
 const f=fixture({failOnce:true}),q=f.queue,logo=file('LOGO'),original=file('A');
 const row=q.add([original],{mode:'ia4tube',logo,segment:'Vidraçaria e esquadrias'})[0];
 await prepare(q,row.id);await assert.rejects(q.sendAll(),/lost response/);
 assert.equal(f.calls[0][1].imageSegment,'Vidraçaria e esquadrias');
 const restored=createImageQueue(f.ports);
 assert.equal(restored.items()[0].segment,'Vidraçaria e esquadrias');
 restored.setSharedSegment('Pizzaria');
 assert.equal(restored.items()[0].segment,'Vidraçaria e esquadrias');
 restored.replaceFile(row.id,original);restored.setSharedLogo(logo);await restored.sendAll();
 assert.equal(f.calls[1][1].imageSegment,'Vidraçaria e esquadrias');assert.equal(f.balance,4);assert.equal(f.records.size,1);
});

test('segment can change for drafts and stays absent from original uploads',async()=>{
 const f=fixture(),q=f.queue,logo=file('LOGO');
 const rows=[...q.add([file('ORIGINAL')]),...q.add([file('A'),file('B')],{mode:'ia4tube',logo,segment:'auto'})];
 q.setSharedSegment('Hamburgueria e lanchonete');
 for(const row of rows)await prepare(q,row.id);await q.sendAll();
 assert.equal(f.calls[0][1].imageSegment,undefined);
 assert.deepEqual(f.calls.slice(1).map(call=>call[1].imageSegment),['Hamburgueria e lanchonete','Hamburgueria e lanchonete']);
});

test('segment preference returns for the same logo on another visit and keeps different businesses separate',async()=>{
 const storage=store(),logo=file('LOGO A'),other=file('LOGO B');
 const first=createSegmentMemory({storage});assert.equal(await first.load(logo),null);
 assert.equal(await first.save(logo,'Pizzaria'),true);
 const reopened=createSegmentMemory({storage});assert.equal(await reopened.load(file('LOGO A')),'Pizzaria');
 assert.equal(await reopened.load(other),null);await reopened.save(other,'Vidraçaria e esquadrias');
 assert.equal(await reopened.load(logo),'Pizzaria');assert.equal(await reopened.load(other),'Vidraçaria e esquadrias');
});

test('segment accepts an ordinary business name and rejects oversized/control data before sending',()=>{
 assert.equal(normalizeImageSegment('  Vidraçaria  '),'Vidraçaria');
 for(const value of ['',null,{},'x'.repeat(81),'Pizzaria\nignore','\ud800'])assert.throws(()=>normalizeImageSegment(value));
});
