import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {modelMainPhrase,normalizeCustomPhrase} from '../custom-phrase.js';
import {buildMultipartOrder,normalizeReceipt} from '../order-adapter.js';
import {fingerprintPayload} from '../order.js';

const upload = {name:'logo.png',mime:'image/png',data:btoa('logo')};
const payload = {videoId:'07f18ce7-6ec8-4b9d-9bf7-ee11c288f52a',videoVersion:1,
  company:'',durationSeconds:10,logo:upload,photo:null,consent:true};
const data = value => JSON.parse(buildMultipartOrder(value).get('data'));

test('custom phrase preserves case, trims and normalizes NFC with inclusive UTF-16 limits',() => {
  for (const value of ['Oi','O MELHOR','Meu produto','x'.repeat(60),'😀'.repeat(30)]) {
    assert.equal(normalizeCustomPhrase('  '+value+'  ',{required:true}),value);
    assert.equal(data({...payload,customPhrase:'  '+value+'  '}).customPhrase,value);
  }
  assert.equal(normalizeCustomPhrase('  Pa\u0303o quentinho  '),'Pão quentinho');
  assert.equal(normalizeCustomPhrase('e\u0301'.repeat(60)),'é'.repeat(60),'Length is checked after NFC.');
  for (const value of ['', '   ','A','x'.repeat(61),'😀'.repeat(31),null,0,{},[]]) {
    assert.throws(()=>normalizeCustomPhrase(value,{required:true}),/2 a 60/);
  }
});

test('custom phrase rejects internal control characters and line separators',() => {
  for (const control of ['\n','\r','\t','\0','\x1f','\x7f','\u2028','\u2029']) {
    assert.throws(()=>normalizeCustomPhrase('O'+control+'MELHOR'),/uma linha/);
    assert.throws(()=>data({...payload,customPhrase:'O'+control+'MELHOR'}),/uma linha/);
  }
});

test('omitted or blank optional phrase leaves the legacy multipart JSON and uploads identical',async () => {
  const original = data({...payload,photo:upload});
  for (const customPhrase of [undefined,'','   ']) {
    const form = buildMultipartOrder({...payload,photo:upload,customPhrase});
    assert.deepEqual(JSON.parse(form.get('data')),original);
    assert.equal(form.getAll('photos').length,1);
    assert.equal(await form.get('photos').text(),'logo');
  }
  assert.equal(Object.hasOwn(original,'customPhrase'),false);
});

test('phrase coexists with description, product price and legacy company without changing the showcase',() => {
  const value = data({...payload,customPhrase:'O MELHOR',productDescription:'Hambúrguer com queijo',
    productPrice:'R$ 29,90',company:'Empresa antiga',photo:{mime:'ignored'}});
  assert.equal(value.customPhrase,'O MELHOR');assert.equal(value.productDescription,'Hambúrguer com queijo');
  assert.equal(value.company,'Empresa antiga');assert.equal(value.productPrice,'R$ 29,90');
  assert.deepEqual(value.showcase,{videoId:payload.videoId,videoVersion:payload.videoVersion});
  assert.equal(Object.hasOwn(value.showcase,'phrase'),false);
  assert.deepEqual(value.sextou,{businessType:'auto',date:null,copyId:'trabalho-sabor',durationSeconds:10});
});

test('package payload remains unchanged and cannot accept a custom main phrase',() => {
  const value = {...payload,company:'Empresa do pacote',photos:[upload,upload],
    productsVideo:{packageCount:2,items:[{name:'Produto 1'},{name:'Produto 2'}]}};
  const original = data(value);
  assert.deepEqual(data({...value,customPhrase:''}),original);
  assert.equal(Object.hasOwn(original,'customPhrase'),false);
  assert.throws(()=>data({...value,customPhrase:'O MELHOR'}),/somente.*individuais/);
});

test('model phrase helper adds the authorized headline only for the two exact classic IDs',() => {
  const phrase = 'O trabalho acabou. O sabor começou.';
  for (const id of ['4bb25879-a745-4577-812a-5a94286e324c','7503ea91-b4f7-41eb-9869-be10f23df935']) {
    assert.equal(modelMainPhrase({id,recipe:'sextou',phrase}),'SEXTOU! '+phrase);
    assert.equal(modelMainPhrase({id,recipe:'sextou',phrase:'SEXTOU! '+phrase}),'SEXTOU! '+phrase);
  }
  assert.equal(modelMainPhrase({id:'another-sextou',recipe:'sextou',phrase}),phrase);
  assert.equal(modelMainPhrase({phrase:'  O GRUPO JÁ DECIDIU.\nPARTIU LANCHE?\nBORA!  '}),'O GRUPO JÁ DECIDIU. PARTIU LANCHE? BORA!');
  assert.equal(modelMainPhrase({phrase:'Pa\u0303o  quentinho'}),'Pão quentinho');
});

test('model phrase helper has explicit legacy and reference fallbacks without mutating inputs',() => {
  for (const [item,expected] of [[{recipe:'sextou'},'SEXTOU!'],[{recipe:'sabadou',copyLabel:'Escolhida'},'Escolhida'],
    [{recipe:'sabadou',label:'Do sábado'},'Do sábado'],[{recipe:'sabadou'},'SABADOU!'],[{},'Referência visual']]) {
    const before = structuredClone(item);assert.equal(modelMainPhrase(item),expected);assert.deepEqual(item,before);
  }
});

test('custom phrase changes request identity and receipt while legacy supplied messages stay untouched',async () => {
  const a = await fingerprintPayload({...payload,customPhrase:'O MELHOR'});
  assert.equal(await fingerprintPayload({...payload,customPhrase:'O MELHOR'}),a);
  assert.notEqual(await fingerprintPayload({...payload,customPhrase:'MEU PREFERIDO'}),a);
  assert.notEqual(await fingerprintPayload(payload),a);
  const saved = {orderId:'phrase-order',status:'awaiting_authorization',totalCents:2400};
  assert.match(normalizeReceipt(saved,{...payload,customPhrase:'O MELHOR'}).message,/Frase principal: O MELHOR/);
  assert.doesNotMatch(normalizeReceipt(saved,payload).message,/Frase principal:/);
  const historical = 'Pedido: phrase-order\nMensagem preservada';
  assert.equal(normalizeReceipt({...saved,message:historical},{...payload,customPhrase:'O MELHOR'}).message,historical);
});

test('phrase editor is individual-only before logo, optional until chosen, and uses non-submit buttons',async () => {
  const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
  const group = page.match(/<section id="order-phrase-options"[\s\S]*?<\/section>/)?.[0];
  assert.ok(group);assert.match(group,/data-single-product/);
  assert.ok(page.indexOf('id="order-phrase-options"') < page.indexOf('id="order-logo"'));
  assert.match(group,/id="modify-main-phrase"[^>]*type="button"[^>]*aria-expanded="false"/);
  assert.match(group,/id="reset-main-phrase"[^>]*type="button"/);
  assert.match(group,/id="order-custom-phrase"[^>]*minlength="2"[^>]*maxlength="60"[^>]*disabled/);
  assert.doesNotMatch(group,/\brequired\b/);
  assert.doesNotMatch(page.match(/<fieldset id="products-options"[\s\S]*?<\/fieldset>/)?.[0],/customPhrase|main-phrase/);
});
