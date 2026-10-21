import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlaybackAudio} from '../playback-audio.js';

const flush = async () => {for(let i=0;i<8;i++)await Promise.resolve();};
const denied = () => Object.assign(new Error('Autoplay requires a gesture'),{name:'NotAllowedError'});
function video() {
  const requests=[];
  return {
    muted:true,paused:true,requests,currentTime:42,src:'original.mp4',volume:.7,
    play() {
      let resolve,reject;
      const promise=new Promise((yes,no)=>{resolve=()=>{this.paused=false;yes();};reject=no;});
      requests.push({resolve,reject,muted:this.muted});
      return promise;
    },
  };
}

test('sound is enabled by default without persisted preference',()=>{
  assert.deepEqual(createPlaybackAudio().getState(),{enabled:true,blocked:false,audible:true});
});

test('the initial play call is synchronous and requests sound',async()=>{
  const audio=createPlaybackAudio(),v=video();let playing=0;
  const pending=audio.play(v,{onPlaying:()=>playing++});
  assert.equal(v.requests.length,1);assert.equal(v.requests[0].muted,false);
  v.requests[0].resolve();assert.equal(await pending,'playing');assert.equal(playing,1);
});

test('concurrent duplicate calls share one pending play promise',async()=>{
  const audio=createPlaybackAudio(),v=video();
  const first=audio.play(v),second=audio.play(v);
  assert.equal(first,second);assert.equal(v.requests.length,1);
  v.requests[0].resolve();await first;
  assert.equal(audio.play(v),first);assert.equal(v.requests.length,1);
});

test('a paused video can be started again after a successful play',async()=>{
  const audio=createPlaybackAudio(),v=video();const first=audio.play(v);v.requests[0].resolve();await first;
  v.paused=true;const second=audio.play(v);assert.equal(v.requests.length,2);
  v.requests[1].resolve();assert.equal(await second,'playing');
});

test('NotAllowedError falls back to muted once and exposes the blocked state',async()=>{
  const states=[],audio=createPlaybackAudio({onChange:state=>states.push(state)}),v=video();let blocked=0,playing=0;
  const pending=audio.play(v,{onBlocked:()=>blocked++,onPlaying:()=>playing++});
  v.requests[0].reject(denied());await flush();
  assert.equal(v.requests.length,2);assert.equal(v.requests[1].muted,true);
  assert.deepEqual(audio.getState(),{enabled:true,blocked:true,audible:false});
  assert.deepEqual(states,[audio.getState()]);assert.equal(blocked,1);
  assert.equal(audio.play(v),pending);assert.equal(v.requests.length,2);
  v.requests[1].resolve();assert.equal(await pending,'playing');assert.equal(playing,1);
});

test('a denied muted fallback stops without loops or an unhandled rejection',async()=>{
  const audio=createPlaybackAudio(),v=video();let errors=0;
  const pending=audio.play(v,{onError:()=>errors++});v.requests[0].reject(denied());await flush();
  v.requests[1].reject(denied());assert.equal(await pending,'error');await flush();
  assert.equal(v.requests.length,2);assert.equal(errors,1);
});

test('other play errors never force mute or retry',async()=>{
  const audio=createPlaybackAudio(),v=video();let observed;
  const error=Object.assign(new Error('Unsupported file'),{name:'NotSupportedError'});
  const pending=audio.play(v,{onError:value=>observed=value});v.requests[0].reject(error);
  assert.equal(await pending,'error');assert.equal(observed,error);assert.equal(v.requests.length,1);
  assert.deepEqual(audio.getState(),{enabled:true,blocked:false,audible:true});
});

test('synchronous play exceptions are caught and can take the one muted fallback',async()=>{
  const audio=createPlaybackAudio();let calls=0;
  const v={muted:true,paused:true,play(){calls++;if(calls===1)throw denied();this.paused=false;}};
  assert.equal(await audio.play(v),'playing');assert.equal(calls,2);assert.equal(v.muted,true);
});

test('older browsers returning undefined from play are supported',async()=>{
  const audio=createPlaybackAudio(),v={muted:true,paused:true,play(){this.paused=false;}};
  assert.equal(await audio.play(v),'playing');assert.equal(v.muted,false);
});

test('explicit activation after blocked autoplay invokes audible play synchronously',async()=>{
  const audio=createPlaybackAudio(),v=video();const first=audio.play(v);
  v.requests[0].reject(denied());await flush();v.requests[1].resolve();await first;
  audio.setEnabled(true);const second=audio.play(v);
  assert.equal(v.requests.length,3);assert.equal(v.requests[2].muted,false);
  assert.deepEqual(audio.getState(),{enabled:true,blocked:false,audible:true});
  v.requests[2].resolve();assert.equal(await second,'playing');
});

