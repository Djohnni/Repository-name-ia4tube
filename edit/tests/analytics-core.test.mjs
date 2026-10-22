import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENT_KEY,COUNTED_KEY,isPublicEdit,pageContext,readConsent,saveConsent,createEditMeasurement,
} from '../analytics-core.js';

const model={videoId:'b142f07c-6fb2-4b99-842f-b12817c88df3',recipe:'sextou',durationSeconds:10,productCount:1};
const firstId='d7f5c088-ece8-4e54-90c3-05ca6f9730e5';
const secondId='47f5c088-ece8-4e54-90c3-05ca6f9730e6';
const memoryStorage=(initial=[])=>{
  const values=new Map(initial);
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value))};
};
function fixture({storage=memoryStorage(),allowed=true,send}={}) {
  const events=[],context=pageContext('https://ia4tube.com/edit/?utm_source=instagram&utm_medium=social#video/private');
  const measurement=createEditMeasurement({storage,allowed,context,send:send??((name,params)=>events.push({name,params}))});
  return {measurement,events,storage,context};
}

test('measurement is limited to the public HTTPS edit entry points',()=>{
  for(const path of ['/edit','/edit/','/edit/index.html']) {
    assert.equal(isPublicEdit('https://ia4tube.com'+path),true);
    assert.equal(isPublicEdit('https://www.ia4tube.com'+path+'?v=1#perfil'),true);
  }
  for(const href of ['http://ia4tube.com/edit/','http://127.0.0.1:8896/edit/',
    'https://example.com/edit/','https://ia4tube.com.evil.test/edit/','https://ia4tube.com/',
    'https://ia4tube.com/app.html','https://ia4tube.com/edit/other','https://ia4tube.com/editing',
    'https://name:secret@ia4tube.com/edit/','https://ia4tube.com:444/edit/',
    'file:///edit/index.html','javascript:alert(1)','not-a-url'])assert.equal(isPublicEdit(href),false,href);
});

test('page context sends a canonical URL without hashes, customer queries, filenames or referral paths',()=>{
  const context=pageContext('https://ia4tube.com/edit/?company=Cliente%20Privado&phone=5547999999999&token=secret&file=logo-cliente.png#pedido-salvo',
    'https://l.instagram.com/private-customer?token=secret#account');
  assert.deepEqual(context,{page_location:'https://ia4tube.com/edit/',page_title:'iA4tube Edit',page_referrer:'https://l.instagram.com/'});
  for(const privateValue of ['Cliente','5547999999999','secret','logo-cliente','pedido-salvo','private-customer']) {
    assert.equal(JSON.stringify(context).includes(privateValue),false);
  }
});

test('only safe explicit campaign fields are extracted; emails, phone numbers and arbitrary click IDs are dropped',()=>{
  const context=pageContext('https://ia4tube.com/edit/?utm_source=instagram&utm_medium=paid_social&utm_campaign=edit-outubro&utm_content=video_1&utm_term=segredo&gclid=private&fbclid=private');
  assert.deepEqual(context,{page_location:'https://ia4tube.com/edit/',page_title:'iA4tube Edit',page_referrer:'',
    campaign_source:'instagram',campaign_medium:'paid_social',campaign_name:'edit-outubro',campaign_content:'video_1'});
  for(const value of ['pessoa@example.com','5547999999999','https://private.example/token','name/secret','x'.repeat(81)]) {
    const unsafe=pageContext('https://ia4tube.com/edit/?utm_source='+encodeURIComponent(value));
    assert.equal(Object.hasOwn(unsafe,'campaign_source'),false,value);
  }
});

test('referrer is only an external HTTP origin; credentials, internal pages and unsafe schemes are discarded',()=>{
  for(const referrer of ['https://ia4tube.com/app.html?token=secret','https://www.ia4tube.com/private',
    'https://user:password@example.com/private','javascript:alert(1)','file:///secret','not-a-url','']) {
    assert.equal(pageContext('not-a-url',referrer).page_referrer,'',referrer);
  }
  assert.equal(pageContext('invalid','https://www.google.com/search?q=private').page_referrer,'https://www.google.com/');
});

test('consent defaults to unknown and only accepts a valid unexpired decision',()=>{
  const storage=memoryStorage(),now=1000000;
  assert.equal(readConsent(storage,now),null);
  for(const raw of ['bad-json','null','{}','"granted"',JSON.stringify({choice:'maybe',expiresAt:now+1}),
    JSON.stringify({choice:'granted',expiresAt:now}),JSON.stringify({choice:'granted',expiresAt:String(now+1)})]) {
    storage.setItem(CONSENT_KEY,raw);assert.equal(readConsent(storage,now),null,raw);
  }
  for(const choice of ['granted','denied']) {
    assert.equal(saveConsent(storage,choice,now),true);assert.equal(readConsent(storage,now),choice);
    assert.equal(readConsent(storage,now+180*86400000),null);
  }
  const before=storage.getItem(CONSENT_KEY);
  assert.equal(saveConsent(storage,'invalid',now),false);assert.equal(storage.getItem(CONSENT_KEY),before);
});

