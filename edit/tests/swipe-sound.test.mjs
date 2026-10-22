import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSwipeSound} from '../swipe-sound.js';

class Target {
  constructor({parent = null,tag = 'DIV',editable = false} = {}) {
    this.parentElement = parent;this.tagName = tag;this.isContentEditable = editable;
    this.listeners = new Map();this.options = [];
  }
  addEventListener(type,handler,options) {
    if (!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(handler);this.options.push({type,options});
  }
  removeEventListener(type,handler) {this.listeners.get(type)?.delete(handler);}
  emit(type,event = {}) {
    const input = {isTrusted:true,timeStamp:100,target:this,preventDefault() {assert.fail('Do not prevent input.');},stopPropagation() {assert.fail('Do not stop propagation.');},...event};
    for (const handler of [...(this.listeners.get(type) || [])]) handler(input);
    return input;
  }
  contains(target) {for (let node = target;node;node = node.parentElement) if (node === this) return true;return false;}
  closest() {
    for (let node = this;node;node = node.parentElement) if (['BUTTON','A','INPUT','SELECT','TEXTAREA'].includes(node.tagName) || node.isContentEditable) return node;
    return null;
  }
  count() {return [...this.listeners.values()].reduce((sum,list) => sum + list.size,0);}
}
function fixture() {
  const feed = new Target(),video = new Target({parent:feed,tag:'VIDEO'}),doc = Object.assign(new Target(),{hidden:false}),win = new Target();
  const calls = [],f = {feed,video,doc,win,calls,enabled:true};
  f.detector = createSwipeSound({feed,doc,win,canAttempt:() => f.enabled,onSwipe:event => calls.push(event)});
  f.point = (x = 100,y = 200,id = 7) => ({identifier:id,clientX:x,clientY:y});
  f.start = (options = {}) => feed.emit('touchstart',{target:video,touches:[f.point()],...options});
  f.move = (options = {}) => win.emit('touchmove',{target:video,touches:[f.point(102,160)],...options});
  f.end = (options = {}) => win.emit('touchend',{target:video,touches:[],changedTouches:[f.point(102,160)],...options});
  f.pointer = (type,options = {}) => (type === 'pointerdown' ? feed : win).emit(type,{target:video,pointerType:'mouse',pointerId:3,isPrimary:true,button:0,clientX:100,clientY:type === 'pointerdown' ? 200 : 160,...options});
  return f;
}

test('a vertical touch swipe calls back synchronously from its trusted touchend',() => {
  const f = fixture();f.start();f.move();assert.equal(f.calls.length,0);
  const event = f.end();assert.deepEqual(f.calls,[event]);assert.equal(event.isTrusted,true);
  f.end();assert.equal(f.calls.length,1);
});
test('video with button role remains an allowed start target, including upward and downward swipes',() => {
  for (const y of [188,212,80,330]) {
    const f = fixture();f.video.role = 'button';f.start();f.end({changedTouches:[f.point(100,y)]});assert.equal(f.calls.length,1);
  }
});
test('simple taps, subthreshold movement and predominantly horizontal motion do not unlock sound',() => {
  for (const [x,y] of [[100,200],[100,189],[140,190],[113,188]]) {
    const f = fixture();f.start();f.end({changedTouches:[f.point(x,y)]});assert.equal(f.calls.length,0);
  }
});
test('native scroll pointercancel does not cancel the independent touch stream or duplicate it',() => {
  const f = fixture();f.pointer('pointerdown',{pointerType:'touch'});f.start();f.move();
  f.win.emit('pointercancel',{pointerType:'touch',pointerId:7});f.end();
  f.pointer('pointerup',{pointerType:'touch'});assert.equal(f.calls.length,1);
});
test('touch coordinates must belong to the same single contact',() => {
  for (const action of [f => f.move({touches:[f.point(100,160,8)]}),
    f => f.move({touches:[f.point(),f.point(200,200,8)]}),
    f => f.win.emit('touchstart',{touches:[f.point(),f.point(200,200,8)]}),
    f => f.end({changedTouches:[f.point(100,160,8)]}),
    f => f.end({touches:[f.point(200,200,8)]})]) {
    const f = fixture();f.start();action(f);f.end();assert.equal(f.calls.length,0);
  }
  const f = fixture();f.start({touches:[f.point(),f.point(200,200,8)]});f.end();assert.equal(f.calls.length,0);
});
test('touch cancel, hidden document and page exit discard the gesture',() => {
  for (const cancel of [f => f.win.emit('touchcancel'),f => {f.doc.hidden = true;f.doc.emit('visibilitychange');f.doc.hidden = false;},f => f.win.emit('pagehide')]) {
    const f = fixture();f.start();cancel(f);f.end();assert.equal(f.calls.length,0);
  }
});
test('form controls, links, buttons, editable nodes and starts outside the feed are excluded',() => {
  for (const tag of ['BUTTON','A','INPUT','SELECT','TEXTAREA']) {
    const f = fixture(),control = new Target({parent:f.feed,tag}),child = new Target({parent:control});
    f.start({target:child});f.end();assert.equal(f.calls.length,0);
  }
  for (const targetType of ['editable','outside']) {
    const f = fixture(),target = new Target({parent:targetType === 'editable' ? f.feed : null,editable:targetType === 'editable'});
    f.start({target});f.end();assert.equal(f.calls.length,0);
  }
});
test('canAttempt is checked before tracking and rechecked when the gesture finishes',() => {
  const initial = fixture();initial.enabled = false;initial.start();initial.enabled = true;initial.end();assert.equal(initial.calls.length,0);
  const changed = fixture();changed.start();changed.enabled = false;changed.end();assert.equal(changed.calls.length,0);
  const hidden = fixture();hidden.start();hidden.doc.hidden = true;hidden.end();assert.equal(hidden.calls.length,0);
});
test('untrusted start or end cannot activate sound',() => {
  const start = fixture();start.start({isTrusted:false});start.end();assert.equal(start.calls.length,0);
  const end = fixture();end.start();end.end({isTrusted:false});assert.equal(end.calls.length,0);
});
test('mouse and pen drags call back at pointerup, without capture or input blocking',() => {
  for (const pointerType of ['mouse','pen']) {
    const f = fixture();f.pointer('pointerdown',{pointerType});f.pointer('pointermove',{pointerType});assert.equal(f.calls.length,0);
    const event = f.pointer('pointerup',{pointerType});assert.deepEqual(f.calls,[event]);
  }
});
test('pointer identity, primary button, cancellation and touch-pointer exclusions are respected',() => {
  for (const change of [{button:2},{isPrimary:false},{pointerType:'touch'},{isTrusted:false}]) {
    const f = fixture();f.pointer('pointerdown',change);f.pointer('pointerup');assert.equal(f.calls.length,0);
  }
  const id = fixture();id.pointer('pointerdown');id.pointer('pointerup',{pointerId:8});assert.equal(id.calls.length,0);
  id.pointer('pointerup');assert.equal(id.calls.length,1);
  const cancel = fixture();cancel.pointer('pointerdown');cancel.win.emit('pointercancel',{pointerType:'mouse',pointerId:3});cancel.pointer('pointerup');assert.equal(cancel.calls.length,0);
});
test('the compatibility click after sound unlock is consumed exactly once',() => {
  const f = fixture();f.start();f.end({timeStamp:300});
  const click = {type:'click',isTrusted:true,timeStamp:310,target:f.video};
  assert.equal(f.detector.consumeClick(click),true);assert.equal(f.detector.consumeClick(click),false);
});
test('a new gesture is not mistaken for the previous swipe compatibility click',() => {
  for (const start of [f => f.start(),f => f.pointer('pointerdown')]) {
    const f = fixture();f.start();f.end({timeStamp:300});start(f);
    assert.equal(f.detector.consumeClick({type:'click',isTrusted:true,timeStamp:350,target:f.video}),false);
  }
});
test('unrelated, old, synthetic or earlier clicks are never consumed',() => {
  for (const options of [{timeStamp:801},{timeStamp:299},{isTrusted:false},{target:new Target()}]) {
    const f = fixture();f.start();f.end({timeStamp:300});assert.equal(f.detector.consumeClick({type:'click',isTrusted:true,timeStamp:320,target:f.video,...options}),false);
  }
  const f = fixture();f.start();f.end({timeStamp:300});const sibling = new Target({parent:f.feed});
  assert.equal(f.detector.consumeClick({type:'click',isTrusted:true,timeStamp:350,target:sibling}),false);
});
test('keyboard activation is never mistaken for a swipe compatibility click',() => {
  const f = fixture();f.start();f.end({timeStamp:300});
  for (const key of [' ','Enter']) assert.equal(f.detector.consumeClick({type:'keydown',key,isTrusted:true,timeStamp:310,target:f.video}),false);
  assert.equal(f.detector.consumeClick({type:'click',isTrusted:true,timeStamp:320,target:f.video}),true);
});
test('only passive input listeners are used, and destroy removes them all',() => {
  const f = fixture();f.start();
  for (const target of [f.feed,f.doc,f.win]) for (const registration of target.options) assert.equal(registration.options.passive,true);
  f.detector.destroy();f.end();assert.equal(f.calls.length,0);
  for (const target of [f.feed,f.doc,f.win]) assert.equal(target.count(),0);
});
test('the detector has no media mutations, timers, network calls or scroll-based audio activation',async () => {
  const source = await readFile(new URL('../swipe-sound.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.(?:play|pause|load|scrollTo|dispatchEvent|preventDefault|stopPropagation|setPointerCapture)\s*\(/);
  assert.doesNotMatch(source,/\b(?:setTimeout|setInterval|queueMicrotask|requestAnimationFrame|fetch|await|muted|volume|currentTime)\b/);
  assert.doesNotMatch(source,/listen\([^\n]*['"](?:wheel|scroll)['"]/);
});
