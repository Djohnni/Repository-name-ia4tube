import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createSwipeGuide} from '../swipe-guide.js';
import {videoVisibilityRatio} from '../video-attention.js';

class Target {
  constructor() {this.listeners = new Map();this.options = [];}
  addEventListener(type,handler,options) {
    if (!this.listeners.has(type)) this.listeners.set(type,new Set());
    this.listeners.get(type).add(handler);this.options.push({type,options});
  }
  removeEventListener(type,handler) {this.listeners.get(type)?.delete(handler);}
  emit(type,event = {}) {for (const handler of [...(this.listeners.get(type) || [])]) handler(event);}
  count() {return [...this.listeners.values()].reduce((sum,set) => sum + set.size,0);}
}
function element() {
  const target = new Target(),classes = new Set(),properties = new Map();
  return Object.assign(target,{
    isConnected:true,hidden:true,classes,properties,
    classList:{add:name => classes.add(name),remove:name => classes.delete(name)},
    style:{setProperty:(name,value) => properties.set(name,value),removeProperty:name => properties.delete(name)},
  });
}
function fixture({height = 800,scrollTop = 0,reduced = false} = {}) {
  const feed = Object.assign(element(),{clientHeight:height,scrollTop}),hint = element(),scope = element();
  const doc = Object.assign(new Target(),{hidden:false}),win = new Target(),motion = Object.assign(new Target(),{matches:reduced});
  const cards = [element(),element(),element()],timers = new Map();let clock = 0,id = 0;
  const f = {feed,hint,scope,doc,win,motion,cards,timers,context:{current:cards[0],next:cards[1],enabled:true}};
  f.advance = ms => {
    const until = clock + ms;
    while (true) {
      const next = [...timers].filter(([,timer]) => timer.at <= until).sort((a,b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);clock = next[1].at;next[1].callback();
    }
    clock = until;
  };
  f.guide = createSwipeGuide({feed,hint,scope,doc,win,motionQuery:motion,getContext:() => f.context,
    setTimer(callback,delay) {const token = ++id;timers.set(token,{callback,at:clock + delay});return token;},
    clearTimer:token => timers.delete(token),
  });
  f.clean = () => {
    assert.equal(hint.hidden,true);assert.equal(hint.classes.has('is-active'),false);assert.equal(hint.classes.has('is-returning'),false);assert.equal(hint.properties.has('--swipe-guide-lift'),false);
    for (const card of cards) {assert.equal(card.classes.has('swipe-guide-card'),false);assert.equal(card.classes.has('is-returning'),false);assert.equal(card.properties.has('--swipe-guide-lift'),false);}
    assert.equal(timers.size,0);
  };
  return f;
}

test('intro starts after two seconds, lifts only current and next, and cleans after 1800ms',() => {
  const f = fixture();f.cards[0].classes.add('is-paused');f.guide.schedule();
  f.advance(1999);assert.equal(f.hint.hidden,true);assert.equal(f.cards[0].classes.has('swipe-guide-card'),false);
  f.advance(1);assert.equal(f.hint.hidden,false);assert.equal(f.hint.classes.has('is-active'),true);assert.equal(f.hint.properties.get('--swipe-guide-lift'),'36px');
  for (const card of f.cards.slice(0,2)) {assert.equal(card.classes.has('swipe-guide-card'),true);assert.equal(card.properties.get('--swipe-guide-lift'),'36px');}
  assert.equal(f.cards[2].classes.size,0);assert.equal(f.feed.scrollTop,0);
  f.advance(1099);assert.equal(f.hint.classes.has('is-returning'),false);
  f.advance(1);assert.equal(f.hint.classes.has('is-returning'),true);
  assert.equal(f.cards[0].classes.has('is-returning'),true);assert.equal(f.cards[1].classes.has('is-returning'),true);
  assert.equal(f.cards[2].classes.has('is-returning'),false);
  f.advance(699);assert.equal(f.hint.hidden,false);f.advance(1);f.clean();
  assert.equal(f.cards[0].classes.has('is-paused'),true,'Unrelated card state survives cleanup.');
  f.guide.schedule();f.advance(10000);f.clean();
});

test('repeated schedule calls do not restart the two-second delay or the running animation',() => {
  const f = fixture();f.guide.schedule();f.advance(1200);f.guide.schedule();
  assert.equal(f.timers.size,1);f.advance(800);assert.equal(f.hint.hidden,false);
  f.guide.schedule();assert.equal(f.timers.size,2);f.advance(1800);f.clean();
});

test('the hand initial style is established after unhiding and before activating its transition',() => {
  const f = fixture();let reads = 0;
  Object.defineProperty(f.hint,'offsetHeight',{get() {
    reads++;assert.equal(f.hint.hidden,false);assert.equal(f.hint.classes.has('is-active'),false);return 96;
  }});
  f.guide.schedule();f.advance(2000);assert.equal(reads,1);assert.equal(f.hint.classes.has('is-active'),true);
  f.advance(1800);f.clean();assert.equal(reads,1);
});

for (const type of ['pointerdown','touchstart','wheel','keydown','click']) {
  test(`${type} cancels before or during the cue without consuming the user input`,() => {
    for (const delay of [0,1200,2100,3200]) {
      const f = fixture();f.guide.schedule();f.advance(delay);
      let reached = false;f.scope.addEventListener(type,() => {reached = true;});
      f.scope.emit(type,{preventDefault() {assert.fail('Do not block the input.');},stopPropagation() {assert.fail('Do not block audio activation.');}});
      assert.equal(reached,true);f.clean();f.guide.schedule();f.advance(10000);f.clean();
      const listener = f.scope.options.find(entry => entry.type === type);
      assert.deepEqual(listener.options,{capture:true,passive:true});
    }
  });
}

test('interaction before any eligible schedule also consumes the page intro',() => {
  const f = fixture();f.context.enabled = false;f.scope.emit('pointerdown');f.context.enabled = true;
  f.guide.schedule();f.advance(5000);f.clean();
});

test('initial ineligible context does not arm but permits a later ready pair',() => {
  for (const change of [f => {f.context.enabled = false;},f => {f.context.current = null;},f => {f.context.next = null;},
    f => {f.context.next = f.cards[0];},f => {f.feed.clientHeight = 0;},f => {f.cards[0].isConnected = false;}]) {
    const f = fixture();change(f);f.guide.schedule();f.advance(5000);f.clean();
    f.context = {current:f.cards[0],next:f.cards[1],enabled:true};f.feed.clientHeight = 800;f.cards[0].isConnected = true;
    f.guide.schedule();f.advance(2000);assert.equal(f.hint.hidden,false);f.guide.destroy();f.clean();
  }
});

test('disabled profile or dialog context and a changed pair cancel pending and running cues',() => {
  for (const delay of [1000,2100]) for (const change of [f => {f.context.enabled = false;},
    f => {f.context.current = f.cards[1];f.context.next = f.cards[2];},f => {f.context.next = null;}]) {
    const f = fixture();f.guide.schedule();f.advance(delay);change(f);f.guide.schedule();f.clean();
    f.context = {current:f.cards[0],next:f.cards[1],enabled:true};f.guide.schedule();f.advance(5000);f.clean();
  }
});

test('the timer revalidates eligibility and card identity before showing anything',() => {
  for (const change of [f => {f.context.enabled = false;},f => {f.context.current = f.cards[2];},
    f => {f.context.next = f.cards[2];},f => {f.doc.hidden = true;},f => {f.motion.matches = true;}]) {
    const f = fixture();f.guide.schedule();change(f);f.advance(2000);f.clean();
  }
});

test('unchanged initial scroll events do not cancel while real scroll movement does',() => {
  const f = fixture({scrollTop:1800});f.guide.schedule();f.feed.emit('scroll');
  f.feed.scrollTop = 1801.5;f.feed.emit('scroll');f.advance(2000);assert.equal(f.hint.hidden,false);
  f.feed.scrollTop = 1802;f.feed.emit('scroll');f.clean();
  f.guide.schedule();f.advance(5000);f.clean();
});

test('movement without a scroll event is caught before the cue starts',() => {
  const f = fixture();f.guide.schedule();f.feed.scrollTop = 50;f.advance(2000);f.clean();
});

test('hidden document, route, resize and page exit cancel with no later restart',() => {
  for (const delay of [0,2100]) for (const action of [f => {f.doc.hidden = true;f.doc.emit('visibilitychange');},
    f => f.win.emit('hashchange'),f => f.win.emit('resize'),f => f.win.emit('pagehide')]) {
    const f = fixture();f.guide.schedule();f.advance(delay);action(f);f.clean();
    f.doc.hidden = false;f.guide.schedule();f.advance(6000);f.clean();
  }
});

test('visibilitychange while visible does not cancel an eligible cue',() => {
  const f = fixture();f.guide.schedule();f.doc.emit('visibilitychange');f.advance(2000);
  assert.equal(f.hint.hidden,false);f.guide.destroy();
});

test('reduced motion never arms and switching it on removes an active cue immediately',() => {
  const initial = fixture({reduced:true});initial.guide.schedule();initial.advance(6000);initial.clean();initial.guide.destroy();
  for (const delay of [0,2100]) {
    const f = fixture();f.guide.schedule();f.advance(delay);f.motion.matches = true;f.motion.emit('change');f.clean();
    f.motion.matches = false;f.motion.emit('change');f.guide.schedule();f.advance(6000);f.clean();
  }
});

test('destroy cancels all timers, clears only owned visual state and removes observers',() => {
  const f = fixture();f.guide.schedule();f.advance(2100);f.guide.destroy();f.clean();
  for (const target of [f.feed,f.scope,f.doc,f.win,f.motion]) assert.equal(target.count(),0);
  f.guide.schedule();f.advance(6000);f.clean();f.guide.destroy();f.clean();
});

test('lift stays below visibility and activation thresholds even in short viewports',() => {
  for (const height of [100,240,320,600,800,1400]) {
    const f = fixture({height});f.guide.schedule();f.advance(2000);
    const lift = Number.parseFloat(f.cards[0].properties.get('--swipe-guide-lift'));
    assert.equal(lift,Math.min(36,height * .06));
    const bounds = {top:0,left:0,right:400,bottom:height};
    const current = {...bounds,top:-lift,bottom:height - lift};
    const next = {...bounds,top:height - lift,bottom:height * 2 - lift};
    assert.ok(videoVisibilityRatio(current,bounds,bounds) > .9,'Current stays beyond every app activation threshold.');
    assert.ok(videoVisibilityRatio(next,bounds,bounds) < .1,'Next remains below every activation threshold and never counts as a view.');
    f.guide.destroy();
  }
});

test('guide contains no media, scrolling, storage or network side effects',async () => {
  const source = await readFile(new URL('../swipe-guide.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.(?:play|pause|load|scrollTo|scrollIntoView|dispatchEvent)\s*\(/);
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|currentTime|muted|volume)\b/);
  assert.doesNotMatch(source,/scrollTop\s*=/);
});
