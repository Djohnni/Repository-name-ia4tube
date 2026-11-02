import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
const source=await readFile(new URL('../edit/order.js',import.meta.url),'utf8');
let sequence=0;
class Element {
  listeners=new Map();queries=new Map();value='';checked=false;hidden=false;disabled=false;innerHTML='Enviar';elements=[];
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  async emit(type){for(const fn of this.listeners.get(type)||[])await fn({preventDefault(){}});}
  querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Element());return this.queries.get(selector);}
  setAttribute(){}scrollIntoView(){}reset(){}reportValidity(){return true;}
}
function storage(){const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};}
async function fixture({selectedKind,cardKind='image'}) {
  const document=new Element(),form=document.querySelector('#order-form'),dialog=new Element(),calls=[];
  form.querySelector('[name="duration"]:checked').value='10';document.querySelector('#order-consent').checked=true;
  const noop=()=>{},empty=()=>null;
  const upload={reset:noop,read:async()=>({mime:'image/png',data:'c3ludGhldGlj'})};
  const products={isEnabled:()=>false,open:noop,sync:noop,resetUploads:noop};
  const ready={selected:()=>selectedKind,isEnabled:()=>Boolean(selectedKind),open:empty,sync:noop};
  globalThis.__orderCalendarFixture={
    requestAppCalendar:empty,appCalendarAttemptScope:empty,quotaCombosLabel:()=>'',
    createOrderRecovery:()=>({hasModel:()=>false}),buildMultipartOrder:noop,idempotencyKey:noop,
    normalizeReceipt:noop,calendarContextHash:noop,safeWhatsAppUrl:noop,SUBMIT_ENDPOINT:'https://invalid.example',
    createModelOptions:()=>({open:empty,sync:noop,animal:empty}),createReadyPostOptions:()=>ready,isReadyPost:()=>true,
    createExtraPostOptions:()=>({open:empty,sync:noop,isEnabled:()=>false,allowDescription:()=>false,allowPhoto:()=>false,
      previewPhrase:empty,read:empty,validateReference:noop,allowProductPrice:()=>false}),
    createProductsForm:()=>products,normalizeProductPrice:()=>'',normalizeProductDescription:()=>'',
    modelMainPhrase:()=> 'PRATO DO DIA',normalizeCustomPhrase:()=>'',createUploadField:()=>upload,releaseInfo:empty,
  };
  globalThis.document=document;globalThis.sessionStorage=storage();globalThis.localStorage=storage();
  globalThis.location={hash:''};globalThis.__orderFixtureCrypto=webcrypto;
  const names=Object.keys(globalThis.__orderCalendarFixture).join(',');
  const rewritten='const navigator={};const crypto=globalThis.__orderFixtureCrypto;const {'+names+'}=globalThis.__orderCalendarFixture;\n'+source.replace(/^import .*;\r?\n/gm,'')+'\n// fixture '+(++sequence);
  const {createOrderController}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
  const controller=createOrderController({dialog,money:String,toast:noop,onBusy:noop,
    requestCalendar:async(...args)=>{calls.push(args);throw Error('stop_before_order_or_API');},attemptScope:empty});
  assert.equal(controller.open({id:'synthetic-model',version:1,mediaKind:cardKind,recipe:'sextou',orderEnabled:true},{}),true);
  await form.emit('submit');
  return {calls,error:document.querySelector('#order-error').textContent};
}
test('an image catalog card selected as video asks the native calendar for Reels labels',async()=>{
  const f=await fixture({selectedKind:'video',cardKind:'image'});
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][1],{mediaKind:'video'});
  assert.match(f.error,/stop_before_order/);
});
test('a video catalog card selected as image asks the native calendar for Feed labels',async()=>{
  const f=await fixture({selectedKind:'image',cardKind:'video'});
  assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][1],{mediaKind:'image'});
});
test('catalog models without an output selector retain their own image/video type',async()=>{
  for(const cardKind of ['image','video']) {
    const f=await fixture({selectedKind:null,cardKind});
    assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0][1],{mediaKind:cardKind});
  }
});
