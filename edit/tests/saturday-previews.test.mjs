import test from 'node:test';
import {feedItems} from '../ready-posts.js';
import {filterImageItems} from '../image-categories.js';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {normalizeSaturdayPreviews,loadSaturdayPreviews,withSaturdayPreviews,syncPreviewImages} from '../saturday-previews.js';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const css = await readFile(new URL('../styles.css',import.meta.url),'utf8');
const source = name => {
  const match = app.match(new RegExp('^(?:async )?function ' + name + '\\([^\\n]*\\) \\{[\\s\\S]*?^\\}','m'))?.[0];
  assert.ok(match,name);return match;
};
const names = ['burger','combo','pizza','mascote','pizza-dupla'];
const manifest = {label:'Sábado, novos vídeos',items:names.map(name => ({
  id:'previa-sabado-' + name,title:'Prévia ' + name,poster:'./media/sabado-20261024/' + name + '.webp',
}))};
const previews = normalizeSaturdayPreviews(manifest);
const videoItem = {id:'existing-video',label:'Modelo existente',title:'Vídeo anterior',
  video:'./media/original.mp4',poster:'./media/original.png',recipe:'sextou',orderEnabled:true};
const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('five separate preview records have no movie, price, duration, release timer or ordering contract',() => {
  assert.equal(previews.length,5);
  for (const item of previews) {
    assert.equal(item.kind,'saturday-preview');assert.equal(item.label,'Sábado, novos vídeos');
    assert.equal(item.orderEnabled,false);
    for (const key of ['video','duration','prices','recipe','release','opensAt','orderEndpoint']) assert.equal(key in item,false,key);
  }
});

test('invalid, foreign, traversal and unrecognized preview assets are not accepted',() => {
  for (const value of [undefined,null,[],{},42,{items:'bad'}]) assert.deepEqual(normalizeSaturdayPreviews(value),[]);
  for (const poster of ['https://external.example/image.webp','//external/image.webp','data:image/webp,a',
    './media/sabado-20261024/../secret.webp','./media/sabado-20261024/example.mp4','./media/old.png','']) {
    assert.deepEqual(normalizeSaturdayPreviews({items:[{...manifest.items[0],poster}]}),[],poster);
  }
  for (const entry of [{...manifest.items[0],id:'existing-video'}, {...manifest.items[0],title:''},
    {...manifest.items[0],title:'x'.repeat(101)},null]) assert.deepEqual(normalizeSaturdayPreviews({items:[entry]}),[]);
});

test('deduplication caps the fixed announcement set at five and discards invented commercial fields',() => {
  const items = normalizeSaturdayPreviews({label:'Liberado já',items:[...manifest.items,...manifest.items].map(item => ({
    ...item,orderEnabled:true,recipe:'sextou',video:'./paid.mp4',prices:{10:10},duration:10,
  }))});
  assert.equal(items.length,5);assert.deepEqual(items,previews);
});

test('previews append after current models without mutation or changing their identities',() => {
  const catalog = Object.freeze([Object.freeze({...videoItem}),Object.freeze({...videoItem,id:'second'})]);
  const result = withSaturdayPreviews(catalog,previews);
  assert.equal(result.length,7);assert.equal(result[0],catalog[0]);assert.equal(result[1],catalog[1]);
  assert.deepEqual(result.slice(2),previews);assert.equal(catalog.length,2);
  assert.equal(withSaturdayPreviews(catalog,[]),catalog);
});

function loader(fetchImpl) {
  const timers = new Map();let next = 0;
  return {timers,load:() => loadSaturdayPreviews({fetchImpl,
    setTimer(callback,delay) {timers.set(++next,{callback,delay});return next;},clearTimer:id => timers.delete(id)})};
}

test('optional manifest success uses only a GET and no-store without touching the catalog',async () => {
  const f = loader(async (url,options) => {
    assert.equal(url,'./saturday-previews.json?v=20261022-saturday-previews');
    assert.equal(options.cache,'no-store');assert.equal(options.method,undefined);
    return {ok:true,json:async () => manifest};
  });
  assert.deepEqual(await f.load(),previews);assert.equal(f.timers.size,0);
});

test('a missing, invalid or failed optional manifest resolves to no announcements',async () => {
  for (const fetchImpl of [async () => ({ok:false}),async () => {throw new Error('offline');},
    async () => ({ok:true,json:async () => {throw new SyntaxError('bad JSON');}}),
    async () => ({ok:true,json:async () => ({items:[]})})]) {
    const f = loader(fetchImpl);assert.deepEqual(await f.load(),[]);assert.equal(f.timers.size,0);
  }
});

