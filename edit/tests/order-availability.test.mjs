import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {releaseInfo,RELEASE_AT,SCHEDULED_IDS,PRODUCT_PACKAGE_ID} from '../availability.js';
import {buildMultipartOrder,idempotencyKey,normalizeReceipt,safeWhatsAppUrl,SUBMIT_ENDPOINT} from '../order-adapter.js';
import {normalizeProductPrice} from '../optional-price.js';
import {normalizeProductDescription} from '../product-description.js';
import {modelMainPhrase,normalizeCustomPhrase} from '../custom-phrase.js';
import {requestAppCalendar,appCalendarAttemptScope} from '../app-calendar.js';
import {createExtraPostOptions} from '../ready-posts-extra.js';

const source=(await readFile(new URL('../order.js',import.meta.url),'utf8')).replace(/^import[^\n]*\n/gm,'').replace(/^export /gm,'');
const opens=Date.parse(RELEASE_AT);
const selected={id:SCHEDULED_IDS[0],version:1,recipe:'sextou',orderEnabled:true};
const config={prices:{10:2400,20:2990}};
const savedId='d7f5c088-ece8-4e54-90c3-05ca6f9730e5';
const storage=()=>{
  const values=new Map();
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};
};

// Evaluate the actual order controller with a deterministic clock and inert UI.
// The multipart, receipt, price, fingerprint and idempotency code are not stubbed.
function fixture(initial=opens-1) {
  let now=initial,reads=0,resetCount=0,productsEnabled=false;
  const nodes=new Map(),toasts=[],requests=[],navigation=[];
  const node=selector=>{
    if(!nodes.has(selector))nodes.set(selector,{value:'',hidden:false,disabled:false,checked:false,innerHTML:'',textContent:'',listeners:new Map(),
      setAttribute(){},removeAttribute(name){delete this[name];},scrollIntoView(){},focus(){},select(){},
      addEventListener(type,handler){this.listeners.set(type,handler);}});
    return nodes.get(selector);
  };
  const form=node('#order-form');form.elements=[];form.reportValidity=()=>true;
  form.querySelector=selector=>{assert.equal(selector,'[name="duration"]:checked');return {value:'10'};};
  form.reset=()=>{resetCount++;};
  node('#send-order').innerHTML='Salvar pedido';
  const dialog={querySelector:()=>node('.close-dialog'),addEventListener(){},close(){}};
  const local=storage(),session=storage(),location={hash:'#hoje',assign:url=>navigation.push(url)};
  const clock=class extends Date {static now(){return now;}};
  const context={Date:clock,TextEncoder,crypto,AbortController,setTimeout,clearTimeout,
    document:{querySelector:node},navigator:{clipboard:{writeText:async()=>{}}},localStorage:local,sessionStorage:session,
    location,history:{replaceState(_state,_title,url){location.hash=url;}},
    requestAppCalendar,appCalendarAttemptScope,createExtraPostOptions,
    releaseInfo:item=>releaseInfo(item,now),buildMultipartOrder,idempotencyKey,normalizeReceipt,safeWhatsAppUrl,SUBMIT_ENDPOINT,normalizeProductPrice,normalizeProductDescription,modelMainPhrase,normalizeCustomPhrase,
    createUploadField:input=>({reset(){},async read(){reads++;return input===node('#order-logo')?{name:'logo.png',mime:'image/png',data:btoa('logo')}:null;}}),
    createProductsForm:()=>({resetUploads(){},sync(){},open(value){productsEnabled=value;},isEnabled:()=>productsEnabled,
      async payload(){return {photos:[1,2].map(index=>({name:'produto-'+index+'.png',mime:'image/png',data:btoa('photo-'+index)})),
        productsVideo:{packageCount:2,branch:'HAMBURGUERIA',openingText:'CONFIRA NOSSAS OFERTAS!',openingSeconds:6,
          whatsapp:'',instagram:'',location:'',items:[1,2].map(index=>({name:'Produto '+index,price:'',seconds:4,speechOverrideEnabled:false,speechText:''}))}};}}),
    createModelOptions:()=>({sync(){},open:()=>false,animal:()=>null}),
    createReadyPostOptions:()=>({sync(){},open:()=>false,isEnabled:()=>false}),
    fetch:async(url,options)=>{
      requests.push({url,options});
      const message='Pedido: '+savedId;
      const totalCents=JSON.parse(options.body.get('data')).campaignId==='produtos-cardapio-v1'?3800:2400;
      return {ok:true,json:async()=>({orderId:savedId,status:'awaiting_authorization',totalCents,
        whatsappMessage:message,whatsappUrl:'https://wa.me/554791049079?text='+encodeURIComponent(message)})};
    },
  };
  runInNewContext(source,context,{timeout:1000});
  const controller=context.createOrderController({dialog,money:String,toast:message=>toasts.push(message),onBusy(){}});
  const fill=()=>{node('#order-company').value='Cliente';node('#order-consent').checked=true;};
  return {controller,node,form,local,session,location,toasts,requests,navigation,fill,
    get reads(){return reads;},get resets(){return resetCount;},setNow:value=>{now=value;},
    submit:()=>form.listeners.get('submit')({preventDefault(){}}),
  };
}

