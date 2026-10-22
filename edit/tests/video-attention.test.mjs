import test from 'node:test';
import assert from 'node:assert/strict';
import {installVideoAttention,createVideoAttentionTracker,videoVisibilityRatio} from '../video-attention.js';

class Target {
  constructor() {this.listeners = new Map();}
  addEventListener(type,handler) {
    if (!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type,handler) {this.listeners.get(type)?.delete(handler);}
  emit(type,event = {}) {for (const handler of this.listeners.get(type) || []) handler(event);}
  listenerCount() {return [...this.listeners.values()].reduce((sum,handlers) => sum + handlers.size,0);}
}
const rect = (top = 0,bottom = 100,left = 0,right = 100) => ({top,bottom,left,right});
class Element extends Target {
  constructor(id,tagName = 'DIV') {
    super();this.id = id;this.tagName = tagName;this.hidden = false;this.open = false;
    this.dataset = {};this.bounds = rect();this.style = {};
  }
  getBoundingClientRect() {return this.bounds;}
  querySelector(selector) {assert.equal(selector,'video');return this.video || null;}
  matches() {return this.isCard || this.tagName === 'VIDEO';}
}

function fixture({initial = 0} = {}) {
  let clock = 0,queries = 0,sequence = 0;
  const timers = new Map(),events = [],mutations = [],intersections = [];
  const view = new Element('feed-view'),feed = new Element('feed');
  const personalize = new Element('personalize-dialog','DIALOG'),about = new Element('about-dialog','DIALOG');
  const cards = ['first','second','third'].map((id,index) => {
    const card = new Element(id,'ARTICLE');card.isCard = true;
    card.dataset = {id,title:`Modelo ${index + 1}`,recipe:'sextou'};
    card.bounds = rect((index - initial) * 100,(index - initial + 1) * 100);
    const video = new Element('', 'VIDEO');card.video = video;
    Object.assign(video,{currentTime:0,duration:30,playbackRate:1,paused:false,ended:false,readyState:4,seeking:false,loop:true});
    video.closest = selector => {assert.equal(selector,'#feed .video-card');return card;};
    video.play = video.pause = () => {throw new Error('Measurement must not control playback');};
    return card;
  });
  feed.querySelectorAll = selector => {assert.equal(selector,'.video-card');return cards;};
  const doc = new Target();Object.assign(doc,{hidden:false,documentElement:new Element('html'),body:new Element('body')});
  doc.querySelector = selector => {
    queries++;
    const elements = {'#feed-view':view,'#feed':feed,'#personalize-dialog':personalize,'#about-dialog':about};
    assert.ok(selector in elements,'Only public visibility elements may be read: ' + selector);
    return elements[selector];
  };
  const win = new Target();Object.assign(win,{
    innerWidth:100,innerHeight:100,performance:{now:() => clock},
    getComputedStyle:element => element.style,
    setInterval(callback,delay) {assert.equal(delay,1000);timers.set(++sequence,callback);return sequence;},
    clearInterval:handle => timers.delete(handle),
    MutationObserver:class {
      constructor(callback) {this.callback = callback;this.connected = false;mutations.push(this);}
      observe() {this.connected = true;}
      disconnect() {this.connected = false;}
    },
    IntersectionObserver:class {
      constructor(callback) {this.callback = callback;this.cards = new Set();intersections.push(this);}
      observe(card) {this.cards.add(card);}
      disconnect() {this.cards.clear();}
    },
  });
  Object.defineProperty(win,'location',{get() {throw new Error('Do not read URL/deep-link/customer data');}});
  const controller = installVideoAttention({win,doc,send:(name,detail) => events.push({name,detail})});
  const f = {win,doc,view,feed,personalize,about,cards,events,timers,mutations,intersections,controller,
    queries:() => queries,now:() => clock,
    grant:() => controller.setConsent('granted'),deny:() => controller.setConsent('denied'),
    matching:name => events.filter(event => event.name === name).map(event => event.detail),
    mutate(target = view) {for (const observer of mutations) if (observer.connected) observer.callback([{target}]);},
    media(index,type) {doc.emit(type,{target:cards[index].video});},
    select(index) {
      cards.forEach((card,i) => {card.bounds = rect((i - index) * 100,(i - index + 1) * 100);});
      doc.emit('scroll');
    },
    step(seconds = 1,{sample = true,move = true} = {}) {
      clock += seconds * 1000;
      if (move) for (const {video} of cards) {
        if (video.paused || video.seeking || video.readyState < 3) continue;
        video.currentTime += seconds * video.playbackRate;
        if (video.loop) video.currentTime %= video.duration;
      }
      if (sample) for (const callback of timers.values()) callback();
    },
    tick(count) {for (let i = 0; i < count; i++) f.step();},
    hide() {doc.hidden = true;doc.emit('visibilitychange');},
    show() {doc.hidden = false;doc.emit('visibilitychange');},
  };
  return f;
}

test('no DOM, timers, observers, listeners, collection or retroactive events before consent',() => {
  const f = fixture();f.step(30);f.deny();
  assert.equal(f.queries(),0);assert.equal(f.timers.size,0);assert.equal(f.mutations.length,0);
  assert.equal(f.doc.listenerCount() + f.win.listenerCount(),0);assert.deepEqual(f.events,[]);
  f.grant();f.step();assert.deepEqual(f.events,[]);f.step();
  assert.equal(f.matching('edit_video_view').length,1);
  f.hide();assert.equal(f.matching('edit_video_time')[0].visibleSeconds,2);
});

test('initial deep-link measures the card actually visible, without reading a URL',() => {
  const f = fixture({initial:1});f.cards[1].video.currentTime = 7;f.grant();f.tick(2);
  assert.deepEqual(f.matching('edit_video_view'),[{
    videoId:'second',videoTitle:'Modelo 2',recipe:'sextou',feedPosition:2,videoPositionSeconds:9,
  }]);
  assert.equal(f.timers.size,1);assert.equal(f.intersections[0].cards.size,3);
});

test('visibility uses card area clipped by the feed and viewport, with a 65 percent threshold',() => {
  assert.equal(videoVisibilityRatio(rect(),rect(0,65),rect()),.65);
  assert.equal(videoVisibilityRatio(rect(),rect(),rect(0,100,0,50)),.5);
  assert.equal(videoVisibilityRatio(rect(),rect(101,201),rect()),0);
  assert.equal(videoVisibilityRatio(rect(0,0),rect(),rect()),0);
  const f = fixture();f.feed.bounds = rect(0,64);f.grant();f.tick(3);assert.deepEqual(f.events,[]);
  f.feed.bounds = rect(0,65);f.win.emit('resize');f.tick(2);
  assert.equal(f.matching('edit_video_view').length,1);
  f.feed.bounds = rect(0,64);f.win.emit('resize');
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,2);
});

