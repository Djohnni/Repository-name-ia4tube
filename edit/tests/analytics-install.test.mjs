import test from 'node:test';
import assert from 'node:assert/strict';
import {installAnalytics,MEASUREMENT_ID} from '../analytics.js';
import {CONSENT_KEY,saveConsent} from '../analytics-core.js';

// Deliberately minimal DOM: any attempt to query or read an order field fails.
class Element {
  constructor(tag='div') {this.tag=tag;this.children=[];this.listeners=new Map();this.attributes=new Map();this.dataset={};this.hidden=false;this.focused=false;}
  append(...children) {this.children.push(...children);}
  setAttribute(name,value) {this.attributes.set(name,value);}
  set innerHTML(value) {
    this.html=value;
    if(value.includes('data-choice='))this.children=['denied','granted'].map(choice=>{
      const button=new Element('button');button.dataset.choice=choice;return button;
    });
  }
  get innerHTML() {return this.html??'';}
  addEventListener(type,handler) {if(!this.listeners.has(type))this.listeners.set(type,[]);this.listeners.get(type).push(handler);}
  emit(type,detail={}) {for(const handler of this.listeners.get(type)??[])handler(detail);}
  querySelectorAll(selector) {
    assert.equal(selector,'[data-choice]');return this.children.filter(child=>child.dataset.choice);
  }
  querySelector(selector) {assert.equal(selector,'button');return this.children.find(child=>child.tag==='button')??null;}
  focus() {this.focused=true;}
  close() {this.closed=true;}
}
const memoryStorage=()=>{
  const values=new Map();return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
};
const model={videoId:'b142f07c-6fb2-4b99-842f-b12817c88df3',recipe:'sextou',durationSeconds:10,productCount:1};
const firstId='d7f5c088-ece8-4e54-90c3-05ca6f9730e5';
const secondId='47f5c088-ece8-4e54-90c3-05ca6f9730e6';
function fixture({href='https://ia4tube.com/edit/?utm_source=instagram#video/example',choice=null,
  navigator={},storage=memoryStorage(),cookie=''}={}) {
  if(choice)saveConsent(storage,choice);
  const body=new Element('body'),head=new Element('head'),about=new Element('dialog'),listeners=new Map(),cookieWrites=[];
  const doc={body,head,documentElement:{dataset:{}},referrer:'https://l.instagram.com/private?token=secret',
    createElement:tag=>new Element(tag),
    querySelector(selector) {
      if(selector==='#edit-stats-choice')return body.children.find(child=>child.id==='edit-stats-choice')??null;
      if(selector==='#about-dialog')return about;
      throw new Error('Unexpected DOM access: '+selector);
    },
    addEventListener(type,handler) {if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(handler);},
    emit(type,detail) {for(const handler of listeners.get(type)??[])handler({detail});},
  };
  Object.defineProperty(doc,'cookie',{get:()=>cookie,set:value=>cookieWrites.push(value)});
  const windowListeners=new Map(),win={location:new URL(href),navigator,localStorage:storage,
    addEventListener(type,handler) {if(!windowListeners.has(type))windowListeners.set(type,[]);windowListeners.get(type).push(handler);},
    emit(type,event) {for(const handler of windowListeners.get(type)??[])handler(event);},
  };
  installAnalytics(win,doc);
  const banner=()=>doc.querySelector('#edit-stats-choice');
  return {win,doc,head,body,about,storage,listeners,cookieWrites,banner,
    choose:choice=>banner().querySelectorAll('[data-choice]').find(button=>button.dataset.choice===choice).emit('click'),
    commands:()=>Array.isArray(win.dataLayer)?win.dataLayer.map(args=>[...args]):[],
    settings:()=>about.children.find(child=>child.className==='edit-stats-settings'),
    events:()=>Array.isArray(win.dataLayer)?win.dataLayer.map(args=>[...args]).filter(args=>args[0]==='event'):[],
  };
}

test('installation does not load Google or queue analytics before a choice, nor after refusing',()=>{
  const f=fixture();assert.equal(f.banner().hidden,false);assert.equal(f.head.children.length,0);assert.equal(f.win.dataLayer,undefined);
  assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
  f.doc.emit('ia4tube:edit-order-open',model);f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  f.choose('denied');assert.equal(f.banner().hidden,true);assert.equal(f.head.children.length,0);assert.deepEqual(f.events(),[]);
  assert.equal(JSON.parse(f.storage.getItem(CONSENT_KEY)).choice,'denied');
  assert.equal(f.doc.documentElement.dataset.editAnalytics,'disabled');
});

