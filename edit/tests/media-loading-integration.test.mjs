import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {orderShowcase} from '../availability.js';
import {withSaturdayPreviews} from '../saturday-previews.js';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const catalogSource = await readFile(new URL('../catalog.json',import.meta.url),'utf8');
const catalog = JSON.parse(catalogSource);
const functionSource = name => {
  const source = app.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];
  assert.ok(source,'Missing application function: ' + name);
  return source;
};
const mediaPathSource = app.match(/const mediaPath = [\s\S]*?\r?\n\};/)?.[0];
const posterPathSource = app.match(/let posterPreviews = [\s\S]*?(?=const playbackAudio =)/)?.[0];
assert.ok(mediaPathSource && posterPathSource,'Use the application poster resolver.');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const item = Object.freeze({id:'test-model',label:'Modelo de teste',title:'Título do modelo',recipe:'sextou',
  video:'./media/original.mp4',poster:'./media/original.png',duration:10,orderEnabled:true});

function posterResolver(previews) {
  return runInNewContext(mediaPathSource + '\n' + posterPathSource + '\nposterPreviews = previews; posterPath',{
    URL,location:{href:'https://ia4tube.com/edit/',origin:'https://ia4tube.com'},previews,
  },{timeout:1000});
}

function manifestLoader(fetch) {
  const timers = new Map();let handle = 0;
  const context = {fetch,AbortController,
    setTimeout(callback,delay) {const id = ++handle;timers.set(id,{callback,delay});return id;},
    clearTimeout(id) {timers.delete(id);},
  };
  runInNewContext(functionSource('loadPosterPreviews'),context,{timeout:1000});
  return {load:context.loadPosterPreviews,timers};
}

test('missing unavailable or malformed preview manifests fall back to original posters',async () => {
  const responses = [
    async () => ({ok:false,json() {assert.fail('Do not parse a missing manifest.');}}),
    async () => {throw new Error('Network unavailable');},
    async () => ({ok:true,json:async () => {throw new SyntaxError('Invalid JSON');}}),
    ...[null,[],[item.poster],'invalid',42].map(value => async () => ({ok:true,json:async () => value})),
  ];
  for (const [index,fetch] of responses.entries()) {
    const f = manifestLoader(fetch),previews = await f.load();
    assert.equal(Object.keys(previews).length,0,'Invalid manifest case ' + index);
    assert.equal(posterResolver(previews)(item),'/edit/media/original.png');
    assert.equal(f.timers.size,0,'Every completed manifest attempt clears its timeout.');
  }
});

test('a stalled preview request is aborted and leaves original posters usable',async () => {
  let signal;
  const f = manifestLoader((_url,options) => new Promise((_resolve,reject) => {
    signal = options.signal;
    signal.addEventListener('abort',() => reject(new DOMException('Aborted','AbortError')),{once:true});
  }));
  const pending = f.load();
  assert.equal(f.timers.size,1);
  const timer = [...f.timers.values()][0];
  assert.ok(timer.delay > 0 && timer.delay <= 2500,'Optional previews cannot indefinitely delay the feed.');
  timer.callback();
  const previews = await pending;
  assert.equal(signal.aborted,true);
  assert.equal(posterResolver(previews)(item),'/edit/media/original.png');
  assert.equal(f.timers.size,0);
});

test('an incomplete manifest uses its WebP only for matching original posters',async () => {
  const previews = Object.freeze({[item.poster]:'./media/previews-20261022/original.webp'});
  const f = manifestLoader(async url => {
    assert.match(url,/^\.\/poster-previews\.json(?:\?|$)/);
    return {ok:true,json:async () => previews};
  });
  const resolve = posterResolver(await f.load());
  assert.equal(resolve(item),'/edit/media/previews-20261022/original.webp');
  assert.equal(resolve({...item,poster:'./media/unmapped.png'}),'/edit/media/unmapped.png');
  assert.equal(item.poster,'./media/original.png');
});

