import {legacyVideoCatalog} from './legacy-catalog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {buildMultipartOrder,idempotencyKey,normalizeReceipt,safeWhatsAppUrl,SUBMIT_ENDPOINT} from '../order-adapter.js';
import {fingerprintPayload,getOrCreateRequestId,confirmSavedAttempt} from '../order.js';
import {LEGACY_IDS,LEGACY_CATALOG_SHA256,legacyItems,NEW_MODELS,PIZZA_EXAMPLES,COMBO_EXAMPLES} from './catalog-contract.mjs';
import {NATIVE_MEDIA,nativeMediaPath,restorePriorMediaForHistory} from './native-media-contract.mjs';

const id = 'b142f07c-6fb2-4b99-842f-b12817c88df3';
const orderId = 'd7f5c088-ece8-4e54-90c3-05ca6f9730e5';
const requestId = '0c521fbc-a903-44b8-af74-37cbda3c1371';
const bytes = Buffer.from([137,80,78,71,13,10,26,10,0,255,123]);
const payload = {
  videoId:id,videoVersion:2,company:'Empresa de teste',durationSeconds:10,consent:true,
  logo:{name:'logo original.png',mime:'image/png',data:bytes.toString('base64')},
  photo:{name:'produto original.jpg',mime:'image/jpeg',data:Buffer.from([255,216,0,128,255,217]).toString('base64')},
};
const message = 'Olá! Enviei meu pedido.\nPedido: ' + orderId;
const wa = text => 'https://wa.me/554791049079?text=' + encodeURIComponent(text);
const response = {orderId,status:'awaiting_authorization',totalCents:1990,whatsappMessage:message,whatsappUrl:wa(message)};
const memoryStorage = () => {
  const values = new Map();
  return {getItem:key => values.get(key) ?? null,setItem:(key,value) => values.set(key,String(value)),removeItem:key => values.delete(key)};
};

