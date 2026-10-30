import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppCalendarBridge} from '../app-calendar.js';
import {buildMultipartOrder} from '../order-adapter.js';
const id = 'a629117b-5f4e-4541-a63f-166f44ccbdf3';
const ticket = id + '.' + 't'.repeat(43);
const nonce = 'n'.repeat(43);
function setup(hash = '#app-calendar=' + nonce) {
  const values = new Map(), urls = [], timers = new Map();let next=0;
  const storage = {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const options = {location:{hash},storage,navigate:url=>urls.push(url),
    setTimer:fn=>{timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)};
  return {bridge:createAppCalendarBridge(options),urls,timers,options};
}
test('public catalog has no native context; this bridge alone never grants checkout admission', async () => {
  const f=setup('#video/' + id);
  assert.equal(await f.bridge.request(id),null);assert.equal(f.urls.length,0);
});
test('one native request per attempt; correlated reply survives repeated POST attempts', async () => {
  const f=setup(); const first=f.bridge.request(id), second=f.bridge.request(id);
  assert.equal(first,second);assert.equal(f.urls.length,1);
  const url=new URL(f.urls[0]);assert.equal(url.pathname,'/edit/app-calendar/request');
  assert.equal(url.searchParams.get('nonce'),nonce);assert.equal(url.searchParams.get('requestId'),id);
  f.bridge.receive('unknown',ticket,null);assert.equal(f.timers.size,1);
  f.bridge.receive(id,ticket,null);assert.deepEqual(await first,{ticket});
  assert.deepEqual(await f.bridge.request(id),{ticket});assert.equal(f.urls.length,1);
  const restored=createAppCalendarBridge({...f.options,location:{hash:'#pedido-salvo'}});
  assert.deepEqual(await restored.request(id),{ticket});
});
test('cancellation, timeouts and invalid replies do not allow an anonymous POST', async () => {
  for (const mode of ['cancelled','invalid','timeout']) {
    const f=setup();const result=f.bridge.request(id);
    if(mode==='timeout') [...f.timers.values()][0]();
    else f.bridge.receive(id,mode==='invalid'?'wrong':null,mode==='cancelled'?'cancelled':null);
    await assert.rejects(result);
  }
});
test('a new native session invalidates the previous session receipt', async () => {
  const f=setup(), first=f.bridge.request(id);f.bridge.receive(id,ticket,null);await first;
  const other=createAppCalendarBridge({...f.options,location:{hash:'#app-calendar='+'x'.repeat(43)}});
  const pending=other.request(id);assert.equal(f.urls.length,2);
  other.receive(id,null,'cancelled');await assert.rejects(pending);
});
test('context is optional multipart metadata, never an owner or JWT supplied by the page', () => {
  const payload={company:'',videoId:'b142f07c-6fb2-4b99-842f-b12817c88df3',videoVersion:2,
    durationSeconds:10,consent:true,logo:{name:'logo.png',mime:'image/png',data:btoa('image')},appCalendar:{ticket}};
  const value=JSON.parse(buildMultipartOrder(payload).get('data'));
  assert.deepEqual(value.appCalendar,{ticket});assert.equal(value.userId,undefined);
  assert.throws(()=>buildMultipartOrder({...payload,appCalendar:{ticket,userId:'other'}}));
  assert.throws(()=>buildMultipartOrder({...payload,appCalendar:{ticket:'Bearer session'}}));
});
