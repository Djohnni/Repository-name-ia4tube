import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {createPlaybackAudio} from '../playback-audio.js';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const source = name => {
  const result = app.match(new RegExp('function ' + name + '\\([^\\n]*\\) \\{[^\\n]*\\}'))?.[0] ||
    app.match(new RegExp('function ' + name + '[\\s\\S]*?\\n\\}'))?.[0];
  assert.ok(result,name);
  return result;
};
function harness(initial) {
  let state = {...initial};
  const events = [];
  const videos = [{muted:true},{muted:true}];
  const buttons = videos.map(() => ({innerHTML:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;}}));
  const context = {
    soundEnabled:true,videos,
    icon:name => '<svg data-icon="' + name + '"></svg>',
    document:{querySelectorAll(selector){assert.equal(selector,'.sound-toggle');return buttons;}},
    playbackAudio:{
      getState:() => state,
      setEnabled(enabled){events.push(['preference',enabled]);state={enabled,blocked:false,audible:enabled};context.syncSound(state);},
    },
    playback(){events.push(['playback']);},
  };
  runInNewContext(source('syncSound') + '\n' + source('toggleSound'),context);
  return {context,videos,buttons,events};
}

test('page requests sound by default and calls the isolated playback controller',() => {
  assert.match(app,/soundEnabled = true/);
  assert.match(app,/createPlaybackAudio\(\{onChange:syncSound\}\)/);
  assert.match(source('playback'),/playbackAudio\.play\(video,/);
});

test('audible state has an honest mute action and no extra hint',() => {
  const {context,videos,buttons}=harness({enabled:true,blocked:false,audible:true});
  context.syncSound();
  assert.equal(context.soundEnabled,true);
  for(const video of videos) assert.equal(video.muted,false);
  for(const button of buttons) {
    assert.equal(button.attributes['aria-label'],'Desativar som');
    assert.equal(button.attributes['aria-pressed'],'true');
    assert.doesNotMatch(button.innerHTML,/Toque para ouvir/);
  }
});

test('blocked autoplay presents a truthful unmute action and tap hint',() => {
  const {context,videos,buttons}=harness({enabled:true,blocked:true,audible:false});
  context.syncSound();
  for(const video of videos) assert.equal(video.muted,true);
  for(const button of buttons) {
    assert.equal(button.attributes['aria-label'],'Ativar som');
    assert.equal(button.attributes['aria-pressed'],'false');
    assert.match(button.innerHTML,/Toque para ouvir/);
  }
});

test('explicit mute never presents a misleading blocked-browser prompt',() => {
  const {context,buttons}=harness({enabled:false,blocked:false,audible:false});
  context.syncSound();
  for(const button of buttons) assert.doesNotMatch(button.innerHTML,/Toque para ouvir/);
});

test('tapping a blocked sound button enables and plays in the same call stack',() => {
  const {context,events,videos}=harness({enabled:true,blocked:true,audible:false});
  context.toggleSound();
  assert.deepEqual(events,[['preference',true],['playback']]);
  assert.ok(videos.every(video=>video.muted===false));
});

test('tapping an audible sound button mutes without changing the timeline',() => {
  const {context,events,videos}=harness({enabled:true,blocked:false,audible:true});
  for(const video of videos) Object.defineProperty(video,'currentTime',{set(){assert.fail('Do not rewind.');}});
  context.toggleSound();
  assert.deepEqual(events,[['preference',false],['playback']]);
  assert.ok(videos.every(video=>video.muted===true));
});

test('pause and feed replacement cancel outstanding audio playback attempts',() => {
  assert.match(source('playback'),/playbackAudio\.cancel\(video\);video\.pause\(\)/);
  assert.match(source('playback'),/isCurrent:\(\) => videos\[activeIndex\] === video && canPlay\(\)/);
  assert.match(source('renderFeed'),/playbackAudio\.cancel\(video\);video\.pause\(\)/);
});

const flush = async () => {for (let i = 0;i < 8;i++) await Promise.resolve();};
const denied = () => Object.assign(new Error('A gesture is required'),{name:'NotAllowedError'});
function tapHarness() {
  const requests = [],pauses = [];
  const video = {
    muted:true,paused:true,currentTime:5,src:'original.mp4',volume:.7,
    play() {
      let resolve,reject;
      const promise = new Promise((yes,no) => {resolve = () => {this.paused = false;yes();};reject = no;});
      requests.push({muted:this.muted,resolve,reject});
      return promise;
    },
    pause() {pauses.push(true);this.paused = true;},
  };
  const context = {
    videos:[video],activeIndex:0,userPaused:false,routeIsProfile:false,videoOnly:false,
    swipeGuide:{cancel() {},schedule() {}},
    personalize:{open:false},about:{open:false},
    document:{hidden:false,dispatchEvent() {}},Event:class {},
    playbackAudio:createPlaybackAudio(),mediaWindow:{sync() {}},tick() {},
    activeCard() {return {};},syncPlayButton() {},
  };
  runInNewContext(['canPlay','playback','togglePlay','activateVideo','handleVideoKeydown'].map(source).join('\n'),context);
  const event = overrides => ({currentTarget:video,preventDefault() {},...overrides});
  async function blockAutoplay() {
    context.playback();
    requests[0].reject(denied());await flush();
    requests[1].resolve();await flush();
    assert.equal(context.playbackAudio.getState().blocked,true);
  }
  return {context,video,requests,pauses,event,blockAutoplay};
}

test('first tap on a blocked video requests audible playback synchronously without pause or seek',async () => {
  const h = tapHarness();await h.blockAutoplay();
  h.context.activateVideo(h.event());
  assert.equal(h.requests.length,3);
  assert.equal(h.requests[2].muted,false);
  assert.equal(h.context.userPaused,false);
  assert.equal(h.pauses.length,0);
  assert.equal(h.video.currentTime,5);
  assert.equal(h.video.src,'original.mp4');
  assert.equal(h.video.volume,.7);
  h.requests[2].resolve();await flush();
  assert.equal(h.context.playbackAudio.getState().audible,true);
});

test('after audible activation subsequent video taps pause and resume normally',async () => {
  const h = tapHarness();await h.blockAutoplay();
  h.context.activateVideo(h.event());h.requests[2].resolve();await flush();
  h.context.activateVideo(h.event());
  assert.equal(h.context.userPaused,true);assert.equal(h.video.paused,true);
  assert.equal(h.pauses.length,1);assert.equal(h.requests.length,3);
  h.context.activateVideo(h.event());
  assert.equal(h.context.userPaused,false);assert.equal(h.requests.length,4);
  assert.equal(h.requests[3].muted,false);
  h.requests[3].resolve();await flush();
});

test('video taps preserve explicit sound-off and only pause or resume',async () => {
  const h = tapHarness();h.context.playbackAudio.setEnabled(false);h.context.playback();
  h.requests[0].resolve();await flush();
  h.context.activateVideo(h.event());
  assert.equal(h.context.userPaused,true);assert.equal(h.requests.length,1);
  h.context.activateVideo(h.event());
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].muted,true);
  assert.equal(h.context.playbackAudio.getState().enabled,false);
  h.requests[1].resolve();await flush();
});

