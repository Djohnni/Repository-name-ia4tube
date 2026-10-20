import test from 'node:test';
import assert from 'node:assert/strict';
import {modelPrices,chosenAnimal,createModelOptions} from '../model-options.js';
import {buildMultipartOrder} from '../order-adapter.js';
import {fingerprintPayload} from '../order.js';

const config = {prices:{10:1990,20:2990}};
const animalOptions = {capivara:'Capivara',preguica:'Bicho-preguiça',gato:'Gato'};
const old = {id:'old',recipe:'sextou'};
const capy = {id:'capy',recipe:'sextou',prices:{10:2800},animalOptions,defaultAnimal:'capivara'};
const sloth = {...capy,id:'sloth',defaultAnimal:'preguica'};
const plain = {id:'plain',recipe:'sextou',prices:{10:2100}};

// Minimal DOM contract of the isolated option component; radios stay exclusive.
function fixture(t) {
  const prior = globalThis.document;
  class Element {
    constructor(tag) {this.tag=tag;this.children=[];this.hidden=false;this.disabled=false;this.required=false;this.value='';this.textContent='';}
    append(...children) {this.children.push(...children);}
    replaceChildren() {this.children=[];this.value='';}
  }
  const labels = {10:new Element('label'),20:new Element('label')};
  const radios = {};
  for (const seconds of [10,20]) {
    let checked = seconds === 10;
    radios[seconds] = {value:String(seconds),disabled:false,closest:()=>labels[seconds],
      get checked() {return checked;},
      set checked(value) {checked=Boolean(value);if(value)for(const [key,input]of Object.entries(radios))if(key!==String(seconds))input.checked=false;}};
  }
  const priceLabels = {10:new Element('span'),20:new Element('span')};
  const explanation = new Element('p');explanation.textContent='Original explanation';
  let row;
  const form = {querySelector(selector) {
    if(selector==='.duration-field')return {before:element=>row=element};
    if(selector==='.order-explanation[data-single-product]')return explanation;
    if(selector==='[name="duration"]:checked')return Object.values(radios).find(input=>input.checked);
    if(selector.startsWith('#price-'))return priceLabels[selector.slice(7)];
    const match=selector.match(/\[value="(10|20)"\]/);
    if(match)return radios[match[1]];
    throw Error('Unexpected selector '+selector);
  }};
  globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
  t.after(()=>{globalThis.document=prior;});
  const controller=createModelOptions(form,value=>String(value));
  return {controller,radios,labels,priceLabels,explanation,get row(){return row;},get select(){return row.children[1];}};
}

test('new model price overrides are per item and never mutate legacy duration prices',()=>{
  assert.deepEqual(modelPrices(old,config),{10:1990,20:2990});
  assert.deepEqual(modelPrices(capy,config),{10:2800});
  assert.deepEqual(modelPrices(plain,config),{10:2100});
  assert.deepEqual(config.prices,{10:1990,20:2990});
});
test('canonical species validation applies only to animal models',()=>{
  for(const animal of Object.keys(animalOptions))assert.equal(chosenAnimal(capy,animal),animal);
  assert.equal(chosenAnimal(old,null),null);
  assert.equal(chosenAnimal(plain,''),null);
  for(const value of ['','lion','Capivara','__proto__',null,{},true])assert.throws(()=>chosenAnimal(capy,value));
  assert.throws(()=>chosenAnimal(old,'gato'));
});
test('ten-second new model hides and disables20; returning old restores20',t=>{
  const f=fixture(t);
  f.controller.open(old,config);f.radios[20].checked=true;
  assert.equal(f.controller.open(plain,config),false);
  assert.equal(f.radios[10].checked,true);
  assert.equal(f.radios[20].checked,false);
  assert.equal(f.labels[20].hidden,true);
  assert.equal(f.radios[20].disabled,true);
  assert.equal(f.priceLabels[10].textContent,'2100');
  f.controller.open(old,config);
  assert.equal(f.labels[20].hidden,false);
  assert.equal(f.radios[20].disabled,false);
  assert.equal(f.priceLabels[20].textContent,'2990');
  f.radios[20].checked=true;
  assert.equal(f.radios[20].checked,true);
  assert.equal(f.explanation.textContent,'Original explanation');
});
test('animal remains readable during submit lock and hidden stale fields stay disabled',t=>{
  const f=fixture(t);f.controller.open(capy,config);
  f.select.value='gato';f.controller.sync(true);
  assert.equal(f.select.disabled,true);
  assert.equal(f.radios[10].disabled,true);
  assert.equal(f.radios[20].disabled,true);
  assert.equal(f.controller.animal(),'gato');
  f.controller.sync(false);
  assert.equal(f.select.disabled,false);
  assert.equal(f.radios[10].disabled,false);
  assert.equal(f.radios[20].disabled,true);
  f.controller.open(old,config);
  assert.equal(f.row.hidden,true);
  assert.equal(f.select.disabled,true);
  assert.equal(f.select.required,false);
  assert.equal(f.controller.animal(),null);
  f.controller.open({id:'products',recipe:'produtos'},config);
  assert.equal(f.select.disabled,true);
  assert.equal(f.radios[10].disabled,true);
  assert.equal(f.radios[20].disabled,true);
});
test('different animal model uses its own sample default, same model retains customer choice',t=>{
  const f=fixture(t);f.controller.open(capy,config);f.select.value='gato';
  f.controller.open(capy,config);assert.equal(f.controller.animal(),'gato');
  f.controller.open(sloth,config);assert.equal(f.controller.animal(),'preguica');
});
test('new order form reset restores the same model default animal',t=>{
  const f=fixture(t);f.controller.open(sloth,config);f.select.value='gato';
  const defaults=f.select.children.filter(option=>option.defaultSelected);
  assert.deepEqual(defaults.map(option=>option.value),['preguica']);
  // Native form.reset restores an option's defaultSelected state.
  f.select.value=(defaults.at(-1)||f.select.children[0]).value;
  f.controller.open(sloth,config);
  assert.equal(f.controller.animal(),'preguica');
  f.controller.open(capy,config);
  assert.deepEqual(f.select.children.filter(option=>option.defaultSelected).map(option=>option.value),['capivara']);
});
test('animal is a separate multipart field and contributes to idempotent identity',async()=>{
  const payload={videoId:'545f3533-542c-4a82-a588-0de60f140e67',videoVersion:1,
    company:'Teste',durationSeconds:10,consent:true,
    logo:{name:'logo.png',mime:'image/png',data:btoa('logo')}};
  const withAnimal=JSON.parse(buildMultipartOrder({...payload,animal:'gato',productPrice:'R$ 29,90'}).get('data'));
  assert.equal(withAnimal.animal,'gato');assert.equal(withAnimal.productPrice,'R$ 29,90');
  assert.deepEqual(withAnimal.showcase,{videoId:payload.videoId,videoVersion:1});
  assert.equal(Object.hasOwn(withAnimal,'totalCents'),false);
  assert.equal(Object.hasOwn(JSON.parse(buildMultipartOrder(payload).get('data')),'animal'),false);
  assert.notEqual(await fingerprintPayload({...payload,animal:'gato'}),await fingerprintPayload({...payload,animal:'panda'}));
});