test('invalid preview entries fall back to the original instead of empty or fabricated paths',() => {
  for (const preview of [null,'',false,42,{},[],
    'https://example.com/foreign.webp','https://user:password@ia4tube.com/edit/private.webp',
    'data:image/webp;base64,AAAA','javascript:alert(1)']) {
    assert.equal(posterResolver({[item.poster]:preview})(item),'/edit/media/original.png',String(preview));
  }
});

test('the actual feed template carries deferred media without eager video src or poster',() => {
  const construction = app.match(/const article = document\.createElement\('article'\);[\s\S]*?article\.innerHTML = \x60[\s\S]*?\x60;/)?.[0];
  assert.ok(construction);
  const article = {dataset:{},setAttribute() {}};
  runInNewContext(construction,{item,creator:catalog.creator,esc:escapeHtml,mediaPath:value => value,
    posterPath:() => './media/previews-20261022/original.webp',startingPrice:() => 1990,money:() => 'R$ 19,90',icon:() => '',
    document:{createElement:tag => {assert.equal(tag,'article');return article;}},
  },{timeout:1000});
  const video = article.innerHTML.match(/<video\b[^>]*>/)?.[0];
  assert.ok(video);
  assert.match(video,/\sdata-src="\.\/media\/original\.mp4"/);
  assert.match(video,/\sdata-poster="\.\/media\/previews-20261022\/original\.webp"/);
  assert.match(video,/\spreload="none"/);
  assert.doesNotMatch(video,/\s(?:src|poster)\s*=/);
  assert.deepEqual(article.dataset,{id:item.id,title:item.label,recipe:item.recipe});
});

function routeFixture(hash = '#hoje',items = [item]) {
  const events = [],images = [],buttons = [],nodes = new Map();
  for (const selector of ['#catalog-count','#orderable-count','#feed-view','#profile-view','.feed-tab']) nodes.set(selector,{});
  const grid = {replaceChildren() {buttons.length = 0;images.length = 0;},append(button) {buttons.push(button);}};
  nodes.set('#profile-grid',grid);
  const context = {location:{hash},routeIsProfile:false,catalog:items,daily:[items[0]],playlist:[],data:{},
    saturdayPreviews:[],withSaturdayPreviews,
    feed:{clientHeight:600,scrollTo:options => events.push(['scroll',options.top])},
    setVideoOnly:value => events.push(['interface',value]),syncReleases() {},
    renderFeed(list,key,index) {events.push(['render',key,index]);context.playlist = list;},
    activate:index => events.push(['activate',index]),playback:() => events.push(['playback']),toast:message => events.push(['toast',message]),
    esc:escapeHtml,icon:() => '',posterPath:entry => entry.poster.replace(/\.png$/,'.webp'),
    document:{querySelector(selector) {assert.ok(nodes.has(selector),selector);return nodes.get(selector);},
      querySelectorAll(selector) {
        if (selector === '[data-nav]') return [];
        assert.equal(selector,'#profile-grid img[data-src]');return images;
      },
      createElement(tag) {
        assert.equal(tag,'button');
        return {dataset:{},classList:{add() {}},setAttribute() {},addEventListener() {},
          set innerHTML(html) {
            this.html = html;
            const opening = html.match(/<img\b[^>]*>/)?.[0];assert.ok(opening);
            const image = {html:opening,dataset:{src:opening.match(/\sdata-src="([^"]+)"/)?.[1]},writes:0,
              getAttribute(name) {assert.equal(name,'src');return this.source ?? null;},
              set src(value) {this.writes++;this.source = value;},
            };
            images.push(image);
          },
        };
      },
    },
  };
  runInNewContext(functionSource('renderProfile') + '\n' + functionSource('route'),context,{timeout:1000});
  return {context,events,images,buttons,nodes};
}