test('unavailable consent storage never throws',()=>{
  const blocked={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  assert.equal(readConsent(blocked),null);assert.equal(saveConsent(blocked,'granted'),false);
  assert.equal(readConsent(undefined),null);assert.equal(saveConsent(undefined,'denied'),false);
});

test('without consent events are discarded; granting sends one visit without retroactive interactions',()=>{
  const {measurement,events}=fixture();
  assert.equal(measurement.open(model),false);assert.equal(measurement.saved({...model,orderId:firstId}),false);
  measurement.setConsent('denied');assert.deepEqual(events,[]);
  measurement.setConsent('granted');measurement.setConsent('granted');
  assert.deepEqual(events.map(event=>event.name),['page_view']);
  assert.equal(measurement.open(model),true);assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_open']);
});

test('revoking consent immediately stops events and regranting does not replay denied interactions or visits',()=>{
  const {measurement,events}=fixture();measurement.setConsent('granted');measurement.setConsent('denied');
  assert.equal(measurement.open(model),false);assert.equal(measurement.saved({...model,orderId:firstId}),false);
  measurement.setConsent('granted');assert.deepEqual(events.map(event=>event.name),['page_view']);
  assert.equal(measurement.saved({...model,orderId:secondId}),true);
  assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_saved']);
});

test('a non-production context cannot measure even with consent',()=>{
  const {measurement,events}=fixture({allowed:false});measurement.setConsent('granted');
  assert.equal(measurement.open(model),false);assert.equal(measurement.saved({...model,orderId:firstId}),false);
  assert.deepEqual(events,[]);
  const defaultEvents=[],measurementDefault=createEditMeasurement({send:(...event)=>defaultEvents.push(event)});
  measurementDefault.setConsent('granted');measurementDefault.open(model);assert.deepEqual(defaultEvents,[]);
});

test('confirmed orders are deduplicated by local receipt ID, never by repeated model or content',()=>{
  const {measurement,events,storage,context}=fixture();measurement.setConsent('granted');
  assert.equal(measurement.saved({...model,orderId:firstId}),true);
  assert.equal(measurement.saved({...model,orderId:firstId}),false);
  assert.equal(measurement.saved({...model,orderId:firstId.toUpperCase()}),false,'UUID casing cannot recount the same order');
  assert.equal(measurement.saved({...model,orderId:secondId}),true);
  assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_saved','edit_order_saved']);
  assert.deepEqual(events[1].params,{...context,video_id:model.videoId,model_type:'sextou',duration_seconds:10,product_count:1});
  assert.equal(JSON.stringify(events).includes(firstId),false);assert.equal(JSON.stringify(events).includes(secondId),false);
  assert.deepEqual(JSON.parse(storage.getItem(COUNTED_KEY)),[firstId,secondId]);
});

test('local receipt deduplication survives a new measurement instance and preserves unrelated storage',()=>{
  const storage=memoryStorage([['order-attempt','keep']]);
  const first=fixture({storage});first.measurement.setConsent('granted');first.measurement.saved({...model,orderId:firstId});
  const next=fixture({storage});next.measurement.setConsent('granted');
  assert.equal(next.measurement.saved({...model,orderId:firstId}),false);
  assert.equal(next.measurement.saved({...model,orderId:secondId}),true);
  assert.deepEqual(next.events.map(event=>event.name),['page_view','edit_order_saved']);
  assert.equal(storage.getItem('order-attempt'),'keep');
});

test('model summary parameters are allowlisted and never include form data, errors or URLs',()=>{
  const {measurement,events}=fixture();measurement.setConsent('granted');
  const detail={...model,orderId:firstId,company:'Cliente privado',phone:'5547999999999',message:'private text',
    logo:{name:'private.png',data:'base64-secret'},productPrice:'39,90',totalCents:1990,fingerprint:'private-hash',
    whatsappUrl:'https://wa.me/5547999999999?text=private',page_location:'https://evil.example/private',
    error:'private validation error',items:[{name:'private product'}]};
  measurement.open(detail);measurement.saved(detail);
  const expected={...pageContext('https://ia4tube.com/edit/?utm_source=instagram&utm_medium=social'),
    video_id:model.videoId,model_type:'sextou',duration_seconds:10,product_count:1};
  assert.deepEqual(events[1].params,expected);assert.deepEqual(events[2].params,expected);
  for(const privateValue of ['Cliente privado','5547999999999','private','base64-secret','39,90','1990',firstId]) {
    assert.equal(JSON.stringify(events).includes(privateValue),false,privateValue);
  }
});

test('unknown models and invalid receipts produce no events, and unsupported optional fields are omitted',()=>{
  const {measurement,events,context}=fixture();measurement.setConsent('granted');
  for(const detail of [null,{}, {...model,videoId:'not-a-public-id'}]) {
    assert.equal(measurement.open(detail),false);
    assert.equal(measurement.saved(detail),false);
  }
  for(const orderId of [undefined,'','invalid','customer@example.com'])assert.equal(measurement.saved({...model,orderId}),false);
  assert.equal(measurement.open({...model,recipe:'private text',durationSeconds:9000,productCount:50}),true);
  assert.deepEqual(events[1].params,{...context,video_id:model.videoId});
});

test('broken analytics storage still allows measurement with in-memory deduplication',()=>{
  const storage={getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}};
  const {measurement,events}=fixture({storage});measurement.setConsent('granted');
  assert.equal(measurement.saved({...model,orderId:firstId}),true);
  assert.equal(measurement.saved({...model,orderId:firstId}),false);
  assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_saved']);
});