test('a denied tap retry falls back once without a loop and can retry on another tap',async () => {
  const h = tapHarness();await h.blockAutoplay();
  h.context.activateVideo(h.event());h.requests[2].reject(denied());await flush();
  assert.equal(h.requests.length,4);assert.equal(h.requests[3].muted,true);
  h.requests[3].resolve();await flush();
  assert.equal(h.requests.length,4);assert.equal(h.context.playbackAudio.getState().blocked,true);
  assert.equal(h.context.userPaused,false);assert.equal(h.pauses.length,0);
  h.context.activateVideo(h.event());
  assert.equal(h.requests.length,5);assert.equal(h.requests[4].muted,false);
  h.requests[4].resolve();await flush();
});

test('offscreen videos controls modal profile or hidden-page interactions cannot activate audio',async () => {
  const h = tapHarness();await h.blockAutoplay();
  h.context.activateVideo(h.event({currentTarget:{}}));
  for (const [object,key] of [[h.context.personalize,'open'],[h.context.about,'open'],[h.context,'routeIsProfile'],[h.context.document,'hidden']]) {
    object[key] = true;h.context.activateVideo(h.event());object[key] = false;
  }
  h.context.activeIndex = 1;h.context.activateVideo(h.event());
  assert.equal(h.requests.length,2);assert.equal(h.pauses.length,0);
  assert.equal(h.context.playbackAudio.getState().blocked,true);
});

test('Enter and Space use one video activation while repeats and unrelated keys do not toggle',async () => {
  for (const key of ['Enter',' ']) {
    const h = tapHarness();await h.blockAutoplay();let defaults = 0;
    h.context.handleVideoKeydown(h.event({key,preventDefault() {defaults++;}}));
    assert.equal(defaults,1);assert.equal(h.requests.length,3);assert.equal(h.requests[2].muted,false);
    h.requests[2].resolve();await flush();
    h.context.handleVideoKeydown(h.event({key,repeat:true,preventDefault() {defaults++;}}));
    h.context.handleVideoKeydown(h.event({key:'ArrowRight',preventDefault() {assert.fail('Not handled');}}));
    assert.equal(defaults,2);assert.equal(h.requests.length,3);assert.equal(h.pauses.length,0);
    h.context.handleVideoKeydown(h.event({key}));
    assert.equal(h.pauses.length,1);assert.equal(h.context.userPaused,true);
  }
});

test('tap unlock is bound only to videos and is not a broad page or pointer handler',() => {
  assert.match(source('renderFeed'),/querySelector\('video'\)\.addEventListener\('click',activateVideo\)/);
  assert.match(source('renderFeed'),/video\.addEventListener\('keydown',handleVideoKeydown\)/);
  assert.equal((app.match(/addEventListener\('click',activateVideo\)/g) || []).length,1);
  assert.doesNotMatch(app,/addEventListener\('(pointerdown|pointerup|touchstart|touchend)',activateVideo/);
});