test('profile thumbnails gain src only when entering the profile route and retain native lazy loading',() => {
  const f = routeFixture();f.context.renderProfile();
  assert.equal(f.images.length,1);
  assert.doesNotMatch(f.images[0].html,/\ssrc\s*=/);
  assert.match(f.images[0].html,/loading="lazy"/);
  assert.match(f.images[0].html,/decoding="async"/);
  assert.match(f.images[0].html,/width="\d+" height="\d+"/);
  f.context.route();assert.equal(f.images[0].writes,0);
  f.context.location.hash = '#perfil';f.context.route();
  assert.equal(f.context.routeIsProfile,true);
  assert.equal(f.images[0].getAttribute('src'),'./media/original.webp');
  assert.equal(f.images[0].writes,1);
  f.context.location.hash = '#hoje';f.context.route();
  f.context.location.hash = '#perfil';f.context.route();
  assert.equal(f.images[0].writes,1,'Returning to the profile must not reset thumbnail sources.');
});

test('a deep link passes its final index to the first feed render, including decoded IDs',() => {
  const items = Array.from({length:30},(_,index) => ({...item,id:index === 24 ? 'model / requested' : 'model-' + index}));
  const f = routeFixture('#video/' + encodeURIComponent(items[24].id),items);
  f.context.route();
  assert.deepEqual(f.events.filter(event => ['render','activate'].includes(event[0])),[['render','profile',24],['activate',24]]);
  assert.equal(f.context.playlist,items);
  assert.ok(f.events.some(event => event[0] === 'scroll' && event[1] === 24 * 600));
});

test('missing and malformed deep links safely render the daily feed at index zero',() => {
  for (const hash of ['#video/missing','#video/%E0%A4%A']) {
    const f = routeFixture(hash);f.context.route();
    assert.deepEqual(f.events.filter(event => event[0] === 'render'),[['render','daily',0]]);
    assert.equal(f.context.playlist,f.context.daily);
    assert.equal(f.events.some(event => event[0] === 'activate' && event[1] < 0),false);
  }
});

test('playback prepares the current media window synchronously before requesting audio',() => {
  const events = [];let inCall = true,prepared = false;
  const videos = [0,1,2].map(index => ({pause:() => events.push(['pause',index])}));
  const context = {videos,activeIndex:1,cards:[],syncPreviewImages() {},routeIsProfile:false,document:{hidden:false,dispatchEvent() {}},Event,
    personalize:{open:false},about:{open:false},userPaused:false,videoOnly:false,
    swipeGuide:{cancel:() => events.push(['guide-cancel']),schedule:() => events.push(['guide-schedule'])},
    canPlay:() => !context.routeIsProfile && !context.document.hidden,
    playbackAudio:{cancel:video => events.push(['cancel',videos.indexOf(video)]),play(video,options) {
      assert.equal(inCall,true,'play() must remain in the user gesture call stack.');
      assert.equal(prepared,true);assert.equal(video,videos[1]);assert.equal(options.isCurrent(),true);
      events.push(['play',1]);options.onPlaying();
    }},
    mediaWindow:{sync(list,index,{visible}) {
      assert.equal(list,videos);assert.equal(index,1);events.push(['sync',visible]);prepared = visible;
    }},tick:() => events.push(['tick']),syncPlayButton() {},activeCard:() => ({}),
  };
  runInNewContext(functionSource('playback'),context,{timeout:1000});
  context.playback();inCall = false;
  assert.ok(events.findIndex(event => event[0] === 'sync') < events.findIndex(event => event[0] === 'play'));
  assert.ok(events.findIndex(event => event[0] === 'guide-schedule') > events.findIndex(event => event[0] === 'play'));
  for (const hide of [() => {context.routeIsProfile = true;},() => {context.routeIsProfile = false;context.document.hidden = true;}]) {
    events.length = 0;hide();context.playback();
    assert.ok(events.some(event => event[0] === 'sync' && event[1] === false));
    assert.equal(events.some(event => event[0] === 'play'),false);
    assert.equal(events.some(event => event[0] === 'guide-schedule'),false);
    assert.ok(events.some(event => event[0] === 'guide-cancel'));
  }
});

