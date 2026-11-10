import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createImageQueue} from '../edit/my-images-queue.js';
import {MY_VIDEO_MODEL,postBrandedImage} from '../edit/my-images-branded.js';
const file=text=>Object.assign(new Blob([text],{type:'image/png'}),{name:text+'.png'});
const store=()=>{const m=new Map();return{getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}};
function fixture({loseOnce=false,images=0,videos=3}={}){
 const storage=store(),calls=[],admissions=new Map();let lost=false;
 const ports={scope:'synthetic-video-owner',storage,uuid:randomUUID,readImage:async f=>f,
  requestCalendar:async(id,options)=>{calls.push(['calendar',options]);return {ticket:id+'.'+'a'.repeat(43)}},
  readContext:async(ticket,kind)=>({ok:true,requestId:ticket.slice(0,36),date:'2027-01-10',time:'18:21',...(kind==='video'?{remainingVideos:videos}:{remainingImages:images})}),
  submitBrandedImage:async input=>{calls.push(['post',input]);if(!admissions.has(input.requestId)){admissions.set(input.requestId,input);if(input.outputKind==='video')videos--;else images--;}
   if(loseOnce&&!lost){lost=true;throw Error('lost response')};return{ok:true,requestId:input.requestId,status:'queued',planningId:'p',pedidoId:'o'}}};
 return{ports,queue:createImageQueue(ports),calls,admissions,balance:()=>({images,videos})};
}
test('a branded photo becomes a video order with a video schedule even with zero image quota',async()=>{
 const f=fixture(),q=f.queue,[row]=q.add([file('photo')],{mode:'ia4tube',logo:file('logo')});
 q.setOutputKind(row.id,'video');q.setCaption(row.id,'Minha legenda');await q.schedule(row.id);await q.sendAll();
 assert.deepEqual(f.calls[0],['calendar',{mediaKind:'video'}]);assert.equal(f.calls[1][1].outputKind,'video');
 assert.deepEqual(f.balance(),{images:0,videos:2});assert.equal(q.items()[0].status,'saved');
 await q.sendAll();assert.equal(f.admissions.size,1);assert.equal(q.remaining('video'),2);
});
test('changing format clears an unreserved schedule; original and confirmed uploads cannot change type',async()=>{
 const f=fixture({images:3}),q=f.queue,[row]=q.add([file('photo')],{mode:'ia4tube',logo:file('logo')});
 q.setCaption(row.id,'Legenda');await q.schedule(row.id);const old=q.items()[0].requestId;
 q.setOutputKind(row.id,'video');assert.equal(q.items()[0].date,null);assert.equal(q.items()[0].requestId,null);
 await q.schedule(row.id);assert.notEqual(q.items()[0].requestId,old);await q.sendAll();assert.throws(()=>q.setOutputKind(row.id,'image'));
 const [original]=q.add([file('original')]);assert.throws(()=>q.setOutputKind(original.id,'video'));
});
test('lost video receipts survive reload without a second debit or changing into an image',async()=>{
 const f=fixture({loseOnce:true}),q=f.queue,photo=file('photo'),logo=file('logo'),[row]=q.add([photo],{mode:'ia4tube',logo});
 q.setOutputKind(row.id,'video');q.setCaption(row.id,'Legenda');await q.schedule(row.id);
 await assert.rejects(q.sendAll(),/lost response/);assert.throws(()=>q.setOutputKind(row.id,'image'));
 const restored=createImageQueue(f.ports);assert.equal(restored.items()[0].outputKind,'video');
 restored.replaceFile(row.id,photo);restored.setSharedLogo(logo);await restored.sendAll();
 assert.equal(f.admissions.size,1);assert.equal(f.balance().videos,2);assert.equal(f.calls.filter(([kind])=>kind==='post').length,2);
});
test('a mixed batch spends one image and one video and refuses excess video units before POST',async()=>{
 const f=fixture({images:1,videos:1}),q=f.queue,rows=q.add([file('one'),file('two')],{mode:'ia4tube',logo:file('logo')});
 q.setOutputKind(rows[1].id,'video');for(const row of rows){q.setCaption(row.id,'Legenda');await q.schedule(row.id)}
 await q.sendAll();assert.deepEqual(f.balance(),{images:0,videos:0});
 const bad=fixture({videos:1}),batch=bad.queue.add([file('a'),file('b')],{mode:'ia4tube',logo:file('logo')});
 for(const row of batch){bad.queue.setOutputKind(row.id,'video');bad.queue.setCaption(row.id,'Legenda');await bad.queue.schedule(row.id)}
 await assert.rejects(bad.queue.sendAll(),{code:'billing_required'});assert.equal(bad.admissions.size,0);
});
test('video HTTP payload uses the dedicated canonical recipe and native ten-second selection',async t=>{
 const id=randomUUID(),ticket=id+'.'+'a'.repeat(43);let seen;
 const prior=globalThis.fetch;t.after(()=>globalThis.fetch=prior);
 globalThis.fetch=async(url,request)=>{seen=JSON.parse(request.body.get('data'));return new Response(JSON.stringify({error:'fixture stop'}),{status:503})};
 await assert.rejects(postBrandedImage({image:file('photo'),logo:file('logo'),caption:'Legenda',requestId:id,ticket,outputKind:'video'}),/fixture stop/);
 assert.equal(seen.mediaKind,'video');assert.equal(seen.selections[0].format,'video');assert.equal(seen.showcase.videoId,MY_VIDEO_MODEL);assert.equal(seen.sextou.durationSeconds,10);
});