test('corrupt deduplication data does not break measurement or poison valid order IDs',()=>{
  for(const raw of ['invalid','null','{}',JSON.stringify(['invalid',42,null])]) {
    const {measurement,events}=fixture({storage:memoryStorage([[COUNTED_KEY,raw]])});measurement.setConsent('granted');
    assert.equal(measurement.saved({...model,orderId:firstId}),true);
    assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_saved']);
  }
});

test('a failing event sender does not throw or mark a failed order as counted',()=>{
  let blocked=true;const events=[],storage=memoryStorage();
  const {measurement}=fixture({storage,send:(name,params)=>{if(blocked)throw new Error('blocked');events.push({name,params});}});
  assert.doesNotThrow(()=>measurement.setConsent('granted'));
  assert.equal(measurement.open(model),false);assert.equal(measurement.saved({...model,orderId:firstId}),false);
  assert.equal(storage.getItem(COUNTED_KEY),null);
  blocked=false;measurement.setConsent('granted');assert.equal(measurement.saved({...model,orderId:firstId}),true);
  assert.deepEqual(events.map(event=>event.name),['page_view','edit_order_saved']);
});

test('public catalog names join orders and video attention without customer fields',()=>{
  const {measurement,events}=fixture();measurement.setConsent('granted');
  const detail={...model,videoTitle:'Respeita essa fome',feedPosition:1,visibleSeconds:10,watchSeconds:8.5,
    videoPositionSeconds:2.347,reason:'heartbeat',company:'Privado',logo:'secret',phone:'5547999999999'};
  measurement.open(detail);measurement.saved({...detail,orderId:firstId});
  assert.equal(measurement.video('edit_video_view',detail),true);
  assert.equal(measurement.video('edit_video_time',detail),true);
  assert.equal(measurement.video('edit_video_last',{...detail,reason:'page_hidden'}),true);
  assert.ok(events.slice(1).every(event=>event.params.edit_video_name==='Respeita essa fome'));
  const time=events.find(event=>event.name==='edit_video_time').params;
  assert.equal(time.visible_seconds,10);assert.equal(time.watch_seconds,8.5);
  assert.equal(time.video_position_seconds,2.3);assert.equal(time.feed_position,1);
  for(const name of ['edit_video_view','edit_video_last']) {
    const params=events.find(event=>event.name===name).params;
    assert.equal(Object.hasOwn(params,'visible_seconds'),false);
    assert.equal(Object.hasOwn(params,'watch_seconds'),false);
  }
  assert.equal(JSON.stringify(events).includes('Privado'),false);
  assert.equal(JSON.stringify(events).includes('5547999999999'),false);
  assert.equal(JSON.stringify(events).includes('secret'),false);
});

test('video attention needs consent and strict event, title and timing limits',()=>{
  const {measurement,events}=fixture();
  const detail={...model,videoTitle:'Só uma olhadinha',visibleSeconds:10,watchSeconds:10};
  assert.equal(measurement.video('edit_video_time',detail),false);
  measurement.setConsent('granted');
  for(const name of ['purchase','page_view','unknown'])assert.equal(measurement.video(name,detail),false);
  for(const videoTitle of [undefined,'https://example.com','private@example.com','x'.repeat(101),'\nprivate']) {
    assert.equal(measurement.video('edit_video_view',{...detail,videoTitle}),false);
  }
  for(const [visibleSeconds,watchSeconds] of [[0,0],[-1,0],[121,0],[10,11],[NaN,1],[10,-1],[10,Infinity]]) {
    assert.equal(measurement.video('edit_video_time',{...detail,visibleSeconds,watchSeconds}),false);
  }
  assert.deepEqual(events.map(event=>event.name),['page_view']);
  assert.equal(measurement.video('edit_video_time',detail),true);
  measurement.setConsent('denied');
  assert.equal(measurement.video('edit_video_last',detail),false);
  assert.equal(events.length,2);
});
