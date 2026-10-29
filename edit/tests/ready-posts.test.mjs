import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createReadyPostOptions,isReadyPost,feedItems} from '../ready-posts.js';
import {buildMultipartOrder} from '../order-adapter.js';
import {fingerprintPayload} from '../order.js';

const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const originalCatalog=structuredClone(catalog);
originalCatalog.catalog=originalCatalog.catalog.filter(item=>!/^posts-prontos-extra-/.test(item.creativeTemplate||''));
const originalIds=new Set(originalCatalog.catalog.map(item=>item.id));
originalCatalog.dailySelection.videoIds=originalCatalog.dailySelection.videoIds.filter(id=>originalIds.has(id));
const before=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-ready-posts.json',import.meta.url),'utf8'));
const posts=originalCatalog.catalog.filter(item=>item.mediaKind==='image');
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const page=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('all30 released video records and catalogue metadata remain exactly unchanged',()=>{
  assert.equal(before.catalog.length,30);assert.equal(originalCatalog.catalog.length,70);
  assert.deepEqual(catalog.catalog.slice(0,30),before.catalog);
  const legacy=structuredClone(catalog);legacy.catalog=legacy.catalog.slice(0,30);
  const oldIds=new Set(legacy.catalog.map(item=>item.id));
  legacy.dailySelection.videoIds=legacy.dailySelection.videoIds.filter(id=>oldIds.has(id));
  assert.deepEqual(legacy,before);
});
test('40 distinct image models expose image990 and stable video quotes without prompts',async()=>{
  assert.equal(posts.length,40);assert.equal(new Set(posts.map(item=>item.id)).size,40);
  let bytes=0;
  for(const [index,item]of posts.entries()) {
    assert.ok(isReadyPost(item));assert.equal(item.creativeTemplate,`posts-prontos-${String(index+1).padStart(2,'0')}-v1`);
    assert.match(item.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(item.version,1);assert.equal(item.status,'published');assert.equal(item.orderEnabled,true);
    assert.equal(item.video,null);assert.equal(item.outputPrices.image,990);
    assert.ok(Number.isSafeInteger(item.outputPrices.video)&&item.outputPrices.video>=1990&&item.outputPrices.video<=2790);
    assert.equal(item.prices['10'],item.outputPrices.video);
    for(const key of ['prompt','imagePrompt','videoPrompt','referencePath','productionModel'])assert.equal(Object.hasOwn(item,key),false);
    assert.match(item.poster,/^\.\/media\/posts-prontos-20261028\/modelo-\d\d\.webp$/);
    const asset=await readFile(new URL(item.poster,new URL('../',import.meta.url)));
    assert.equal(asset.toString('ascii',0,4),'RIFF');assert.equal(asset.toString('ascii',8,12),'WEBP');
    assert.ok(asset.length<400000);bytes+=asset.length;
  }
  assert.ok(bytes<8*1024*1024);
  assert.equal(posts.filter(item=>item.animalOptions).length,4);
  assert.equal(posts[24].defaultAnimal,'coruja');
});
test('image tab is initially selected and legacy video deep links and bounded image loading remain available',()=>{
  assert.match(page,/data-media-kind="image" aria-selected="true">Imagens<\/button>/);
  assert.match(page,/data-media-kind="video" aria-selected="false">Vídeos<\/button>/);
  assert.match(source,/let selectedMediaKind = 'image'/);
  assert.match(source,/syncPreviewImages\(cards,activeIndex/);
  const imageCard=source.match(/function createImageCard\(item\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(imageCard);assert.match(imageCard,/class="preview-poster post-image" data-src=/);
  assert.doesNotMatch(imageCard,/<video|sound-toggle|play-toggle/);
  assert.match(source,/location\.hash\.startsWith\('#video\/'\)/);
  assert.deepEqual(feedItems(originalCatalog.catalog,'image'),posts);
  assert.deepEqual(feedItems(originalCatalog.catalog,'video'),before.catalog);
});
function optionsFixture(t) {
  const previous=globalThis.document;
  class Element {constructor(){this.children=[];this.hidden=false;this.disabled=false;}append(...items){this.children.push(...items);}}
  const duration={hidden:false,before:element=>{duration.field=element;}},explanation={textContent:'Old note'};
  const radios={10:{value:'10',checked:true},20:{value:'20',checked:false}};
  const form={querySelector(selector){
    if(selector==='.duration-field')return duration;
    if(selector==='.order-explanation[data-single-product]')return explanation;
    const match=selector.match(/value="(10|20)"/);if(match)return radios[match[1]];
    throw Error(selector);
  }};
  globalThis.document={createElement:()=>new Element()};t.after(()=>{globalThis.document=previous;});
  const options=createReadyPostOptions(form,String);
  const image=duration.field.children[1].children[0].children;
  const video=duration.field.children[1].children[1].children;
  return {options,duration,radios,image,video,explanation};
}
test('real output selector starts on image, allows video, locks correctly and resets to image on reopen',t=>{
  const f=optionsFixture(t);assert.equal(f.options.open(posts[0]),false);
  assert.equal(f.image[0].checked,true);assert.equal(f.options.selected(),'image');
  assert.equal(f.image[2].textContent,'990');assert.equal(f.video[2].textContent,String(posts[0].outputPrices.video));
  assert.equal(f.duration.hidden,true);assert.equal(f.radios[20].disabled,true);
  f.video[0].checked=true;assert.equal(f.options.selected(),'video');
  f.options.sync(true);assert.equal(f.video[0].disabled,true);assert.equal(f.options.selected(),'video');
  f.options.open(posts[0]);assert.equal(f.options.selected(),'image');
  f.options.open(before.catalog[2]);assert.equal(f.options.isEnabled(),false);assert.equal(f.duration.hidden,false);
});
test('real multipart and retry identities distinguish image/video without changing calendar tickets',async()=>{
  const base={videoId:posts[0].id,videoVersion:1,company:'',durationSeconds:10,consent:true,
    logo:{name:'logo.png',mime:'image/png',data:btoa('logo')},
    appCalendar:{ticket:'12345678-1234-4123-8123-123456789abc.'+'a'.repeat(43)}};
  for(const mediaKind of ['image','video']) {
    const data=JSON.parse(buildMultipartOrder({...base,mediaKind}).get('data'));
    assert.equal(data.mediaKind,mediaKind);assert.deepEqual(data.selections,[{id:'93',format:mediaKind}]);
    assert.deepEqual(data.appCalendar,base.appCalendar);assert.equal(Object.hasOwn(data,'totalCents'),false);
  }
  assert.notEqual(await fingerprintPayload({...base,mediaKind:'image'}),await fingerprintPayload({...base,mediaKind:'video'}));
  assert.equal(await fingerprintPayload({...base,mediaKind:'image'}),await fingerprintPayload({...base,mediaKind:'image'}));
});
