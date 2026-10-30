import {legacyVideoCatalog} from './legacy-catalog.mjs';
import test from 'node:test';
import {orderCallToAction} from '../order-cta.js';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {RELEASE_AT,SCHEDULED_IDS,FUTURE_IDS,HIDDEN_IDS,PRODUCT_PACKAGE_ID,releaseInfo,orderShowcase} from '../availability.js';
import {buildMultipartOrder} from '../order-adapter.js';

const rawCatalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const catalog=legacyVideoCatalog(structuredClone(rawCatalog));
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const opens=Date.parse('2026-10-22T00:00:00-03:00');
const expected=[
  '53b147d4-23c8-447b-9b03-aee70a57693d',
  '088347f6-b7c6-4ad4-bc01-3608edfc3277',
  'b260ffc1-953c-480f-ad89-e6ad9253636d',
  'a1a42dba-b196-43b6-82cb-816868721523',
  'd3fb329a-b67c-4554-8e94-74b715e6197b',
];

test('one fixed Brasília release applies to exactly the final five published and daily cards',()=>{
  assert.equal(RELEASE_AT,'2026-10-22T00:00:00-03:00');
  assert.equal(opens,Date.parse('2026-10-22T03:00:00Z'));
  assert.deepEqual(SCHEDULED_IDS,expected);
  assert.equal(new Set(SCHEDULED_IDS).size,5);
  assert.deepEqual(catalog.catalog.filter(item=>item.status==='published').slice(-5).map(item=>item.id),expected);
  assert.deepEqual(catalog.dailySelection.videoIds.slice(-5),expected);
});

test('the five cards are scheduled until the exact boundary and remain open permanently afterward',()=>{
  for(const id of expected) {
    const item=catalog.catalog.find(row=>row.id===id);
    const pending=releaseInfo(item,opens-1);
    assert.equal(pending.opensAt,opens);
    assert.equal(pending.label,'Desbloqueia amanhã');
    for(const now of [opens,opens+1,opens+86400000,Date.parse('2027-01-01T00:00:00Z')]) {
      assert.equal(releaseInfo(item,now),null);
    }
  }
});

test('earlier dates do not promise tomorrow and unrelated cards are never scheduled',()=>{
  for(const id of expected) {
    const notice=releaseInfo({id},Date.parse('2026-10-20T12:00:00-03:00'));
    assert.ok(notice);
    assert.doesNotMatch(notice.label,/amanhã/i);
    assert.match(notice.label,/22\/10/);
  }
  for(const item of catalog.catalog.filter(row=>!expected.includes(row.id)&&!FUTURE_IDS.includes(row.id))) {
    assert.equal(releaseInfo(item,opens-1),null);
  }
  assert.equal(releaseInfo({id:'unknown'},opens-1),null);
});

test('the narrated package stays released in the raw catalogue without altering prices or the five timed models',()=>{
  assert.equal(PRODUCT_PACKAGE_ID,'2830b796-2375-49e8-8e97-9a731c115252');
  assert.deepEqual(FUTURE_IDS,[]);
  assert.deepEqual(HIDDEN_IDS,[PRODUCT_PACKAGE_ID]);
  const item=catalog.catalog.find(row=>row.id===PRODUCT_PACKAGE_ID);
  assert.equal(item.recipe,'produtos');
  assert.equal(item.orderEnabled,true);assert.equal(item.version,1);
  assert.deepEqual(catalog.productsPrices,{'2':3800,'4':4800,'6':5800,'8':6800});
  for(const now of [opens-1,opens,opens+86400000,Date.parse('2027-01-01T00:00:00Z')]) {
    assert.equal(releaseInfo(item,now),null);
  }
});