test('a stalled optional request aborts after at most 2.5 seconds without making the catalog fail',async () => {
  let signal;
  const f = loader((_url,options) => new Promise((_resolve,reject) => {
    signal = options.signal;signal.addEventListener('abort',() => reject(new Error('aborted')));
  }));
  const pending = f.load();const timer = [...f.timers.values()][0];
  assert.ok(timer.delay > 0 && timer.delay <= 2500);timer.callback();
  assert.deepEqual(await pending,[]);assert.equal(signal.aborted,true);assert.equal(f.timers.size,0);
});

function imageCard(index) {
  const attrs = new Map(),writes = [];
  const image = {dataset:{src:'/edit/media/sabado-20261024/' + names[index] + '.webp'},
    getAttribute:key => attrs.get(key) ?? null,
    setAttribute(key,value) {attrs.set(key,value);writes.push([key,value]);},
    removeAttribute:key => attrs.delete(key),
  };
  return {image,writes,querySelector:selector => selector === '.preview-poster' ? image : null};
}

test('opening the feed downloads none of the distant preview images and approaching loads only neighbors',() => {
  const regular = Array.from({length:28},() => ({querySelector:() => null}));
  const previewCards = previews.map((_item,index) => imageCard(index)),cards = [...regular,...previewCards];
  syncPreviewImages(cards,0);assert.ok(previewCards.every(card => card.writes.length === 0));
  syncPreviewImages(cards,27);assert.equal(previewCards[0].writes.length,1);
  assert.ok(previewCards.slice(1).every(card => card.writes.length === 0));
  syncPreviewImages(cards,30);
  assert.deepEqual(previewCards.map(card => Boolean(card.image.getAttribute('src'))),[false,true,true,true,false]);
  syncPreviewImages(cards,30);assert.equal(previewCards[2].writes.length,1,'No repeated same-source image writes.');
  syncPreviewImages(cards,30,{visible:false});assert.ok(previewCards.every(card => card.image.getAttribute('src') === null));
});

test('actual preview card is a deferred image with the Saturday notice, no price, order, sound or fake video',() => {
  const card = {dataset:{},attributes:{},setAttribute(key,value) {this.attributes[key] = value;},
    querySelector:() => ({addEventListener() {}})};
  const context = {document:{createElement:tag => {assert.equal(tag,'article');return card;}},
    esc,mediaPath:value => value,creator:{avatar:'./assets/logo.png'},icon:() => '',location:{},setVideoOnly() {},videoOnly:false};
  runInNewContext(source('createPreviewCard'),context);
  assert.equal(context.createPreviewCard(previews[0]),card);
  assert.equal(card.dataset.preview,'true');assert.match(card.attributes['aria-label'],/Prévia em imagem/);
  assert.match(card.innerHTML,/Sábado, novos vídeos/);assert.match(card.innerHTML,/class="preview-poster" data-src=/);
  const image = card.innerHTML.match(/<img class="preview-poster"[^>]*>/)[0];
  assert.doesNotMatch(image,/\ssrc=/);assert.match(image,/loading="lazy" decoding="async"/);
  assert.doesNotMatch(card.innerHTML,/<video|make-button|offer-price|sound-toggle|\bmp4\b|Em breve|Fazer meu pedido/);
});

test('preview labels and image titles are escaped, and the new overlay preserves full-screen and clean-view mode',() => {
  assert.match(source('createPreviewCard'),/esc\(item\.label\)/);
  assert.match(source('createPreviewCard'),/esc\(item\.title\)/);
  assert.match(css,/\.preview-poster\s*\{[^}]*height:\s*100%[^}]*object-fit:\s*cover/);
  assert.match(css,/body\.video-only \.saturday-notice,/);
});

test('a preview can never open the ordering dialog even if passed directly to its handler',() => {
  const context = {data:{},document:{querySelector:() => assert.fail('A preview must not touch the order form.')}};
  runInNewContext(source('openPersonalize'),context);
  assert.doesNotThrow(() => context.openPersonalize(previews[0]));
});

