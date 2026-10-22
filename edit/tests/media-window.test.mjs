import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaWindow} from '../media-window.js';
import {createPlaybackAudio} from '../playback-audio.js';

function video(index,history = []) {
  const attributes = new Map(),listeners = new Map(),writes = [];
  let position = 0;
  const v = {
    id:index,dataset:{src:`/videos/${index}.mp4`,poster:`/posters/${index}.webp`},
    preload:'none',readyState:0,duration:30,paused:true,loads:0,pauses:0,writes,attributes,listeners,
    getAttribute:name => attributes.get(name) ?? null,
    setAttribute(name,value) {attributes.set(name,value);history.push([index,'set',name,value]);},
    removeAttribute(name) {attributes.delete(name);history.push([index,'remove',name]);},
    addEventListener(type,handler) {
      if (!listeners.has(type)) listeners.set(type,new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type,handler) {listeners.get(type)?.delete(handler);},
    emit(type) {for (const handler of [...(listeners.get(type) || [])]) handler();},
    pause() {this.pauses++;this.paused = true;history.push([index,'pause']);},
    load() {this.loads++;position = 0;this.readyState = 0;history.push([index,'load']);},
    play() {throw new Error('Playback belongs to the application');},
    metadata(duration = 30) {this.readyState = 1;this.duration = duration;this.emit('loadedmetadata');},
    progress(next) {position = next;},
  };
  Object.defineProperties(v,{
    currentTime:{get:() => position,set:next => {
      if (v.seekBlocked) throw new Error('Metadata temporarily unavailable');
      writes.push(next);position = next;
    }},
    muted:{get:() => false,set() {throw new Error('Do not modify audio preference');}},
    volume:{get:() => .7,set() {throw new Error('Do not modify volume');}},
  });
  return v;
}

function fixture(count = 31) {
  const history = [],videos = Array.from({length:count},(_,index) => video(index,history)),cancelled = [];
  const controller = createMediaWindow({cancel:v => {cancelled.push(v);history.push([v.id,'cancel']);}});
  const loaded = () => videos.filter(v => v.getAttribute('src') !== null);
  return {videos,history,cancelled,controller,loaded};
}

test('a catalog larger than 28 videos holds at most the active video and its two neighbors',() => {
  const f = fixture();
  f.controller.sync(f.videos,0);
  assert.deepEqual(f.loaded().map(v => v.id),[0,1]);
  assert.equal(f.videos[0].preload,'auto');assert.equal(f.videos[1].preload,'metadata');
  for (let index = 1; index < f.videos.length; index++) {
    f.controller.sync(f.videos,index);
    assert.ok(f.loaded().length <= 3);
    assert.deepEqual(f.loaded().map(v => v.id),[index - 1,index,index + 1].filter(i => i < f.videos.length));
    assert.equal(f.videos[index].preload,'auto');
    for (const v of f.videos) {
      if (Math.abs(v.id - index) <= 1) {
        assert.equal(v.getAttribute('src'),v.dataset.src);assert.equal(v.getAttribute('poster'),v.dataset.poster);
      } else {
        assert.equal(v.getAttribute('src'),null);assert.equal(v.getAttribute('poster'),null);assert.equal(v.preload,'none');
      }
    }
  }
});

test('a large jump cancels and releases the old window before acquiring the new window',() => {
  const f = fixture();f.controller.sync(f.videos,1);f.history.length = 0;f.controller.sync(f.videos,20);
  assert.deepEqual(f.loaded().map(v => v.id),[19,20,21]);
  const firstAcquire = f.history.findIndex(entry => entry[1] === 'set' && entry[2] === 'src');
  for (const index of [0,1,2]) {
    const actions = f.history.filter(entry => entry[0] === index).map(entry => entry[1]);
    assert.deepEqual(actions,['cancel','pause','remove','remove','load']);
    assert.ok(f.history.findIndex(entry => entry[0] === index && entry[1] === 'load') < firstAcquire);
  }
});

test('repeated sync does not reload, seek, cancel or pause resident or unloaded videos',() => {
  const f = fixture();f.controller.sync(f.videos,10);f.history.length = 0;
  for (let i = 0; i < 5; i++) f.controller.sync(f.videos,10);
  assert.deepEqual(f.history,[]);assert.equal(f.cancelled.length,0);
  assert.ok(f.videos.every(v => v.writes.length === 0 && v.pauses === 0));
  f.controller.sync(f.videos,11);
  assert.equal(f.videos[10].loads,1);assert.equal(f.videos[10].preload,'metadata');
  assert.equal(f.videos[11].loads,1);assert.equal(f.videos[11].preload,'auto');
});

test('hidden or profile state unloads every resource and remains inert on repeated sync',() => {
  const f = fixture();f.controller.sync(f.videos,10);f.controller.sync(f.videos,10,{visible:false});
  assert.equal(f.loaded().length,0);assert.equal(f.cancelled.length,3);
  assert.ok(f.videos.every(v => v.preload === 'none' && v.getAttribute('poster') === null));
  const historyLength = f.history.length;f.controller.sync(f.videos,10,{visible:false});
  assert.equal(f.history.length,historyLength);
  f.controller.sync(f.videos,10);assert.deepEqual(f.loaded().map(v => v.id),[9,10,11]);
});

test('currentTime is saved before unload and restored only after metadata becomes available',() => {
  const f = fixture();const current = f.videos[5];f.controller.sync(f.videos,5);
  current.metadata();current.progress(12.75);f.controller.sync(f.videos,20);
  assert.equal(current.currentTime,0);f.controller.sync(f.videos,5);
  assert.equal(current.currentTime,0);assert.deepEqual(current.writes,[]);
  current.metadata();assert.equal(current.currentTime,12.75);assert.deepEqual(current.writes,[12.75]);
  assert.equal(current.listeners.get('loadedmetadata').size,0);
  current.metadata();f.controller.sync(f.videos,5);assert.deepEqual(current.writes,[12.75]);
});

test('restored currentTime is clamped to a shorter duration without changing audio preferences',() => {
  const f = fixture(),current = f.videos[5];f.controller.sync(f.videos,5);
  current.metadata();current.progress(25);f.controller.sync(f.videos,5,{visible:false});f.controller.sync(f.videos,5);
  current.metadata(10);assert.equal(current.currentTime,10);
  assert.equal(current.muted,false);assert.equal(current.volume,.7);
});

test('unloading before pending metadata retains the saved position for the next return',() => {
  const f = fixture(),current = f.videos[5];f.controller.sync(f.videos,5);current.metadata();current.progress(9);
  f.controller.sync(f.videos,20);f.controller.sync(f.videos,5);
  const stale = [...current.listeners.get('loadedmetadata')][0];
  f.controller.sync(f.videos,20);current.readyState = 1;stale();
  assert.deepEqual(current.writes,[]);assert.equal(current.listeners.get('loadedmetadata').size,0);
  f.controller.sync(f.videos,5);current.metadata();assert.deepEqual(current.writes,[9]);
});

test('stale metadata callbacks cannot seek after clear, replacement, or a newer generation',() => {
  const f = fixture(),current = f.videos[5];f.controller.sync(f.videos,5);current.metadata();current.progress(8);
  f.controller.sync(f.videos,20);f.controller.sync(f.videos,5);
  const stale = [...current.listeners.get('loadedmetadata')][0];
  f.controller.clear();current.readyState = 1;stale();assert.deepEqual(current.writes,[]);
  f.controller.sync(f.videos,5);current.readyState = 1;stale();assert.deepEqual(current.writes,[]);
  current.metadata();assert.deepEqual(current.writes,[8]);
});

test('changing the source on the same element cancels the old media and does not restore another file position',() => {
  const f = fixture(),current = f.videos[5];f.controller.sync(f.videos,5);current.metadata();current.progress(7);
  f.controller.sync(f.videos,20);f.controller.sync(f.videos,5);
  const stale = [...current.listeners.get('loadedmetadata')][0];
  current.dataset.src = '/videos/replacement.mp4';f.controller.sync(f.videos,5);
  assert.equal(current.getAttribute('src'),'/videos/replacement.mp4');
  current.metadata();stale();assert.equal(current.currentTime,0);assert.deepEqual(current.writes,[]);
});

test('replacing a carousel unloads removed elements and starts only the new active window',() => {
  const f = fixture();f.controller.sync(f.videos,15);
  const replacement = [video('new-0',f.history),video('new-1',f.history),video('new-2',f.history),video('new-3',f.history)];
  f.controller.sync(replacement,0);assert.equal(f.loaded().length,0);
  assert.deepEqual(replacement.filter(v => v.getAttribute('src')).map(v => v.id),['new-0','new-1']);
  f.controller.clear();assert.ok(replacement.every(v => v.getAttribute('src') === null));
});

test('invalid indices, empty inputs and invalid items release resources without selecting an arbitrary video',() => {
  for (const index of [-1,31,NaN,Infinity,1.5,'1',undefined]) {
    const f = fixture();f.controller.sync(f.videos,10);f.controller.sync(f.videos,index);
    assert.equal(f.loaded().length,0,String(index));
  }
  const f = fixture();f.controller.sync(f.videos,10);f.controller.sync(null,0);assert.equal(f.loaded().length,0);
  assert.doesNotThrow(() => f.controller.sync([null,{},false],1));
  assert.doesNotThrow(() => f.controller.sync({[Symbol.iterator]() {throw new Error('Detached collection');}},0));
});

test('clear is idempotent, removes pending restores and permits a later reuse of the same media',() => {
  const f = fixture(),current = f.videos[5];f.controller.sync(f.videos,5);current.metadata();current.progress(6);
  f.controller.clear();assert.equal(f.loaded().length,0);
  const loads = f.videos.map(v => v.loads);f.controller.clear();assert.deepEqual(f.videos.map(v => v.loads),loads);
  f.controller.sync(f.videos,5);current.metadata();assert.equal(current.currentTime,6);
  f.controller.clear();assert.ok(f.videos.every(v => !v.listeners.get('loadedmetadata')?.size));
});

test('cancel invalidates pending playback before pause and resource release even if cancellation throws',() => {
  const history = [],current = video(0,history);let attempt = 'pending';
  const controller = createMediaWindow({cancel() {attempt = 'stale';history.push([0,'cancel']);throw new Error('Callback unavailable');}});
  controller.sync([current],0);history.length = 0;controller.clear();
  assert.equal(attempt,'stale');assert.deepEqual(history.map(entry => entry[1]),['cancel','pause','remove','remove','load']);
  assert.equal(current.getAttribute('src'),null);assert.equal(current.preload,'none');
});

test('unload invalidates a real pending playback request so its rejection cannot start a muted fallback',async() => {
  // Writable audio properties here belong to the application's playback controller.
  const current = {...video(0)},audio = createPlaybackAudio();let reject,requests = 0;
  current.play = () => {requests++;return new Promise((resolve,fail) => {reject = fail;});};
  const controller = createMediaWindow({cancel:v => audio.cancel(v)});
  controller.sync([current],0);const pending = audio.play(current);
  controller.clear();reject(Object.assign(new Error('Aborted during release'),{name:'NotAllowedError'}));
  assert.equal(await pending,'stale');assert.equal(requests,1);
  assert.equal(current.getAttribute('src'),null);assert.equal(audio.getState().blocked,false);
});

test('custom source/poster callbacks are supported and poster-only changes never reload a video',() => {
  const current = video(0);let cover = '/covers/first.webp';
  const controller = createMediaWindow({source:() => '/custom/video.mp4',poster:() => cover});
  controller.sync([current],0);assert.equal(current.getAttribute('src'),'/custom/video.mp4');
  assert.equal(current.getAttribute('poster'),cover);cover = '/covers/second.webp';controller.sync([current],0);
  assert.equal(current.getAttribute('poster'),cover);assert.equal(current.loads,1);
  cover = '';controller.sync([current],0);assert.equal(current.getAttribute('poster'),null);assert.equal(current.loads,1);
});

test('missing or throwing sources never install an empty src and duplicate elements remain bounded',() => {
  const current = video(0);current.dataset.src = '';const controller = createMediaWindow();
  controller.sync([current],0);assert.equal(current.getAttribute('src'),null);assert.equal(current.loads,0);
  const broken = createMediaWindow({source() {throw new Error('Missing catalog item');}});
  assert.doesNotThrow(() => broken.sync([current],0));assert.equal(current.loads,0);
  current.dataset.src = '/videos/0.mp4';controller.sync([current,current,current],1);
  assert.equal(current.loads,1);assert.equal(current.preload,'auto');
});

test('a failed restore can retry on the next metadata event without loading the source again',() => {
  const current = video(0),controller = createMediaWindow();controller.sync([current],0);current.progress(5);
  controller.sync([current],0,{visible:false});controller.sync([current],0);current.seekBlocked = true;current.metadata();
  assert.equal(current.currentTime,0);
  assert.equal(current.listeners.get('loadedmetadata').size,1);
  current.seekBlocked = false;current.metadata();assert.equal(current.currentTime,5);
  assert.equal(current.listeners.get('loadedmetadata').size,0);assert.equal(current.loads,3);
});