test('dwell requires two seconds in the same stop, including while paused',() => {
  const f = fixture();f.cards[0].video.paused = true;f.grant();f.step(1.5);
  assert.deepEqual(f.events,[]);f.select(1);
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,1.5);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,0);
  assert.equal(f.matching('edit_video_time')[0].reason,'switch');
  f.step(1.5);f.select(0);f.step(1.5);
  assert.equal(f.matching('edit_video_view').length,0,'returning must start a new dwell');
  f.step(.5);assert.equal(f.matching('edit_video_view').length,1);
  f.tick(3);assert.equal(f.matching('edit_video_view').length,1,'pause does not create duplicate views');
  f.hide();assert.equal(f.matching('edit_video_time').at(-1).watchSeconds,0);
});

test('a play request, a static currentTime and buffering do not count as watched seconds',() => {
  const f = fixture(),video = f.cards[0].video;video.paused = true;f.grant();
  video.paused = false;f.doc.emit('play',{target:video});
  f.step(1,{move:false});f.step(1,{move:false});
  video.readyState = 2;f.media(0,'waiting');f.tick(2);
  video.readyState = 4;f.step(1,{move:false});
  f.media(0,'playing');f.tick(2);f.hide();
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,7);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,2);
});

test('pause keeps visible time running but watch time stops until playback really resumes',() => {
  const f = fixture(),video = f.cards[0].video;f.grant();f.tick(2);
  video.paused = true;f.media(0,'pause');f.tick(3);
  video.paused = false;f.media(0,'playing');f.tick(2);f.hide();
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,7);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,4);
});

