import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const site=new URL('../edit/',import.meta.url);
const submitSource=await readFile(new URL('my-images-submit.js',site),'utf8');
const {createImageSubmission}=await import('data:text/javascript;base64,'+Buffer.from(submitSource).toString('base64'));
const controllerSource=await readFile(new URL('my-images.js',site),'utf8');
const ID='b774fc09-60f9-4d55-9a9e-6063d056da9d',NEXT='84886f57-f7a1-437e-b30f-02a76453cf91';
const receipt=id=>({ok:true,requestId:id,planningId:'pm_edit_'+id.replaceAll('-',''),pedidoId:'edit_'+id.replaceAll('-',''),status:'ready'});
const original=new Blob(['original fixture bytes'],{type:'image/png'}),wrong=new Blob(['different fixture bytes'],{type:'image/png'});
let moduleNumber=0;
class Element {
  listeners=new Map();hidden=false;disabled=false;readOnly=false;textContent='';value='';files=[];formNoValidate=false;
  addEventListener(type,listener){const values=this.listeners.get(type)||[];values.push(listener);this.listeners.set(type,values);}
  async emit(type){const event={type,prevented:false,preventDefault(){this.prevented=true;}};for(const f of this.listeners.get(type)||[])await f(event);return event;}
  removeAttribute(name){delete this[name];}
}
async function fixture({pending=false,available=true,post=async value=>receipt(value.requestId)}={}) {
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const calls={post:0,read:0,combos:0,refresh:0,saved:0},scope='fixture-owner-nonce';
  const requestCalendar=async id=>({ticket:id+'.'+'A'.repeat(43)});
  if(pending) {
    const seed=createImageSubmission({scope,storage,requestCalendar,uuid:()=>ID,post:async()=>{throw Error('lost_response');}});
    await assert.rejects(seed.send({image:original,caption:'Original caption'}));
  }
  const input=new Element(),caption=new Element(),send=new Element(),error=new Element(),preview=new Element(),success=new Element(),hint=new Element(),another=new Element(),close1=new Element(),close2=new Element(),receiptText=new Element();
  error.hidden=true;preview.hidden=true;success.hidden=true;
  const form=new Element();
  form.reportValidity=()=>Boolean(input.files[0]&&caption.value.trim());
  form.reset=()=>{input.files=[];caption.value='';};
  const elements=new Map([['form',form],['input[type=file]',input],['textarea',caption],['[data-my-images-send]',send],['[role=alert]',error],['[data-my-images-preview]',preview],['[data-my-images-success]',success],['[data-my-images-hint]',hint],['[data-my-images-another]',another],['[data-my-images-receipt]',receiptText]]);
  const dialog=new Element();dialog.open=false;dialog.querySelector=value=>elements.get(value);dialog.querySelectorAll=()=>[close1,close2];dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;return dialog.emit('close');};
  globalThis.window={sessionStorage:storage};
  globalThis.document={addEventListener(){},dispatchEvent(event){if(event.type==='ia4tube:my-image-saved')calls.saved++;return true;}};
  if(!globalThis.CustomEvent)globalThis.CustomEvent=class {constructor(type,value){this.type=type;this.detail=value?.detail;}};
  globalThis.__myImagesFixturePorts={
    requestAppCalendar:requestCalendar,appCalendarAttemptScope:()=>scope,appCreationAllowed:()=>available,
    refreshAppAvailability:()=>{calls.refresh++;},openAppCombos:()=>{calls.combos++;return true;},
    createUploadField:()=>({reset(){},async read(){calls.read++;const file=input.files[0];return file?{name:'fixture.png',mime:file.type,data:Buffer.from(await file.arrayBuffer()).toString('base64')}:null;}}),
    createImageSubmission:options=>createImageSubmission({...options,uuid:()=>NEXT,post:async value=>{calls.post++;return post(value);}}),
  };
  const source=controllerSource.replace(/^import .*;\r?\n/gm,'')+
    '\n// isolated controller fixture '+(++moduleNumber);
  const injected='const {requestAppCalendar,appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos,createUploadField,createImageSubmission}=globalThis.__myImagesFixturePorts;\n'+source;
  const {createMyImages}=await import('data:text/javascript;base64,'+Buffer.from(injected).toString('base64'));
  const controller=createMyImages({dialog});controller.open();
  return {controller,dialog,form,input,caption,send,error,success,hint,close1,calls,values,storage,
    async choose(image,text){input.files=[image];caption.value=text;await input.emit('change');},
    async clickSend(){if(send.disabled)return false;if(!send.formNoValidate&&!form.reportValidity())return false;await form.emit('submit');return true;},
  };
}

test('wrong recovery input remains editable and can be corrected without replacing the pending attempt',async()=>{
  const f=await fixture({pending:true});
  await f.choose(wrong,'Wrong caption');await f.clickSend();
  assert.equal(f.calls.post,0,'fingerprint mismatch must not POST');
  assert.equal(f.input.disabled,false,'the user must still be able to choose the original image');
  assert.equal(f.caption.readOnly,false,'the user must still be able to restore the original caption');
  assert.equal(f.values.size,1,'the original pending attempt must remain preserved');
  await f.choose(original,'Original caption');await f.clickSend();
  assert.equal(f.calls.post,1);assert.equal(f.success.hidden,false);assert.equal(f.values.size,0);assert.equal(f.calls.saved,1);
});

test('an uncertain matching POST locks its exact image/caption and retries that snapshot',async()=>{
  let attempts=0;
  const f=await fixture({post:async value=>{if(++attempts===1)throw Error('lost_response');return receipt(value.requestId);}});
  await f.choose(original,'Original caption');await f.clickSend();
  assert.equal(f.input.disabled,true);assert.equal(f.caption.readOnly,true);assert.equal(f.close1.disabled,false);
  const reads=f.calls.read;await f.clickSend();
  assert.equal(f.calls.post,2);assert.equal(f.calls.read,reads,'retry must reuse the locked snapshot');assert.equal(f.success.hidden,false);
});

test('the last image quota may be exhausted while a durable pending attempt still needs confirmation',async()=>{
  const f=await fixture({pending:true,available:false});
  await f.choose(original,'Original caption');await f.clickSend();
  assert.equal(f.calls.combos,0,'already reserved image confirmation must not demand another plan');
  assert.equal(f.calls.post,1);assert.equal(f.success.hidden,false);
});

test('the exhausted-quota CTA opens combos with empty required fields',async()=>{
  const f=await fixture({available:false});
  assert.equal(await f.clickSend(),true,'the combos CTA must bypass native upload-form validation');
  assert.equal(f.calls.combos,1);assert.equal(f.calls.post,0);assert.equal(f.calls.read,0);
});

test('busy submission blocks close and cancellation until its result is known',async()=>{
  let finish;const waiting=new Promise(resolve=>{finish=resolve;});
  const f=await fixture({post:()=>waiting});await f.choose(original,'Original caption');
  const sending=f.clickSend();
  for(let i=0;i<10&&f.calls.post===0;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.post,1);assert.equal(f.input.disabled,true);assert.equal(f.caption.readOnly,true);assert.equal(f.close1.disabled,true);
  assert.equal((await f.dialog.emit('cancel')).prevented,true);
  await f.close1.emit('click');assert.equal(f.dialog.open,true);
  finish(receipt(NEXT));await sending;
  assert.equal(f.success.hidden,false);assert.equal(f.close1.disabled,false);
});
