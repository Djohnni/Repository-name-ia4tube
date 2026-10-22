import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeProductDescription} from '../product-description.js';
import {buildMultipartOrder,normalizeReceipt} from '../order-adapter.js';
import {fingerprintPayload} from '../order.js';

const upload = {name:'logo.png',mime:'image/png',data:btoa('logo')};
const payload = {videoId:'b142f07c-6fb2-4b99-842f-b12817c88df3',videoVersion:2,
  company:'',durationSeconds:10,logo:upload,photo:null,consent:true};
const data = value => JSON.parse(buildMultipartOrder(value).get('data'));

test('description is trimmed and accepts the inclusive five and five-hundred character limits',() => {
  for (const value of ['Pizza','x'.repeat(500),'Pão de brioche, carne, queijo\ne salada.']) {
    assert.equal(normalizeProductDescription('  '+value+'  ',{required:true}),value);
    assert.equal(data({...payload,productDescription:'  '+value+'  '}).productDescription,value);
  }
  for (const value of ['', '   ', 'abcd','x'.repeat(501),null,5,{},[]]) {
    assert.throws(()=>normalizeProductDescription(value,{required:true}),/5 a 500/);
  }
});

test('absent or blank descriptions keep the legacy multipart JSON unchanged',() => {
  const old = {...payload,company:'Empresa antiga',photo:upload};
  const original = data(old);
  assert.equal(Object.hasOwn(original,'productDescription'),false);
  for (const productDescription of [undefined,'','   ']) {
    assert.deepEqual(data({...old,productDescription}),original);
    assert.equal(buildMultipartOrder({...old,productDescription}).getAll('photos').length,1);
  }
});

test('description mode sends the logo and description without any previously selected photo',() => {
  const form = buildMultipartOrder({...payload,photo:{mime:'invalid old file'},productDescription:'Pizza de calabresa'});
  assert.deepEqual([...form.keys()],['data','logo']);
  assert.equal(JSON.parse(form.get('data')).productDescription,'Pizza de calabresa');
  assert.equal(JSON.parse(form.get('data')).company,'');
});

test('single models accept an empty company while legacy company values remain intact',() => {
  for (const company of [undefined,'','   ']) assert.equal(data({...payload,company}).company,'');
  assert.equal(data({...payload,company:'  Empresa antiga  '}).company,'Empresa antiga');
  for (const company of ['A','x'.repeat(101)]) assert.throws(()=>data({...payload,company}),/empresa/);
});

test('product packages still require company and photos and reject the single-product description',() => {
  const packagePayload = {...payload,company:'Empresa do pacote',photos:[upload,upload],
    productsVideo:{packageCount:2,items:[{name:'Produto 1'},{name:'Produto 2'}]}};
  assert.equal(data(packagePayload).company,'Empresa do pacote');
  for (const company of [undefined,'','A']) assert.throws(()=>data({...packagePayload,company}),/empresa/);
  assert.throws(()=>data({...packagePayload,photos:[upload]}),/quantidade/);
  assert.throws(()=>data({...packagePayload,productDescription:'Pizza de calabresa'}),/somente.*individuais/);
  assert.equal(Object.hasOwn(data(packagePayload),'productDescription'),false);
});

test('description affects request identity without changing fingerprinting of legacy payloads',async () => {
  const first = await fingerprintPayload({...payload,productDescription:'Pizza de calabresa'});
  assert.equal(await fingerprintPayload({...payload,productDescription:'Pizza de calabresa'}),first);
  assert.notEqual(await fingerprintPayload({...payload,productDescription:'Pizza de queijo'}),first);
  assert.notEqual(await fingerprintPayload(payload),first);
});

test('receipt fallback includes description and omits an empty company while old receipts stay intact',() => {
  const saved = {orderId:'description-order',status:'awaiting_authorization',totalCents:1990};
  const described = normalizeReceipt(saved,{...payload,productDescription:'Hambúrguer com queijo'});
  assert.match(described.message,/Descrição do produto: Hambúrguer com queijo/);
  assert.doesNotMatch(described.message,/Estabelecimento:|undefined|null/);
  const old = normalizeReceipt(saved,{...payload,company:'Empresa antiga'});
  assert.match(old.message,/Estabelecimento: Empresa antiga/);
  assert.doesNotMatch(old.message,/Descrição do produto:/);
  const historicalMessage = 'Pedido: description-order\nEstabelecimento: Nome histórico';
  assert.equal(normalizeReceipt({...saved,whatsappMessage:historicalMessage},payload).message,historicalMessage);
});

test('only individual models expose image choice and the company field belongs to the package',async () => {
  const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
  const beforePackage = page.split('<fieldset id="products-options"')[0];
  const packageMarkup = page.match(/<fieldset id="products-options"[\s\S]*?<\/fieldset>/)?.[0];
  assert.doesNotMatch(beforePackage,/id="order-company"/);
  assert.match(packageMarkup,/id="order-company"[^>]*minlength="2"[^>]*maxlength="100"[^>]*required/);
  assert.doesNotMatch(packageMarkup,/productDescription|productImageMode|Não tenho foto/);
  assert.match(beforePackage,/id="order-has-photo"[^>]*checked>Tenho foto/);
  assert.match(beforePackage,/id="order-no-photo"[^>]*>Não tenho foto/);
  assert.match(beforePackage,/id="order-product-description"[^>]*minlength="5"[^>]*maxlength="500"/);
  assert.match(beforePackage,/Ex\.: hambúrguer com pão de brioche, carne, queijo, alface e tomate/);
  assert.match(beforePackage,/A imagem criada será ilustrativa/);
});
