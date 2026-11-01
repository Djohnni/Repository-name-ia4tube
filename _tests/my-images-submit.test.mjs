import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../edit/my-images-submit.js',import.meta.url),'utf8');
const {createImageSubmission,imageSubmissionFingerprint,postReadyImage,READY_IMAGE_ENDPOINT}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const ID='b774fc09-60f9-4d55-9a9e-6063d056da9d',NEXT='84886f57-f7a1-437e-b30f-02a76453cf91';
const ticket=ID+'.'+'A'.repeat(43),image=new Blob(['fixture image bytes'],{type:'image/png'});
const receipt=id=>({ok:true,requestId:id,planningId:'pm_edit_'+id.replaceAll('-',''),pedidoId:'edit_'+id.replaceAll('-',''),status:'ready'});
function setup(options={}) {
  const values=new Map(),storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
  const calls=[],requests=[];
  const ports={scope:'owner-nonce',storage,uuid:()=>ID,requestCalendar:async id=>{requests.push(id);return {ticket:id+'.'+'A'.repeat(43)};},
    post:async value=>{calls.push(value);return receipt(value.requestId);},...options};
  return {submission:createImageSubmission(ports),ports,storage,values,calls,requests};
}
test('ready image uses native ticket, caption and one image, clears pending after matching receipt',async()=>{
  const s=setup();assert.equal(s.submission.hasPending(),false);
  const result=await s.submission.send({image,caption:'  Minha legenda\ncom duas linhas.  '});
  assert.equal(result.status,'ready');assert.equal(s.calls.length,1);assert.equal(s.calls[0].caption,'Minha legenda\ncom duas linhas.');
  assert.equal(s.calls[0].ticket,ticket);assert.equal(s.calls[0].image,image);assert.equal(s.submission.hasPending(),false);
});
test('lost response keeps same ID/ticket/digest across reload and retry',async()=>{
  const s=setup({post:async()=>{throw new TypeError('network_lost');}});
  await assert.rejects(s.submission.send({image,caption:'Legenda'}));assert(s.submission.hasPending());
  const restored=createImageSubmission({...s.ports,uuid:()=>NEXT,post:async value=>{assert.equal(value.requestId,ID);return receipt(ID);}});
  assert.equal((await restored.send({image,caption:'Legenda'})).requestId,ID);assert.equal(restored.hasPending(),false);
});
test('different caption or image cannot replace uncertain attempt',async()=>{
  const s=setup({post:async()=>{throw new Error('uncertain');}});
  await assert.rejects(s.submission.send({image,caption:'Primeira'}));
  await assert.rejects(s.submission.send({image,caption:'Outra'}),/mesma imagem/);
  await assert.rejects(s.submission.send({image:new Blob(['other'],{type:'image/png'}),caption:'Primeira'}),/mesma imagem/);
  assert.equal(s.requests.length,1);
});
test('double click has at most one in-flight POST',async()=>{
  let finish;const posted=new Promise(resolve=>finish=resolve);let count=0;
  const s=setup({post:async()=>{count++;return posted;}});
  const first=s.submission.send({image,caption:'Legenda'});
  await assert.rejects(s.submission.send({image,caption:'Legenda'}),/Aguarde/);
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(count,1);finish(receipt(ID));await first;
});
test('empty caption, unsupported file and oversized image never request calendar or POST',async()=>{
  const s=setup();
  for(const input of [{image,caption:''},{image:new Blob(['x'],{type:'image/svg+xml'}),caption:'a'},
    {image:new Blob([new Uint8Array(10*1024*1024+1)],{type:'image/png'}),caption:'a'}])await assert.rejects(s.submission.send(input));
  assert.equal(s.requests.length,0);assert.equal(s.calls.length,0);
});
test('missing app scope never sends',async()=>{
  const s=setup({scope:null});await assert.rejects(s.submission.send({image,caption:'a'}),/app/);assert.equal(s.calls.length,0);
});
test('storage failure before POST prevents any upload',async()=>{
  let calls=0;const s=setup({storage:{getItem:()=>null,setItem:()=>{throw new Error('full');}},post:()=>{calls++;}});
  await assert.rejects(s.submission.send({image,caption:'a'}),/full/);assert.equal(calls,0);
});
test('mismatched calendar ticket stops before POST',async()=>{
  const s=setup({requestCalendar:async()=>({ticket:NEXT+'.'+'B'.repeat(43)})});
  await assert.rejects(s.submission.send({image,caption:'a'}),/dia e a hora/);assert.equal(s.calls.length,0);
});
test('mismatched server receipt remains pending',async()=>{
  const s=setup({post:async()=>receipt(NEXT)});await assert.rejects(s.submission.send({image,caption:'a'}),/mesma imagem/);assert(s.submission.hasPending());
});
test('server proven pre-reservation validation error permits corrected input',async()=>{
  const s=setup({post:async()=>{throw Object.assign(new Error('invalid_photo'),{safeToEdit:true});}});
  await assert.rejects(s.submission.send({image,caption:'a'}));assert.equal(s.submission.hasPending(),false);
});
test('account nonce scopes pending IDs independently',async()=>{
  const s=setup({post:async()=>{throw new Error('lost');}});await assert.rejects(s.submission.send({image,caption:'a'}));
  const other=createImageSubmission({...s.ports,scope:'another-owner',uuid:()=>NEXT,post:async value=>receipt(value.requestId)});
  assert.equal(other.hasPending(),false);assert.equal((await other.send({image,caption:'other'})).requestId,NEXT);assert(s.submission.hasPending());
});
test('fingerprint checks bytes and caption, independent of filename',async()=>{
  assert.equal(await imageSubmissionFingerprint(image,'a'),await imageSubmissionFingerprint(image,'a'));
  assert.notEqual(await imageSubmissionFingerprint(image,'a'),await imageSubmissionFingerprint(image,'b'));
});
test('HTTP multipart carries only image,caption,requestId,ticket and scoped header; no date/owner/tokens',async()=>{
  const original=globalThis.fetch;let seen;
  globalThis.fetch=async(url,options)=>{seen={url,options};return {ok:true,json:async()=>receipt(ID)};};
  try {
    assert.equal((await postReadyImage({image,caption:'Legenda',requestId:ID,ticket})).status,'ready');
    assert.equal(seen.url,READY_IMAGE_ENDPOINT);assert.equal(seen.options.headers.Authorization,'EditTicket '+ticket);
    assert.deepEqual([...seen.options.body.keys()].sort(),['caption','image','requestId','ticket']);
    assert.equal(seen.options.credentials,'omit');assert.equal(seen.options.referrerPolicy,'no-referrer');
  }finally{globalThis.fetch=original;}
});
test('malformed pending storage fails closed',async()=>{
  const s=setup({storage:{getItem:()=>'{invalid',setItem:()=>{throw new Error('unexpected');}}});
  await assert.rejects(s.submission.send({image,caption:'a'}),/recuperar/);assert.equal(s.calls.length,0);
});
