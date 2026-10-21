import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const css = await readFile(new URL('../styles.css',import.meta.url),'utf8');
const functionSource = name => {
  const source = app.match(new RegExp('function ' + name + '\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}'))?.[0];
  assert.ok(source,'Missing function: ' + name);
  return source;
};
const syncSource = functionSource('syncInterface');
const setSource = functionSource('setVideoOnly');
const escapeSource = app.match(/(?:^|\n)addEventListener\('keydown',event => \{[\s\S]*?\n\}\);/)?.[0];
assert.ok(escapeSource,'Global keyboard handler must be present.');

function harness() {
  const classes = new Set();
  const buttons = Array.from({length:7},() => ({
    innerHTML:'',attributes:{},setAttribute(name,value){this.attributes[name] = value;},
  }));
  const mediaState = {src:'example.mp4',currentTime:4.5,muted:false,volume:.7,playbackRate:1,paused:false};
  const video = {};
  for (const [key,value] of Object.entries(mediaState)) {
    Object.defineProperty(video,key,{get:() => value,set:() => assert.fail('Interface toggle must not change video.' + key)});
  }
  for (const method of ['play','pause','load']) video[method] = () => assert.fail('Interface toggle must not call video.' + method);
  const listeners = new Map();
  const context = {
    videoOnly:false,soundEnabled:true,userPaused:false,activeIndex:3,videos:[video],
    icon:name => '<svg data-icon="' + name + '"></svg>',
    document:{
      body:{classList:{toggle(name,enabled){if (enabled) classes.add(name);else classes.delete(name);}}},
      querySelectorAll(selector){assert.equal(selector,'.interface-toggle');return buttons;},
    },
    addEventListener(type,handler){listeners.set(type,handler);},
    playback(){assert.fail('Interface toggle must not restart or pause playback.');},
    syncSound(){assert.fail('Interface toggle must not change audio.');},
  };
  runInNewContext(syncSource + '\n' + setSource + '\n' + escapeSource,context,{timeout:1000});
  return {context,classes,buttons,listeners,video,mediaState};
}

test('video-only mode is off initially and both eye icons are defined',() => {
  assert.match(app,/let videoOnly = false;/);
  assert.match(app,/\beye:\s*'<path/);
  assert.match(app,/'eye-off':\s*'<path/);
});
test('hide interface marks body and all seven buttons with visible restore action',() => {
  const {context,classes,buttons} = harness();
  context.setVideoOnly(true);
  assert.equal(context.videoOnly,true);
  assert.ok(classes.has('video-only'));
  for (const button of buttons) {
    assert.equal(button.attributes['aria-pressed'],'true');
    assert.equal(button.attributes['aria-label'],'Mostrar interface');
    assert.equal(button.attributes.title,'Mostrar interface');
    assert.match(button.innerHTML,/data-icon="eye"/);
  }
});
test('show interface reverses body class, icon, title and ARIA on all cards',() => {
  const {context,classes,buttons} = harness();
  context.setVideoOnly(true);
  context.setVideoOnly(false);
  assert.equal(context.videoOnly,false);
  assert.ok(!classes.has('video-only'));
  for (const button of buttons) {
    assert.equal(button.attributes['aria-pressed'],'false');
    assert.equal(button.attributes['aria-label'],'Ocultar interface');
    assert.equal(button.attributes.title,'Ocultar interface');
    assert.match(button.innerHTML,/data-icon="eye-off"/);
  }
});
test('interface toggle keeps original video, timeline, audio and playback state',() => {
  const {context,video,mediaState} = harness();
  for (const value of [true,false,true,false]) context.setVideoOnly(value);
  assert.equal(context.videos[0],video);
  for (const [key,value] of Object.entries(mediaState)) assert.equal(video[key],value);
  assert.equal(context.soundEnabled,true);
  assert.equal(context.userPaused,false);
  assert.equal(context.activeIndex,3);
});
test('Escape restores interface without affecting unrelated keys or playback',() => {
  const {context,classes,buttons,listeners} = harness();
  const keydown = listeners.get('keydown');
  assert.equal(typeof keydown,'function');
  context.setVideoOnly(true);
  keydown({key:'ArrowDown'});
  assert.equal(context.videoOnly,true);
  keydown({key:'Escape'});
  assert.equal(context.videoOnly,false);
  assert.ok(!classes.has('video-only'));
  assert.equal(buttons[0].attributes['aria-label'],'Ocultar interface');
  keydown({key:'Escape'});
  assert.equal(context.videoOnly,false);
});
test('toggle click is wired and state is synchronized after rendering another playlist',() => {
  assert.match(app,/article\.querySelector\('\.interface-toggle'\)\.addEventListener\('click',\(\) => setVideoOnly\(!videoOnly\)\)/);
  const render = app.match(/function renderFeed\([\s\S]*?\n\}\nfunction goTo/)?.[0];
  assert.ok(render);
  assert.match(render,/syncInterface\(\)/);
});
test('profile restores interface and video-only never blocks playback eligibility',() => {
  const route = app.match(/function route\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(route);
  assert.match(route,/if \(routeIsProfile\) setVideoOnly\(false\);/);
  const eligibility = app.match(/function canPlay\(\) \{[^}]+\}/)?.[0];
  assert.ok(eligibility);
  assert.doesNotMatch(eligibility,/videoOnly|video-only/);
});
test('video-only CSS hides only named website UI with visibility, preserving layout and media',() => {
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([,selectors,declarations]) => ({selectors:selectors.replace(/\/\*[\s\S]*?\*\//g,'').trim(),declarations}))
    .filter(rule => rule.selectors.includes('body.video-only'));
  assert.equal(rules.length,1,'Use one explicit UI-only rule instead of geometry or player overrides.');
  const hidden = rules[0];
  assert.match(hidden.declarations,/visibility:\s*hidden\s*;/);
  assert.match(hidden.declarations,/pointer-events:\s*none\s*;/);
  assert.doesNotMatch(hidden.declarations,/\b(?:display|height|width|position|margin|padding|transform|overflow|opacity)\s*:/);
  assert.deepEqual(hidden.selectors.split(',').map(value => value.trim()),[
    'body.video-only .sidebar','body.video-only .desktop-heading','body.video-only .feed-top',
    'body.video-only .feed-controls','body.video-only .mobile-nav','body.video-only .video-info',
    'body.video-only .video-shade','body.video-only .video-progress','body.video-only .center-pause',
    'body.video-only .release-notice',
    'body.video-only .video-actions > :not(.interface-toggle)','body.video-only .skip-link','body.video-only #toast',
  ]);
});
test('restore button remains outside hidden selectors and has active-state feedback',() => {
  assert.match(css,/body\.video-only \.video-actions\s*>\s*:not\(\.interface-toggle\)/);
  assert.doesNotMatch(css,/body\.video-only \.interface-toggle\s*[{,]/);
  assert.doesNotMatch(css,/body\.video-only (?:video|\.video-card|\.stage|\.feed|\.video-actions)\s*[{,]/);
  assert.match(css,/\.interface-toggle\[aria-pressed="true"\]\s*\{[^}]*border-color:/);
});