test('the customer showcase hides only the package and preserves every other identity and source order',()=>{
  const published=catalog.catalog.filter(row=>row.status==='published');
  const original=published.slice();
  const ordered=orderShowcase(published);
  const others=published.filter(row=>row.id!==PRODUCT_PACKAGE_ID);
  assert.notEqual(ordered,published);
  assert.deepEqual(published,original);
  assert.deepEqual(ordered.map(row=>row.id),others.map(row=>row.id));
  assert.equal(ordered.length,published.length-1);
  assert.equal(ordered.filter(row=>row.id===PRODUCT_PACKAGE_ID).length,0);
  assert.deepEqual(ordered.slice(-5).map(row=>row.id),expected);
  assert.deepEqual(orderShowcase(ordered),ordered,'Applying display order repeatedly must not move or duplicate another card.');
  assert.ok(ordered.every(row=>original.includes(row)),'Display order must reuse immutable model references.');
  const byId=new Map(published.map(row=>[row.id,row]));
  assert.deepEqual(orderShowcase(catalog.dailySelection.videoIds.map(id=>byId.get(id))).map(row=>row.id),ordered.map(row=>row.id));
});

test('display ordering preserves lists without the package, empty lists and short lists',()=>{
  const without=catalog.catalog.filter(row=>row.status==='published'&&row.id!==PRODUCT_PACKAGE_ID);
  const original=without.slice(),ordered=orderShowcase(without);
  assert.deepEqual(ordered,original);assert.notEqual(ordered,without);assert.deepEqual(without,original);
  assert.deepEqual(orderShowcase([]),[]);
  const item=catalog.catalog.find(row=>row.id===PRODUCT_PACKAGE_ID);
  assert.deepEqual(orderShowcase([item]),[]);
  assert.deepEqual(orderShowcase([item,without[0]]),[without[0]]);
});