test('fixed public endpoint and exact multipart contract',() => {
  assert.equal(SUBMIT_ENDPOINT,'https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders');
  const form = buildMultipartOrder({...payload,creativeTemplate:'client-cannot-choose',price:1});
  assert.deepEqual([...form.keys()],['data','logo','photos']);
  assert.deepEqual(JSON.parse(form.get('data')),{
    schemaVersion:2,campaignId:'sextou-classico-v1',company:payload.company,whatsapp:null,
    selections:[{id:'93',format:'video'}],
    sextou:{businessType:'auto',date:null,copyId:'trabalho-sabor',durationSeconds:10},
    showcase:{videoId:id,videoVersion:2},
  });
});
test('uploads preserve exact file bytes, names and MIME',async () => {
  const form = buildMultipartOrder(payload);
  assert.equal(form.get('logo').name,payload.logo.name);
  assert.equal(form.get('logo').type,'image/png');
  assert.deepEqual(Buffer.from(await form.get('logo').arrayBuffer()),bytes);
  assert.equal(form.get('photos').name,payload.photo.name);
  assert.deepEqual(Buffer.from(await form.get('photos').arrayBuffer()),Buffer.from(payload.photo.data,'base64'));
});
test('photo is optional and 20s keeps the same selected model',() => {
  const form = buildMultipartOrder({...payload,photo:null,durationSeconds:20});
  assert.deepEqual([...form.keys()],['data','logo']);
  const data = JSON.parse(form.get('data'));
  assert.equal(data.sextou.durationSeconds,20);
  assert.deepEqual(data.showcase,{videoId:id,videoVersion:2});
});
test('invalid form data is rejected before network',() => {
  for (const patch of [
    {company:'x'},{company:'x'.repeat(101)},{durationSeconds:6},{videoId:'unknown'},
    {videoVersion:0},{videoVersion:2.5},{consent:false},{logo:null},
    {logo:{...payload.logo,mime:'text/html'}},{logo:{...payload.logo,data:'invalid!'}},
    {logo:{...payload.logo,name:'../logo.png'}},
  ]) assert.throws(() => buildMultipartOrder({...payload,...patch}));
});
test('100-character company is valid and surrounding whitespace is trimmed',() => {
  assert.equal(JSON.parse(buildMultipartOrder({...payload,company:'  '+'x'.repeat(100)+'  '}).get('data')).company.length,100);
});
test('idempotency key is the stable SHA256 of the request UUID',async () => {
  const key = await idempotencyKey(requestId);
  assert.match(key,/^[a-f0-9]{64}$/);
  assert.equal(key,createHash('sha256').update(requestId).digest('hex'));
  assert.equal(await idempotencyKey(requestId),key);
  await assert.rejects(() => idempotencyKey('not-a-request-id'));
});
test('same fingerprint reuses request ID; changed file/model creates another',async () => {
  const storage = memoryStorage();
  const fingerprint = await fingerprintPayload(payload);
  const first = getOrCreateRequestId(fingerprint,storage);
  assert.equal(getOrCreateRequestId(fingerprint,storage),first);
  const otherModel = await fingerprintPayload({...payload,videoVersion:3});
  assert.notEqual(getOrCreateRequestId(otherModel,storage),first);
  const otherFile = await fingerprintPayload({...payload,logo:{...payload.logo,data:'AQID'}});
  assert.notEqual(getOrCreateRequestId(otherFile,storage),first);
});
test('confirmed success automatically makes the next identical submission a new order',async () => {
  const storage = memoryStorage();
  const fingerprint = await fingerprintPayload(payload);
  const first = getOrCreateRequestId(fingerprint,storage);
  assert.throws(() => confirmSavedAttempt({fingerprint,requestId:first},storage));
  assert.equal(getOrCreateRequestId(fingerprint,storage),first);
  confirmSavedAttempt({orderId,status:'awaiting_authorization',fingerprint,requestId:first},storage);
  assert.notEqual(getOrCreateRequestId(fingerprint,storage),first);
});
test('old receipt cannot remove a newer tab attempt',async () => {
  const storage = memoryStorage();
  const fingerprint = await fingerprintPayload(payload);
  const newer = getOrCreateRequestId(fingerprint,storage);
  confirmSavedAttempt({orderId,status:'awaiting_authorization',fingerprint,requestId},storage);
  assert.equal(getOrCreateRequestId(fingerprint,storage),newer);
});
test('valid receipt retains order ID, API price, message and WhatsApp URL',() => {
  const result = normalizeReceipt(response,payload);
  assert.equal(result.orderId,orderId);
  assert.equal(result.totalCents,1990);
  assert.equal(result.message,message);
  assert.equal(new URL(result.whatsappUrl).searchParams.get('text'),message);
  assert.equal(new URL(safeWhatsAppUrl(result.whatsappUrl,message,orderId)).pathname,'/554791049079');
});
test('WhatsApp only accepts exact recipient and matching order message',() => {
  for (const url of [
    'http://wa.me/554791049079?text='+encodeURIComponent(message),
    'https://wa.me/5500000000000?text='+encodeURIComponent(message),
    'https://wa.me.evil.example/554791049079?text='+encodeURIComponent(message),
    'https://user:pass@wa.me/554791049079?text='+encodeURIComponent(message),
    wa(message)+'#other',wa(message)+'&next=other',wa(message)+'&text=other',wa('wrong order'),
    'javascript:alert(1)','/relative',
  ]) assert.throws(() => safeWhatsAppUrl(url,message,orderId));
  assert.throws(() => safeWhatsAppUrl(wa('unrelated'),'unrelated',orderId));
});
test('unsafe WhatsApp URL never discards a confirmed save or copy message',() => {
  const result = normalizeReceipt({...response,whatsappUrl:'https://evil.example/'},payload);
  assert.equal(result.orderId,orderId);
  assert.equal(result.whatsappUrl,'');
  assert.equal(result.message,message);
});
test('missing WhatsApp text falls back to message with confirmed order ID',() => {
  const result = normalizeReceipt({...response,whatsappMessage:null,message:'saved'},payload);
  assert.equal(result.orderId,orderId);
  assert.match(result.message,new RegExp(orderId));
  assert.match(result.message,/iA4tube/);
  assert.equal(result.whatsappUrl,'');
});
test('unconfirmed response cannot unlock success',() => {
  for (const patch of [{orderId:''},{status:'processing'},{totalCents:-1},{totalCents:19.9}]) {
    assert.throws(() => normalizeReceipt({...response,...patch},payload));
  }
});
test('catalog preserves eight exact legacy entries followed by sixteen recipes, three pizzas and three combos',async () => {
  const catalog = JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
  legacyVideoCatalog(catalog);
  assert.equal(catalog.catalog.length,30);
  assert.equal(new Set(catalog.catalog.map(item => item.id)).size,30);
  const legacy = legacyItems(catalog);
  assert.equal(legacy.length,8);
  assert.deepEqual(catalog.catalog.slice(0,8).map(item=>item.id),LEGACY_IDS);
  assert.equal(createHash('sha256').update(JSON.stringify(restorePriorMediaForHistory(legacy))).digest('hex'),LEGACY_CATALOG_SHA256);
  assert.deepEqual(catalog.prices,{'10':1990,'20':2990});
  assert.equal(legacy.filter(item => item.creativeTemplate).length,5);
  for (const existing of ['4bb25879-a745-4577-812a-5a94286e324c','7503ea91-b4f7-41eb-9869-be10f23df935']) {
    assert.equal(catalog.catalog.find(item => item.id === existing)?.version,3);
  }
  assert.equal(catalog.dailySelection.mode,'featured');
  const visible = catalog.catalog.filter(item => item.status === 'published');
  assert.equal(visible.length,28);
  assert.deepEqual(catalog.dailySelection.videoIds,visible.map(item => item.id));
  assert.ok(visible.slice(0,5).every(item => item.creativeTemplate && item.orderEnabled));
  assert.equal(legacy.at(-1).recipe,'produtos');
  assert.deepEqual(visible.slice(6,22).map(item=>item.id),NEW_MODELS.map(row=>row[0]));
  assert.deepEqual(visible.slice(22,25).map(item=>item.id),PIZZA_EXAMPLES.map(row=>row[0]));
  assert.deepEqual(visible.slice(25).map(item=>item.id),COMBO_EXAMPLES.map(row=>row[0]));
  assert.deepEqual(catalog.productsPrices,{'2':3800,'4':4800,'6':5800,'8':6800});
  assert.ok(visible.every(item => !/sextou|sabadou/i.test([item.label,item.title,item.phrase].join(' '))));
  assert.equal(catalog.catalog.filter(item => item.status === 'archived').length,2);
  assert.ok(!Object.hasOwn(catalog,'csrfToken'));
});
test('all catalog media/avatar paths resolve inside edit and exist',async () => {
  const catalog = JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
  legacyVideoCatalog(catalog);
  for (const item of catalog.catalog) {
    for (const type of ['poster','video']) {
      if(NATIVE_MEDIA.some(row=>row.id===item.id)) {
        assert.equal(item[type],nativeMediaPath(NATIVE_MEDIA.find(row=>row.id===item.id),type));
      } else if(item.id==='2830b796-2375-49e8-8e97-9a731c115252') {
        assert.equal(item[type],`./media/produtos-oburgao-20261022.${type==='poster'?'png':'mp4'}`);
      } else if(LEGACY_IDS.includes(item.id)) {
        assert.match(item[type],/^\.\/media\/(?:[a-f0-9-]{36}|produtos-cardapio)\.(png|mp4)$/);
      } else if(PIZZA_EXAMPLES.some(row=>row[0]===item.id)) {
        const example=PIZZA_EXAMPLES.find(row=>row[0]===item.id);
        assert.equal(item[type],`./media/pizzas-20261020/${example[5]}.${type==='poster'?'png':'mp4'}`);
      } else if(COMBO_EXAMPLES.some(row=>row[0]===item.id)) {
        const example=COMBO_EXAMPLES.find(row=>row[0]===item.id);
        assert.equal(item[type],`./media/combos-20261020/${example[5]}.${type==='poster'?'png':'mp4'}`);
      } else {
        const model=NEW_MODELS.find(row=>row[0]===item.id);
        assert.ok(model,'Only approved new media identifiers are allowed');
        assert.equal(item[type],`./media/novos-20261020/${model[1]}.${type==='poster'?'png':'mp4'}`);
      }
      const actual = await stat(new URL('../'+item[type].slice(2),import.meta.url));
      assert.ok(actual.size > 100000);
      assert.equal(new URL(item[type],'https://ia4tube.com/edit/').pathname.startsWith('/edit/media/'),true);
    }
  }
  const rootMedia=await readdir(new URL('../media/',import.meta.url));
  const additionDirectories=['audio-api-20261021','combos-20261020','novos-20261020','pizzas-20261020','posts-extra-20261029','posts-prontos-20261028','previews-20261022','sabado-20261024'];
  const replacementDemoFiles=['produtos-oburgao-20261022.mp4','produtos-oburgao-20261022.png'];
  assert.deepEqual(rootMedia.filter(name=>replacementDemoFiles.includes(name)).sort(),replacementDemoFiles);
  assert.equal(rootMedia.filter(name=>!additionDirectories.includes(name)&&!replacementDemoFiles.includes(name)).length,16);
  assert.deepEqual(rootMedia.filter(name=>additionDirectories.includes(name)).sort(),additionDirectories);
  assert.equal((await readdir(new URL('../media/novos-20261020/',import.meta.url))).length,32);
  assert.equal((await readdir(new URL('../media/pizzas-20261020/',import.meta.url))).length,6);
  assert.equal((await readdir(new URL('../media/combos-20261020/',import.meta.url))).length,6);
  assert.ok((await stat(new URL('../assets/logo.png',import.meta.url))).size > 0);
});
test('public entry files contain no local/admin/token/test marker dependencies',async () => {
  for (const name of ['index.html','app.js','order.js','order-adapter.js','availability.js','catalog.json','styles.css']) {
    const source = await readFile(new URL('../'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/127\.0\.0\.1|localhost|X-Vitrine-Token|csrfToken|\/admin|\[teste-criativo:/i,name);
  }
  const html = await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/maxlength="100"/);
  assert.match(html,/https:\/\/ia4tube\.com\/politica-de-privacidade\//);
  const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
  assert.match(app,/fetch\('\.\/catalog\.json'/);
  const releaseSync=app.match(/function syncReleases\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(releaseSync,'The scheduled CTA release must stay isolated from feed selection.');
  assert.match(releaseSync,/const now = Date\.now\(\);/);
  assert.doesNotMatch(app.replace(releaseSync,''),/new Date\(|Date\.now\(/); // The featured list itself never expires.
  assert.match(app,/catalog = orderShowcase\(data\.catalog\.filter\(item => item\.status === 'published'\)\);/);
  assert.match(app,/daily = orderShowcase\(\[\.\.\.new Set\(data\.dailySelection\.videoIds\)\]\.map\(id => byId\.get\(id\)\)\.filter\(Boolean\)\);/);
});