test('granting loads only the dedicated property and explicitly queues one canonical visit',()=>{
  const f=fixture();f.choose('granted');f.choose('granted');
  assert.equal(f.head.children.length,1);assert.equal(f.head.children[0].async,true);
  assert.equal(f.head.children[0].src,'https://www.googletagmanager.com/gtag/js?id='+MEASUREMENT_ID);
  assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],false);
  assert.deepEqual(f.events().map(event=>event[1]),['page_view']);
  const config=f.commands().find(command=>command[0]==='config');
  assert.equal(config[1],MEASUREMENT_ID);assert.equal(config[2].send_page_view,false);
  assert.equal(config[2].allow_google_signals,false);assert.equal(config[2].allow_ad_personalization_signals,false);
  assert.equal(config[2].cookie_path,'/edit');assert.equal(config[2].cookie_prefix,'ia4tube_edit');
  assert.equal(config[2].page_location,'https://ia4tube.com/edit/');
  assert.equal(config[2].page_referrer,'https://l.instagram.com/');
  assert.equal(JSON.stringify(f.commands()).includes('token=secret'),false);
  const defaultConsent=f.commands().find(command=>command[0]==='consent'&&command[1]==='default');
  assert.equal(defaultConsent[2].analytics_storage,'denied');assert.equal(defaultConsent[2].ad_storage,'denied');
  assert.equal(f.doc.documentElement.dataset.editAnalytics,'enabled');
});

test('only custom order events are measured and their saved receipt is deduplicated',()=>{
  const f=fixture();f.choose('granted');
  f.doc.emit('click',{target:{href:'https://wa.me/5547999999999?text=private'}});
  f.doc.emit('submit',{company:'private',phone:'5547999999999'});
  f.doc.emit('ia4tube:edit-order-open',model);
  f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId,company:'private'});
  f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  assert.deepEqual(f.events().map(event=>event[1]),['page_view','edit_order_open','edit_order_saved']);
  assert.deepEqual([...f.listeners.keys()],['ia4tube:edit-order-open','ia4tube:edit-order-saved']);
  assert.equal(JSON.stringify(f.events()).includes('private'),false);assert.equal(JSON.stringify(f.events()).includes(firstId),false);
});

test('revoking disables the property, clears only its cookies, and immediately stops conversion events',()=>{
  const f=fixture({cookie:'ia4tube_edit_ga=one; ia4tube_edit_ga_ABC=two; _ga=other-property; session=preserve'});
  const initialCookieWrites=f.cookieWrites.length;
  f.choose('granted');f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  f.settings().emit('click');assert.equal(f.banner().hidden,false);assert.equal(f.about.closed,true);
  assert.equal(f.banner().querySelector('button').focused,true);
  f.choose('denied');assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
  f.doc.emit('ia4tube:edit-order-open',model);f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:secondId});
  assert.deepEqual(f.events().map(event=>event[1]),['page_view','edit_order_saved']);
  assert.equal(f.cookieWrites.length-initialCookieWrites,8);assert.ok(f.cookieWrites.every(value=>/^ia4tube_edit_ga(?:_|=)/.test(value)&&value.includes('Max-Age=0')&&value.includes('path=/edit')));
  assert.equal(f.cookieWrites.some(value=>value.startsWith('_ga=')||value.startsWith('session=')),false);
  const consent=f.commands().filter(command=>command[0]==='consent').at(-1);assert.equal(consent[2].analytics_storage,'denied');
  f.choose('granted');assert.equal(f.head.children.length,1);assert.deepEqual(f.events().map(event=>event[1]),['page_view','edit_order_saved']);
});

test('returning consent is respected without another prompt and expired consent does not load Google',()=>{
  const granted=fixture({choice:'granted'});assert.equal(granted.banner().hidden,true);assert.equal(granted.head.children.length,1);
  assert.deepEqual(granted.events().map(event=>event[1]),['page_view']);
  const denied=fixture({choice:'denied'});assert.equal(denied.banner().hidden,true);assert.equal(denied.head.children.length,0);
  const storage=memoryStorage();storage.setItem(CONSENT_KEY,JSON.stringify({choice:'granted',expiresAt:1}));
  const expired=fixture({storage});assert.equal(expired.banner().hidden,false);assert.equal(expired.head.children.length,0);
});