test('user mute applies immediately and persists when navigating to another scene',async()=>{
  const audio=createPlaybackAudio(),a=video(),b=video();const first=audio.play(a);a.requests[0].resolve();await first;
  audio.setEnabled(false);assert.equal(a.muted,true);audio.cancel(a);
  const next=audio.play(b);assert.equal(b.requests[0].muted,true);b.requests[0].resolve();await next;
  assert.deepEqual(audio.getState(),{enabled:false,blocked:false,audible:false});
});

test('browser autoplay blocking also persists across scenes until explicit activation',async()=>{
  const audio=createPlaybackAudio(),a=video(),b=video();const first=audio.play(a);
  a.requests[0].reject(denied());await flush();a.requests[1].resolve();await first;
  audio.cancel(a);const next=audio.play(b);assert.equal(b.requests[0].muted,true);
  b.requests[0].resolve();await next;assert.equal(audio.getState().blocked,true);
});

test('muting while an audible promise is pending prevents late fallback and callbacks',async()=>{
  const audio=createPlaybackAudio(),v=video();let callbacks=0;
  const pending=audio.play(v,{onPlaying:()=>callbacks++,onBlocked:()=>callbacks++});
  audio.setEnabled(false);v.requests[0].reject(denied());assert.equal(await pending,'stale');
  assert.equal(v.muted,true);assert.equal(callbacks,0);assert.equal(v.requests.length,1);
  assert.equal(audio.getState().enabled,false);assert.equal(audio.getState().blocked,false);
});

test('muting while fallback is pending prevents its completion from changing preference',async()=>{
  const audio=createPlaybackAudio(),v=video();let played=0;
  const pending=audio.play(v,{onPlaying:()=>played++});v.requests[0].reject(denied());await flush();
  audio.setEnabled(false);v.requests[1].resolve();assert.equal(await pending,'stale');
  assert.equal(played,0);assert.equal(v.muted,true);
  assert.deepEqual(audio.getState(),{enabled:false,blocked:false,audible:false});
});

test('switching scenes invalidates rejection and callbacks of the old scene',async()=>{
  const audio=createPlaybackAudio(),a=video(),b=video();let oldEvents=0;
  const first=audio.play(a,{onBlocked:()=>oldEvents++,onPlaying:()=>oldEvents++});
  const second=audio.play(b);a.requests[0].reject(denied());assert.equal(await first,'stale');
  assert.equal(a.requests.length,1);assert.equal(oldEvents,0);assert.equal(audio.getState().blocked,false);
  b.requests[0].resolve();assert.equal(await second,'playing');
});

test('an inactive or hidden scene never starts and late failures cannot restart it',async()=>{
  const audio=createPlaybackAudio(),v=video();let current=false,events=0;
  const options={isCurrent:()=>current,onBlocked:()=>events++,onPlaying:()=>events++};
  assert.equal(await audio.play(v,options),'stale');assert.equal(v.requests.length,0);
  current=true;const pending=audio.play(v,options);current=false;v.requests[0].reject(denied());
  assert.equal(await pending,'stale');assert.equal(v.requests.length,1);assert.equal(events,0);
});

test('cancel before pause modal profile or hide invalidates old pending play',async()=>{
  for(const reason of ['pause','modal','profile','hidden']) {
    const audio=createPlaybackAudio(),v=video();let events=0;
    const pending=audio.play(v,{onPlaying:()=>events++,onBlocked:()=>events++});
    audio.cancel(v);v.requests[0].reject(denied());assert.equal(await pending,'stale',reason);
    assert.equal(events,0,reason);assert.equal(v.requests.length,1,reason);
  }
});

test('canceling another video does not cancel the current scene',async()=>{
  const audio=createPlaybackAudio(),a=video(),b=video();const pending=audio.play(a);
  audio.cancel(b);a.requests[0].resolve();assert.equal(await pending,'playing');
});

test('a new attempt after cancellation is not affected by the older completion',async()=>{
  const audio=createPlaybackAudio(),v=video();let played=0;
  const first=audio.play(v,{onPlaying:()=>played++});audio.cancel();
  const second=audio.play(v,{onPlaying:()=>played++});v.requests[0].resolve();
  assert.equal(await first,'stale');assert.equal(played,0);
  v.requests[1].resolve();assert.equal(await second,'playing');assert.equal(played,1);
});

test('a state callback canceling playback suppresses the fallback call',async()=>{
  let audio;audio=createPlaybackAudio({onChange:()=>audio.cancel()});
  const v=video(),pending=audio.play(v);v.requests[0].reject(denied());
  assert.equal(await pending,'stale');assert.equal(v.requests.length,1);
});

test('controller does not seek replace media pause or change volume',async()=>{
  const audio=createPlaybackAudio(),v=video();v.pause=()=>{throw Error('Pause belongs to the application');};
  const pending=audio.play(v);v.requests[0].resolve();await pending;audio.setEnabled(false);audio.cancel();
  assert.equal(v.currentTime,42);assert.equal(v.src,'original.mp4');assert.equal(v.volume,.7);
});