test('feed replacement releases old resources before replacing cards and first activates the requested index',() => {
  const events = [],articles = [],nodes = new Map([['#previous',{}],['#next',{}],['#position',{}]]);
  const oldVideo = {pause:() => events.push('pause-old')};
  const context = {playlistKey:'old',playlist:[],activeIndex:0,cards:[{}],videos:[oldVideo],progressFrame:9,
    swipeGuide:{cancel:() => events.push('guide-cancel')},
    Event,observer:{disconnect:() => events.push('disconnect'),observe() {}},
    playbackAudio:{cancel:video => {assert.equal(video,oldVideo);events.push('cancel-old');}},
    mediaWindow:{clear:() => events.push('clear')},cancelAnimationFrame:() => events.push('cancel-frame'),
    feed:{clientHeight:600,replaceChildren() {events.push('replace');articles.length = 0;},append:article => articles.push(article),
      querySelectorAll:() => articles,scrollTo:options => events.push(['scroll',options.top])},
    document:{dispatchEvent() {},querySelector:selector => nodes.get(selector),createElement(tag) {
      assert.equal(tag,'article');
      const video = {addEventListener() {}},control = {addEventListener() {}};
      return {dataset:{},setAttribute() {},querySelector:selector => selector === 'video' ? video : control};
    }},
    creator:catalog.creator,esc:escapeHtml,mediaPath:value => value,posterPath:entry => entry.poster,
    icon:() => '',money:() => 'R$ 19,90',startingPrice:() => 1990,
    syncSound() {},syncInterface() {},syncReleases() {},tick() {},toggleSound() {},togglePlay() {},activateVideo() {},handleVideoKeydown() {},
    activate:index => events.push(['activate',index]),
  };
  runInNewContext(functionSource('renderFeed'),context,{timeout:1000});
  const items = Array.from({length:6},(_,index) => ({...item,id:'model-' + index}));
  context.renderFeed(items,'profile',4);
  assert.ok(events.indexOf('clear') >= 0 && events.indexOf('clear') < events.indexOf('replace'));
  assert.ok(events.indexOf('guide-cancel') >= 0 && events.indexOf('guide-cancel') < events.indexOf('replace'));
  assert.deepEqual(events.filter(event => Array.isArray(event) && event[0] === 'activate'),[['activate',4]]);
  assert.ok(events.some(event => Array.isArray(event) && event[0] === 'scroll' && event[1] === 2400));
  assert.equal(context.activeIndex,4);assert.equal(context.videos.length,6);
});

test('loading preview mappings leaves catalog records and original media paths intact',async () => {
  const freeze = value => {
    if (value && typeof value === 'object') {Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
  };
  const original = freeze(JSON.parse(catalogSource)),before = JSON.stringify(original),events = [];
  const previews = Object.freeze({[original.catalog[0].poster]:'./media/previews-20261022/example.webp'});
  const context = {feed:{},data:null,creator:{},prices:{},catalog:[],daily:[],posterPreviews:{},orderShowcase,
    fetch:async (url,options) => {assert.equal(url,'./catalog.json');assert.equal(options.cache,'no-store');return {ok:true,json:async () => original};},
    loadPosterPreviews:async () => previews,loadSaturdayPreviews:async () => [],saturdayPreviews:[],renderProfile:() => events.push('profile'),route:() => events.push('route'),
    order:{restore:() => null},document:{querySelector:selector => assert.fail('Unexpected catalog error: ' + selector)},
  };
  runInNewContext(functionSource('load'),context,{timeout:1000});
  await context.load();
  assert.equal(context.data,original);assert.equal(context.posterPreviews,previews);
  assert.deepEqual(events,['profile','route']);assert.equal(JSON.stringify(original),before);
  for (const entry of context.catalog) {
    assert.equal(entry,original.catalog.find(previous => previous.id === entry.id));
    assert.match(entry.video,/\.mp4$/);assert.match(entry.poster,/\.png$/);
  }
});