test('scheduled open rejects without resetting existing inputs, receipts or attempts',()=>{
  const f=fixture();
  f.session.setItem('unrelated-receipt','preserve');f.local.setItem('unrelated-attempt','preserve');
  f.node('#order-company').value='Já preenchido';
  assert.equal(f.controller.open(selected,config),false);
  assert.deepEqual(f.toasts,['Desbloqueia amanhã']);assert.equal(f.resets,0);
  assert.equal(f.node('#order-company').value,'Já preenchido');
  assert.equal(f.session.getItem('unrelated-receipt'),'preserve');assert.equal(f.local.getItem('unrelated-attempt'),'preserve');
  assert.equal(f.requests.length,0);assert.equal(f.reads,0);
});

test('released package opens and submits the unchanged two-product request before or after midnight',async()=>{
  const item={id:PRODUCT_PACKAGE_ID,version:1,recipe:'produtos',orderEnabled:true};
  for(const now of [opens-1,opens,opens+86400000]) {
    const f=fixture(now);
    assert.equal(f.controller.open(item,config),true);assert.equal(f.form.hidden,false);
    assert.deepEqual(f.toasts,[]);f.fill();await f.submit();
    assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,SUBMIT_ENDPOINT);
    const body=f.requests[0].options.body,data=JSON.parse(body.get('data'));
    assert.deepEqual(data.showcase,{videoId:PRODUCT_PACKAGE_ID,videoVersion:1});
    assert.equal(data.campaignId,'produtos-cardapio-v1');assert.equal(data.productsVideo.packageCount,2);
    assert.deepEqual(data.productsVideo.items.map(row=>row.name),['Produto 1','Produto 2']);
    assert.equal(body.getAll('logo').length,1);assert.equal(body.getAll('photos').length,2);
    assert.equal(f.node('#order-success').hidden,false);assert.equal(f.navigation.length,1);
    assert.equal(JSON.parse(f.session.getItem('ia4tube.edit.receipt.v1')).totalCents,3800);
    for(const key of ['opensAt','releaseAt','releaseLabel','isLocked'])assert.equal(Object.hasOwn(data,key),false);
  }
});

test('submit rechecks a formerly opened model and blocks before uploads, identity or network',async()=>{
  const f=fixture(opens);assert.equal(f.controller.open(selected,config),true);f.fill();f.setNow(opens-1);
  await f.submit();
  assert.equal(f.requests.length,0);assert.equal(f.reads,0);assert.equal(f.local.values.size,0);
  assert.equal(f.node('#order-error').textContent,'Desbloqueia amanhã');
  assert.equal(f.controller.isBusy(),false);
});

test('the same controller opens at midnight and submits one unchanged request without a reload',async()=>{
  const f=fixture();assert.equal(f.controller.open(selected,config),false);
  f.setNow(opens);assert.equal(f.controller.open(selected,config),true);f.fill();await f.submit();
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,SUBMIT_ENDPOINT);
  const payload=JSON.parse(f.requests[0].options.body.get('data'));
  assert.deepEqual(payload.showcase,{videoId:selected.id,videoVersion:1});
  for(const key of ['opensAt','releaseAt','releaseLabel','isLocked'])assert.equal(Object.hasOwn(payload,key),false);
  assert.equal(f.node('#order-success').hidden,false);assert.equal(f.navigation.length,1);
});

for(const videoId of [SCHEDULED_IDS[0],PRODUCT_PACKAGE_ID]) test('saved confirmation remains restorable and cannot submit again: '+videoId,async()=>{
  const f=fixture();
  const message='Pedido: '+savedId;
  const saved={orderId:savedId,status:'awaiting_authorization',totalCents:2400,videoId,
    message,whatsappUrl:'https://wa.me/554791049079?text='+encodeURIComponent(message),savedAt:opens-1000};
  f.session.setItem('ia4tube.edit.receipt.v1',JSON.stringify(saved));f.location.hash='#pedido-salvo';
  assert.equal(f.controller.restore(),true);assert.equal(f.node('#order-success').hidden,false);
  assert.equal(f.node('#whatsapp-link').hidden,false);assert.match(f.node('#saved-order-id').textContent,new RegExp(savedId));
  await f.submit();assert.equal(f.requests.length,0);assert.equal(f.reads,0);
  assert.equal(f.session.getItem('ia4tube.edit.receipt.v1'),JSON.stringify(saved));
});