test('local previews never load Google or send events even after explicit consent',()=>{
  for(const href of ['http://127.0.0.1:8896/edit/','http://localhost:8896/edit/']) {
    const f=fixture({href});f.choose('granted');
    f.doc.emit('ia4tube:edit-order-open',model);f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
    assert.equal(f.head.children.length,0);assert.equal(f.win.dataLayer,undefined);
    assert.equal(f.doc.documentElement.dataset.editAnalytics,'local-preview');
  }
});

test('unrelated origins and public pages are not modified',()=>{
  for(const href of ['https://example.com/edit/','https://ia4tube.com/app.html','http://ia4tube.com/edit/']) {
    const f=fixture({href});assert.equal(f.body.children.length,0);assert.equal(f.about.children.length,0);
    assert.equal(f.head.children.length,0);assert.equal(f.win.dataLayer,undefined);
  }
});

test('global privacy control and do-not-track override prior consent and any attempted opt-in',()=>{
  for(const navigator of [{globalPrivacyControl:true},{doNotTrack:'1'}]) {
    const f=fixture({choice:'granted',navigator});
    assert.equal(f.head.children.length,0);assert.equal(f.banner().hidden,true);assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
    f.settings().emit('click');assert.equal(f.banner().hidden,true);
    f.choose('granted');f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
    assert.equal(f.head.children.length,0);assert.deepEqual(f.events(),[]);assert.equal(f.doc.documentElement.dataset.editAnalytics,'disabled');
    assert.equal(JSON.parse(f.storage.getItem(CONSENT_KEY)).choice,'denied');
  }
});

test('cross-tab refusal immediately stops events and unrelated storage updates do not change consent',()=>{
  const f=fixture({choice:'granted'});saveConsent(f.storage,'denied');
  f.win.emit('storage',{key:'unrelated'});assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],false);
  f.win.emit('storage',{key:CONSENT_KEY});assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
  f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});assert.deepEqual(f.events().map(event=>event[1]),['page_view']);
});

test('clearing browser storage in another tab removes consent and restores the choice without tracking',()=>{
  const f=fixture({choice:'granted'});f.storage.values.clear();f.win.emit('storage',{key:null});
  assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);assert.equal(f.banner().hidden,false);
  assert.equal(f.doc.documentElement.dataset.editAnalytics,'consent-required');
  f.doc.emit('ia4tube:edit-order-open',model);f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  assert.deepEqual(f.events().map(event=>event[1]),['page_view']);
});

test('duplicate installation is inert and does not duplicate scripts, prompts or listeners',()=>{
  const f=fixture({choice:'granted'});installAnalytics(f.win,f.doc);
  assert.equal(f.body.children.length,1);assert.equal(f.head.children.length,1);assert.equal(f.about.children.length,3);
  assert.equal(f.listeners.get('ia4tube:edit-order-saved').length,1);
  assert.deepEqual(f.events().map(event=>event[1]),['page_view']);
});

test('blocked storage still permits a session-only choice without reading checkout fields',()=>{
  const storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const f=fixture({storage});assert.equal(f.banner().hidden,false);assert.doesNotThrow(()=>f.choose('granted'));
  f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  assert.deepEqual(f.events().map(event=>event[1]),['page_view','edit_order_saved']);
});

test('a blocked Google load and a throwing analytics queue remain isolated from storefront events',()=>{
  const f=fixture();f.choose('granted');assert.doesNotThrow(()=>f.head.children[0].onerror());
  assert.equal(f.doc.documentElement.dataset.editAnalytics,'blocked');
  f.win.dataLayer={push(){throw new Error('analytics unavailable');}};
  assert.doesNotThrow(()=>f.doc.emit('ia4tube:edit-order-open',model));
  assert.doesNotThrow(()=>f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId}));
  assert.doesNotThrow(()=>f.choose('denied'));assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
});

test('refusal remains effective when the Google consent command throws and its queue later recovers',()=>{
  const f=fixture();f.choose('granted');
  f.win.dataLayer={push(){throw new Error('queue unavailable during refusal');}};
  f.choose('denied');assert.equal(f.win['ga-disable-'+MEASUREMENT_ID],true);
  f.win.dataLayer=[];
  f.doc.emit('ia4tube:edit-order-open',model);f.doc.emit('ia4tube:edit-order-saved',{...model,orderId:firstId});
  assert.deepEqual(f.events(),[],'the in-memory consent must be revoked independently of Google command delivery');
});