test('loops count real progress across the end and playback rate counts elapsed watch time',() => {
  const f = fixture(),video = f.cards[0].video;video.duration = 3.5;video.currentTime = 3;f.grant();f.tick(4);
  video.playbackRate = 2;f.media(0,'ratechange');f.tick(3);f.hide();
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,7);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,7);
  assert.equal(f.matching('edit_video_time')[0].videoPositionSeconds,2.5);
});

test('seeks and implausible media jumps never become watched duration',() => {
  const f = fixture(),video = f.cards[0].video;f.grant();f.step();
  video.seeking = true;f.media(0,'seeking');video.currentTime = 20;f.step(1,{move:false});
  video.seeking = false;f.media(0,'seeked');f.media(0,'playing');f.step();
  video.currentTime = 28;f.step(1,{move:false});f.hide();
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,4);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,2);
});

test('heartbeat and final flush send only incremental durations, never view/last totals',() => {
  const f = fixture();f.grant();f.tick(23);f.hide();
  const times = f.matching('edit_video_time');
  assert.deepEqual(times.map(event => event.visibleSeconds),[10,10,3]);
  assert.deepEqual(times.map(event => event.watchSeconds),[10,10,3]);
  assert.deepEqual(times.map(event => event.reason),['heartbeat','heartbeat','page_hidden']);
  assert.equal(f.matching('edit_video_view').length,1);
  assert.equal(f.matching('edit_video_last').length,1);
  for (const {name,detail} of f.events) {
    assert.ok(name.length <= 40);
    if (name !== 'edit_video_time') assert.ok(!('visibleSeconds' in detail) && !('watchSeconds' in detail));
  }
});

test('hidden flush plus pagehide are deduplicated and a later visible visit starts fresh',() => {
  const f = fixture();f.grant();f.tick(2);f.hide();f.win.emit('pagehide');f.step(120);
  assert.equal(f.matching('edit_video_time').length,1);assert.equal(f.matching('edit_video_last').length,1);
  assert.equal(f.matching('edit_video_last')[0].reason,'page_hidden');
  f.doc.hidden = false;f.win.emit('pageshow');f.tick(2);f.hide();
  assert.deepEqual(f.matching('edit_video_time').map(event => event.visibleSeconds),[2,2]);
  assert.equal(f.matching('edit_video_view').length,2);assert.equal(f.matching('edit_video_last').length,2);
});

test('page exit samples the outgoing media frame, then suppresses subsequent callbacks',() => {
  const f = fixture();f.grant();f.tick(2);f.step(.4,{sample:false});f.win.emit('pagehide');
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,2.4);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,2.4);
  assert.equal(f.matching('edit_video_last')[0].videoPositionSeconds,2.4);
  assert.equal(f.matching('edit_video_last')[0].reason,'page_exit');
  f.tick(5);f.hide();assert.equal(f.matching('edit_video_last').length,1);
});

test('profile and both open dialogs flush attention and never count their dwell time',() => {
  const f = fixture();f.grant();f.tick(2);f.view.hidden = true;f.mutate();f.tick(15);
  assert.equal(f.matching('edit_video_time')[0].reason,'profile');
  f.view.hidden = false;f.mutate();f.tick(2);f.personalize.open = true;f.mutate(f.personalize);f.tick(15);
  f.personalize.open = false;f.mutate(f.personalize);f.tick(2);f.about.open = true;f.mutate(f.about);f.tick(15);
  assert.deepEqual(f.matching('edit_video_time').map(event => [event.visibleSeconds,event.reason]),[
    [2,'profile'],[2,'modal'],[2,'modal'],
  ]);
  f.hide();assert.equal(f.matching('edit_video_last')[0].videoId,'first');
});

test('long delayed callbacks do not accrue a suspended interval as visible or watched time',() => {
  const f = fixture();f.grant();f.step();f.step(60);f.step();f.hide();
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,2);
  assert.equal(f.matching('edit_video_time')[0].watchSeconds,2);
});

