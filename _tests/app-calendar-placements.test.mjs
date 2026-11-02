import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../edit/app-calendar.js',import.meta.url),'utf8');
const rewritten='const createAppAvailability=()=>{};const createAppCombosBridge=()=>{};\n'+source.replace(/^import .*;\r?\n/gm,'');
const {createAppCalendarBridge}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
const nonce='A'.repeat(43),id='b774fc09-60f9-4d55-9a9e-6063d056da9d',ticket=id+'.'+'B'.repeat(43);
function fixture(version,{storage:provided,hash='#app-calendar='+nonce}={}) {
  const values=new Map(),urls=[],timers=new Map();let sequence=0;
  const storage=provided||{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const bridge=createAppCalendarBridge({location:{hash,search:version===undefined?'':'?app_version='+version},storage,
    navigate:url=>urls.push(url),setTimer:fn=>{timers.set(++sequence,fn);return sequence;},clearTimer:key=>timers.delete(key)});
  return {bridge,storage,urls,timers,values};
}
test('app98 and unknown versions retain the exact two-parameter callback',async()=>{
  for(const version of [undefined,'98','0','invalid','99x']) {
    const f=fixture(version),pending=f.bridge.request(id,{mediaKind:'image'});
    assert.equal(f.urls[0],'https://ia4tube.com/edit/app-calendar/request?requestId='+id+'&nonce='+nonce);
    f.bridge.receive(id,ticket);assert.deepEqual(await pending,{ticket});
  }
});
test('app99 sends image/video only as the new native display hint',async()=>{
  for(const mediaKind of ['image','video']) {
    const f=fixture('99'),pending=f.bridge.request(id,{mediaKind});
    const url=new URL(f.urls[0]);
    assert.deepEqual([...url.searchParams.keys()],['requestId','nonce','mediaKind']);
    assert.equal(url.searchParams.get('mediaKind'),mediaKind);
    assert.equal(url.searchParams.get('requestId'),id);assert.equal(url.searchParams.get('nonce'),nonce);
    f.bridge.receive(id,ticket);assert.deepEqual(await pending,{ticket});
  }
});
test('new-app unknown or omitted media kinds fall back to the existing callback',async()=>{
  for(const options of [undefined,{}, {mediaKind:'story'},{mediaKind:'image&owner=another'}]) {
    const f=fixture('99'),pending=f.bridge.request(id,options);
    assert.equal(new URL(f.urls[0]).searchParams.size,2);
    f.bridge.receive(id,ticket);await pending;
  }
});
test('overlapping requests and confirmed retries keep their original frozen ticket',async()=>{
  const f=fixture('99'),first=f.bridge.request(id,{mediaKind:'image'});
  assert.equal(f.bridge.request(id,{mediaKind:'video'}),first);assert.equal(f.urls.length,1);
  f.bridge.receive(id,ticket);await first;
  assert.deepEqual(await f.bridge.request(id,{mediaKind:'video'}),{ticket});assert.equal(f.urls.length,1);
  const restored=fixture('99',{storage:f.storage});
  assert.deepEqual(await restored.bridge.request(id,{mediaKind:'video'}),{ticket});assert.equal(restored.urls.length,0);
});
test('public pages do not navigate or create a calendar ticket',async()=>{
  const f=fixture('99',{hash:''});
  assert.equal(await f.bridge.request(id,{mediaKind:'image'}),null);assert.equal(f.urls.length,0);
});
test('cancel and timeout keep the request recoverable without fabricating a ticket',async()=>{
  const f=fixture('99'),first=f.bridge.request(id,{mediaKind:'image'});
  f.bridge.receive(id,null,'cancelled');await assert.rejects(first,/Escolha a data/);
  const second=f.bridge.request(id,{mediaKind:'image'});[...f.timers.values()][0]();
  await assert.rejects(second,/não confirmou/);assert.equal(f.urls.length,2);
  const third=f.bridge.request(id,{mediaKind:'image'});f.bridge.receive(id,ticket);assert.deepEqual(await third,{ticket});
});