test('the package raw record, daily reference, prices and media remain intact for personal use and restoration',async()=>{
  const before=JSON.stringify(rawCatalog);
  const prior=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-extra40.json',import.meta.url),'utf8'));
  const item=rawCatalog.catalog.find(row=>row.id===PRODUCT_PACKAGE_ID);
  assert.deepEqual(item,prior.catalog.find(row=>row.id===PRODUCT_PACKAGE_ID));
  assert.equal(item.status,'published');assert.equal(item.orderEnabled,true);assert.equal(item.version,1);
  assert.equal(rawCatalog.dailySelection.videoIds.includes(PRODUCT_PACKAGE_ID),true);
  assert.deepEqual(rawCatalog.productsPrices,{'2':3800,'4':4800,'6':5800,'8':6800});
  for(const field of ['video','poster']){
    assert.match(item[field],/^\.\/media\//);
    assert.ok((await stat(new URL('../'+item[field].slice(2),import.meta.url))).size>100000,field+' is preserved.');
  }
  const publicProfile=orderShowcase(rawCatalog.catalog.filter(row=>row.status==='published'));
  const byId=new Map(rawCatalog.catalog.map(row=>[row.id,row]));
  const publicFeed=orderShowcase(rawCatalog.dailySelection.videoIds.map(id=>byId.get(id)));
  assert.equal(publicProfile.some(row=>row.id===PRODUCT_PACKAGE_ID),false);
  assert.equal(publicFeed.some(row=>row.id===PRODUCT_PACKAGE_ID),false);
  assert.equal(JSON.stringify(rawCatalog),before);
});

test('availability is display metadata and cannot mutate catalog snapshots, prices or media',()=>{
  const before=JSON.stringify(catalog);
  for(const item of catalog.catalog) {
    releaseInfo(item,opens-1);releaseInfo(item,opens);
    for(const field of ['releaseAt','opensAt','releaseLabel','isLocked']) assert.equal(Object.hasOwn(item,field),false);
  }
  assert.equal(JSON.stringify(catalog),before);
});

test('released orders retain the exact prior multipart identity and have no scheduling fields',()=>{
  const logo={name:'logo.png',mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII='};
  for(const id of expected) {
    const item=catalog.catalog.find(row=>row.id===id);
    assert.equal(releaseInfo(item,opens),null);
    const data=JSON.parse(buildMultipartOrder({videoId:id,videoVersion:item.version,
      company:'Cliente de teste',durationSeconds:10,consent:true,logo,productPrice:'R$ 49,90'}).get('data'));
    assert.deepEqual(data,{schemaVersion:2,campaignId:'sextou-classico-v1',company:'Cliente de teste',whatsapp:null,
      selections:[{id:'93',format:'video'}],sextou:{businessType:'auto',date:null,copyId:'trabalho-sabor',durationSeconds:10},
      showcase:{videoId:id,videoVersion:1},productPrice:'R$ 49,90'});
  }
});

function interfaceFixture(now=opens-1) {
  const items=orderShowcase(catalog.catalog.filter(item=>item.status==='published'));
  const makeCard=item=>{
    const attributes=new Map(),classes=new Map(),title={textContent:''};
    const notice={id:'release-'+item.id,hidden:true,querySelector:selector=>{assert.equal(selector,'strong');return title;}};
    const button={disabled:false,innerHTML:'',setAttribute:(name,value)=>attributes.set(name,value),removeAttribute:name=>attributes.delete(name)};
    const badge={hidden:true,textContent:''};
    return {dataset:{id:item.id},attributes,classes,notice,button,badge,title,
      classList:{toggle:(name,value)=>classes.set(name,value)},
      querySelector:selector=>{
        if(selector==='.release-notice')return notice;
        if(selector==='.make-button')return button;
        if(selector==='.profile-release')return badge;
        assert.fail('Release refresh must never touch media: '+selector);
      }};
  };
  const cards=items.map(makeCard),count={textContent:''},timers=new Map();let nextTimer=0;
  const context={cards,playlist:items,catalog:items,releaseTimer:undefined,orderCta:()=> 'Fazer meu pedido',
    order:{canRecover:()=>false},appCheckout:()=>true,appCreationAllowed:()=>null,orderCallToAction,
    Date:{now:()=>now},releaseInfo,icon:name=>'<svg data-icon="'+name+'"></svg>',
    document:{querySelector:selector=>{assert.equal(selector,'#orderable-count');return count;},
      querySelectorAll:selector=>{assert.equal(selector,'.profile-card');return cards;}},
    setTimeout(callback,delay){const id=++nextTimer;timers.set(id,{callback,delay});return id;},
    clearTimeout:id=>timers.delete(id),
    playback(){assert.fail('Release refresh must not change playback.');},
    renderFeed(){assert.fail('Release refresh must not rebuild/restart the feed.');},
  };
  const source=app.match(/function syncReleases\(\) \{[\s\S]*?\n\}/)?.[0];assert.ok(source);
  runInNewContext(source,context,{timeout:1000});
  return {context,cards,count,timers,setNow:value=>{now=value;}};
}

test('release sync shows only five timed notices while the hidden package has no customer card',()=>{
  const f=interfaceFixture();f.context.syncReleases();
  const held=new Set([...expected,...FUTURE_IDS]);
  for(const card of f.cards) {
    const locked=held.has(card.dataset.id);
    assert.equal(card.button.disabled,locked);assert.equal(card.notice.hidden,!locked);
    assert.equal(card.badge.hidden,!locked);assert.equal(card.classes.get('is-scheduled'),locked);
    if(locked) {
      const label=FUTURE_IDS.includes(card.dataset.id)?'Libera futuramente':'Desbloqueia amanhã';
      assert.equal(card.title.textContent,label);assert.equal(card.badge.textContent,label);
      assert.equal(card.attributes.get('aria-describedby'),card.notice.id);assert.match(card.button.innerHTML,/Em breve/);
    } else {
      assert.match(card.button.innerHTML,/Fazer meu pedido/);assert.equal(card.attributes.has('aria-describedby'),false);
    }
  }
  assert.equal(f.cards.some(card=>card.dataset.id===PRODUCT_PACKAGE_ID),false);
  assert.equal(f.count.textContent,22);assert.equal(f.timers.size,1);
  assert.equal([...f.timers.values()][0].delay,51);
});

test('exact release refresh unlocks the five in place, keeps the package hidden and schedules no rolling timer',()=>{
  const f=interfaceFixture();f.context.syncReleases();const before=f.cards.slice();
  f.setNow(opens);f.context.syncReleases();
  assert.equal(f.count.textContent,27);assert.equal(f.timers.size,0);
  assert.equal(f.cards.some(card=>card.dataset.id===PRODUCT_PACKAGE_ID),false);
  assert.ok(f.cards.every((card,index)=>card===before[index]),'No card or media element is replaced.');
  for(const card of f.cards) {
    const held=FUTURE_IDS.includes(card.dataset.id);
    assert.equal(card.button.disabled,held);assert.equal(card.notice.hidden,!held);assert.equal(card.badge.hidden,!held);
    if(!held)assert.equal(card.attributes.has('aria-describedby'),false);
  }
  f.setNow(opens+86400000);f.context.syncReleases();assert.equal(f.timers.size,0);assert.equal(f.count.textContent,27);
});

test('quota keeps a typed combos action visible and preserves recovery without rebuilding catalog media',()=>{
  const f=interfaceFixture(opens+1000);f.context.playlist=f.context.playlist.map((row,index)=>index===0?{...row,mediaKind:'image'}:row);
  const originals=f.cards.slice();
  f.context.appCreationAllowed=kind=>kind==='image'?true:false;f.context.syncReleases();
  assert.equal(f.cards[0].button.hidden,false);assert.match(f.cards[0].button.innerHTML,/Fazer meu pedido/);
  assert.equal(f.cards[1].button.hidden,false);assert.match(f.cards[1].button.innerHTML,/Ver combos para criar vídeos/);
  assert.doesNotMatch(f.cards[1].button.innerHTML,/artes acabaram/);assert.equal(f.cards[1].button.disabled,false);
  const pendingId=f.cards[1].dataset.id;f.context.order.canRecover=id=>id===pendingId;f.context.syncReleases();
  assert.equal(f.cards[1].button.hidden,false);assert.match(f.cards[1].button.innerHTML,/Conferir pedido/);
  f.context.appCreationAllowed=()=>null;f.context.syncReleases();assert.ok(f.cards.every(card=>!card.button.hidden));
  assert.ok(f.cards.every((card,index)=>card===originals[index]));
});

test('confirmed exhaustion offers combos while future releases and public storefront keep their own actions',()=>{
  const f=interfaceFixture();f.context.appCreationAllowed=()=>false;f.context.syncReleases();
  for(const card of f.cards) {
    assert.equal(card.button.hidden,false);
    if(card.button.disabled)assert.match(card.button.innerHTML,/Em breve/);
    else assert.match(card.button.innerHTML,/Suas artes acabaram · Ver combos/);
  }
  f.context.appCheckout=()=>false;f.context.syncReleases();
  for(const card of f.cards)if(!card.button.disabled)assert.match(card.button.innerHTML,/Peça pelo app/);
});

test('dual-format image models keep creation when either output is available and recovery wins at zero',()=>{
  const item={orderEnabled:true,mediaKind:'image',creativeTemplate:'posts-prontos-01-v1'};
  for(const kind of ['image','video'])assert.equal(orderCallToAction(item,{inApp:true,canCreate:value=>value===kind}).kind,'order');
  assert.equal(orderCallToAction(item,{inApp:true,canCreate:()=>null}).kind,'order');
  assert.equal(orderCallToAction(item,{inApp:true,canCreate:()=>false,recovering:true}).kind,'recovery');
  assert.equal(orderCallToAction(item,{inApp:true,canCreate:()=>false}).kind,'combos');
  assert.equal(orderCallToAction(item,{inApp:true,canCreate:()=>false,recovering:true,release:{}}).kind,'release');
  assert.equal(orderCallToAction({...item,orderEnabled:false},{inApp:true,canCreate:()=>false}).kind,'details');
  const fixedImage={orderEnabled:true,mediaKind:'image'};
  assert.equal(orderCallToAction(fixedImage,{inApp:true,canCreate:kind=>kind==='video'}).label,'Ver combos para criar imagens');
});
test('visibility, pageshow and focus refresh deadlines while the direct order action retains a guard',()=>{
  assert.match(app,/document\.addEventListener\('visibilitychange',\(\) => \{syncReleases\(\);playback\(\);\}\);/);
  assert.match(app,/addEventListener\('pageshow',syncReleases\);/);
  assert.match(app,/addEventListener\('focus',syncReleases\);/);
  const open=app.match(/function openPersonalize\(item\) \{[\s\S]*?\n\}/)?.[0];assert.ok(open);
  assert.match(open,/const release = releaseInfo\(item\);/);
  assert.match(open,/if \(release\) \{syncReleases\(\);toast\(release\.label\);return;\}/);
});
