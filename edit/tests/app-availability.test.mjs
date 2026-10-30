import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAvailability} from '../app-availability.js';
const nonce='n'.repeat(43),ids=['12345678-1234-4123-8123-123456789abc','22345678-1234-4123-8123-123456789abc'];
function fixture(){
  let now=0,visible=true,index=0,timerId=0;const urls=[],changes=[],timers=new Map();
  const bridge=createAppAvailability({getNonce:()=>nonce,navigate:url=>urls.push(url),now:()=>now,canRefresh:()=>visible,
    requestId:()=>ids[index++%ids.length],onChange:value=>changes.push(value),
    setTimer:(run,delay)=>{const id=++timerId;timers.set(id,{run,at:now+delay});return id;},clearTimer:id=>timers.delete(id)});
  const advance=target=>{for(let safety=0;safety<50;safety++){
    const next=[...timers].filter(([,timer])=>timer.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];
    if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].run();
  }now=target;};
  return {bridge,urls,changes,advance,setVisible:value=>{visible=value;}};
}
test('app86 without an additive native reply remains unknown and sends no new callback',()=>{
  const f=fixture();assert.equal(f.bridge.refresh(),false);assert.equal(f.bridge.canCreate('image'),null);
  assert.equal(f.bridge.canCreate('video'),null);assert.equal(f.urls.length,0);
});
test('gift image and exhausted video are independent; hints never expose account credentials',()=>{
  const f=fixture();assert.equal(f.bridge.receive(nonce,null,1,true,false,30000),true);
  assert.equal(f.bridge.canCreate('image'),true);assert.equal(f.bridge.canCreate('video'),false);
  assert.deepEqual(Object.keys(f.bridge.current()).sort(),['supported','canImage','canVideo'].sort());
});
test('bad nonce, fields, lifetime and old revisions cannot replace a current hint',()=>{
  const f=fixture();f.bridge.receive(nonce,null,5,false,false,30000);
  for(const args of [['x'.repeat(43),null,6,true,true,30000],[nonce,null,4,true,true,30000],
    [nonce,null,6,'false',true,30000],[nonce,null,6,true,true,30001],[nonce,'bad',6,true,true,30000],
    [nonce,null,6,true,true,-1],[nonce,null,1.5,true,true,30000]])assert.equal(f.bridge.receive(...args),false);
  assert.equal(f.bridge.canCreate('image'),false);assert.equal(f.bridge.canCreate('video'),false);
});
test('post-ACK refresh rejects older unrelated replies and preserves correlation through loading and failure',()=>{
  const f=fixture();f.bridge.receive(nonce,null,1,true,true,30000);assert.equal(f.bridge.refresh(),true);
  const url=new URL(f.urls[0]);assert.equal(url.pathname,'/edit/app-availability/request');
  assert.deepEqual([...url.searchParams.keys()].sort(),['nonce','requestId']);assert.equal(url.searchParams.get('nonce'),nonce);
  assert.equal(f.bridge.receive(nonce,null,2,true,true,30000),false);
  assert.equal(f.bridge.receive(nonce,ids[0],2,null,null,0,true),true);
  assert.equal(f.bridge.receive(nonce,null,3,true,true,30000),false);
  assert.equal(f.bridge.receive(nonce,ids[0],2,false,false,30000,false),true);
  assert.equal(f.bridge.canCreate('image'),false);
  f.bridge.refresh();assert.equal(f.bridge.receive(nonce,ids[1],3,null,null,0,false),true);
  assert.equal(f.bridge.canCreate('image'),null);
  assert.equal(f.bridge.receive(nonce,null,4,true,true,30000),true,'a later native resume works after failure');
});
test('foreground hint refresh is bounded and expired background data becomes unknown',()=>{
  const f=fixture();f.bridge.receive(nonce,null,1,false,false,30000);f.advance(28999);assert.equal(f.urls.length,0);
  f.advance(29000);assert.equal(f.urls.length,1);assert.equal(f.bridge.canCreate('image'),null);
  f.bridge.receive(nonce,ids[0],2,false,false,30000);f.setVisible(false);f.advance(60000);
  assert.equal(f.urls.length,1);assert.equal(f.bridge.canCreate('image'),null);
});