test('real video playback safely stops at a static preview and resumes on returning without null errors',() => {
  const events = [],video = {pause:() => events.push('pause')};
  const cards = [{querySelector:() => null},imageCard(0)];
  const context = {videos:[video,null],cards,activeIndex:1,routeIsProfile:false,userPaused:false,videoOnly:false,
    document:{hidden:false,dispatchEvent() {}},Event,personalize:{open:false},about:{open:false},imageCategoryMenu:null,
    swipeGuide:{schedule() {},cancel() {}},syncPreviewImages,
    mediaWindow:{sync(list,index) {assert.equal(list[1],null);events.push(['media',index]);}},
    playbackAudio:{cancel:value => {assert.equal(value,video);events.push('cancel');},play:value => {assert.equal(value,video);events.push('play');}},
    tick() {},syncPlayButton() {},activeCard:() => cards[context.activeIndex],
  };
  runInNewContext(source('canPlay') + '\n' + source('playback'),context);
  assert.doesNotThrow(() => context.playback());assert.ok(events.includes('pause'));assert.equal(events.includes('play'),false);
  assert.ok(cards[1].image.getAttribute('src'));
  context.activeIndex = 0;context.playback();assert.ok(events.includes('play'));
});

test('audio state synchronization and play-button synchronization accept static null slots',() => {
  const video = {muted:true},context = {videos:[video,null],soundEnabled:true,
    playbackAudio:{getState:() => ({audible:true,enabled:true,blocked:false})},
    document:{querySelectorAll:() => []}};
  runInNewContext(source('syncSound') + '\n' + source('syncPlayButton'),context);
  assert.doesNotThrow(() => context.syncSound());assert.equal(video.muted,false);
  assert.doesNotThrow(() => context.syncPlayButton({querySelector:() => null}));
});

test('the position display separates five previews from the count of existing videos',() => {
  const nodes = {'#position':{},'#previous':{},'#next':{}},playlist = withSaturdayPreviews([videoItem],previews);
  const context = {cards:playlist,playlist,saturdayPreviews:previews,activeIndex:0,playback() {},document:{querySelector:key => nodes[key]}};
  runInNewContext(source('activate'),context);context.activate(0);
  assert.equal(nodes['#position'].innerHTML,'01 <span>/ 01</span>');
  context.activate(1);assert.equal(nodes['#position'].innerHTML,'Prévia 1 <span>/ 5</span>');
  context.activate(5);assert.equal(nodes['#position'].innerHTML,'Prévia 5 <span>/ 5</span>');assert.equal(nodes['#next'].disabled,true);
});

test('a direct preview link selects its appended image without creating a catalog item',() => {
  const nodes = new Map(),events = [];
  const context = {location:{hash:'#video/previa-sabado-pizza'},data:{},catalog:[videoItem],daily:[videoItem],
    saturdayPreviews:previews,withSaturdayPreviews,feedItems,selectedMediaKind:'video',playlist:[],routeIsProfile:false,
    filterImageItems,selectedImageCategory:'all',imageSearch:'',imageCategoryMenu:{sync(value) {this.state=value;}},
    document:{body:{classList:{toggle() {}}},querySelector:selector => {if (!nodes.has(selector)) nodes.set(selector,{});return nodes.get(selector);},querySelectorAll:() => []},
    feed:{clientHeight:640,scrollTo:options => events.push(['scroll',options.top])},
    renderFeed(items,key,index) {context.playlist = items;events.push(['render',key,index]);},
    activate:index => events.push(['activate',index]),playback() {},toast:() => assert.fail('Known preview should route directly.'),setVideoOnly() {},
  };
  runInNewContext(source('selectedItems') + '\n' + source('route'),context);context.route();
  assert.deepEqual(events,[['render','video-profile',3],['scroll',1920],['activate',3]]);
  assert.equal(context.catalog.length,1);assert.equal(context.catalog[0],videoItem);
  assert.equal(context.playlist[3].id,'previa-sabado-pizza');
});

test('profile counts are based only on existing catalog and previews carry no duration/play badge',() => {
  const profile = source('renderProfile');
  assert.match(profile,/#catalog-count'\)\.textContent = catalog\.length/);
  assert.match(profile,/#orderable-count'\)\.textContent = catalog\.filter/);
  assert.match(profile,/selectedItems\(catalog\)/);
  const branch = profile.slice(profile.indexOf("if (item.kind === 'saturday-preview')"),profile.indexOf('if (item.creativeTemplate)'));
  assert.match(branch,/<span>Prévia<\/span>/);assert.doesNotMatch(branch,/duration|icon\('play'\)|openPersonalize/);
});
