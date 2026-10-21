import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const source = name => {
  const result = app.match(new RegExp('function ' + name + '[\\s\\S]*?\\n\\}'))?.[0];
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