test('revocation discards unsent state and detaches every observer listener and timer',() => {
  const f = fixture();f.grant();f.step(1.5);f.deny();
  assert.deepEqual(f.events,[]);assert.equal(f.timers.size,0);
  assert.equal(f.doc.listenerCount() + f.win.listenerCount(),0);
  assert.ok(f.mutations.every(observer => !observer.connected));
  assert.ok(f.intersections.every(observer => observer.cards.size === 0));
  const queryCount = f.queries();f.tick(20);f.hide();f.win.emit('pagehide');f.select(1);
  assert.equal(f.queries(),queryCount);assert.deepEqual(f.events,[]);
  f.doc.hidden = false;f.grant();f.step();assert.deepEqual(f.events,[]);
  f.step();f.hide();assert.equal(f.matching('edit_video_view')[0].videoId,'second');
  assert.equal(f.matching('edit_video_time')[0].visibleSeconds,2);
  assert.equal(f.intersections.at(-1).cards.size,3);
});

test('duplicate installations and repeated grants share a single set of listeners and events',() => {
  const f = fixture();f.grant();const listeners = f.doc.listenerCount() + f.win.listenerCount();
  const again = installVideoAttention({win:f.win,doc:f.doc,send() {throw new Error('Duplicate callback');}});
  assert.equal(again,f.controller);again.setConsent('granted');f.grant();f.tick(2);
  assert.equal(f.timers.size,1);assert.equal(f.doc.listenerCount() + f.win.listenerCount(),listeners);
  assert.equal(f.matching('edit_video_view').length,1);
});

test('revocation after a heartbeat does not flush its pending tail or replay it on regrant',() => {
  const f = fixture();f.grant();f.tick(12);
  assert.deepEqual(f.matching('edit_video_time').map(event => event.visibleSeconds),[10]);
  f.deny();f.tick(30);f.hide();
  assert.equal(f.matching('edit_video_time').length,1);assert.equal(f.matching('edit_video_last').length,0);
  f.doc.hidden = false;f.grant();f.tick(2);f.hide();
  assert.deepEqual(f.matching('edit_video_time').map(event => event.visibleSeconds),[10,2]);
  assert.equal(f.matching('edit_video_view').length,2);
});

test('zero elapsed time and sub-millisecond stops do not emit zero-duration events',() => {
  const f = fixture();f.grant();f.win.emit('pagehide');assert.deepEqual(f.events,[]);
  f.win.emit('pageshow');f.step(.0001,{sample:false});f.hide();assert.deepEqual(f.events,[]);
});

test('progress-bar and order-field mutations are ignored, while relevant visibility changes are sampled',() => {
  const f = fixture();f.grant();const before = f.queries();
  f.mutate(new Element('progress'));f.mutate(new Element('customer-name'));
  assert.equal(f.queries(),before);
  f.cards[0].style.visibility = 'hidden';f.mutate(f.cards[0]);f.tick(3);assert.deepEqual(f.events,[]);
  f.cards[0].style.visibility = 'visible';f.mutate(f.cards[0]);f.tick(2);
  assert.equal(f.matching('edit_video_view').length,1);
});

test('missing or blocked DOM and throwing analytics do not escape into application events',() => {
  const f = fixture();f.doc.querySelector = () => {throw new Error('DOM not available');};
  assert.doesNotThrow(() => f.grant());assert.doesNotThrow(() => f.tick(2));assert.doesNotThrow(() => f.deny());
  const tracker = createVideoAttentionTracker({send() {throw new Error('Analytics unavailable');}});
  const video = {key:'a',videoId:'a',videoTitle:'Modelo 1',recipe:'sextou',feedPosition:1,
    position:0,duration:30,playbackRate:1,loop:true,readyState:4,playing:true,seeking:false};
  tracker.observe({now:0,video});
  assert.doesNotThrow(() => tracker.observe({now:2000,video:{...video,position:2}}));
  assert.doesNotThrow(() => tracker.suspend({now:2000,reason:'page_exit'}));
});
