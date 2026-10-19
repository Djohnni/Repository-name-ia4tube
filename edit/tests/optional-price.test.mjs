import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeProductPrice} from '../optional-price.js';
import {buildMultipartOrder,normalizeReceipt} from '../order-adapter.js';
import {fingerprintPayload,getOrCreateRequestId} from '../order.js';

const payload = {videoId:'b142f07c-6fb2-4b99-842f-b12817c88df3',videoVersion:2,
  company:'TESTE iA4tube',durationSeconds:10,consent:true,
  logo:{name:'logo.png',mime:'image/png',data:btoa('logo')}};
const data = value => JSON.parse(buildMultipartOrder(value).get('data'));

test('optional price accepts BRL amounts and trims surrounding whitespace',() => {
  for(const price of ['R$ 29,90','29,90','19','1.299,90','R$ 9.999.999,99','0,00']) {
    assert.equal(normalizeProductPrice('  '+price+'  '),price);
    assert.equal(data({...payload,productPrice:price}).productPrice,price);
  }
});
test('missing or blank price preserves exact old multipart data',() => {
  const previous = data(payload);
  assert.equal(Object.hasOwn(previous,'productPrice'),false);
  for(const productPrice of ['', '   ', '\n ']) {
    assert.deepEqual(data({...payload,productPrice}),previous);
  }
  assert.equal(normalizeProductPrice(undefined),'');
});
test('malformed or instruction text price is rejected before sending',() => {
  for(const productPrice of [null,29.90,{},[],true,'-1','R$ 1.50','R$ 10,9','A PARTIR DE 19,90',
      '<script>','R$ 10\n99','R$\t29,90','R$ 10.000.000,00','x'.repeat(31)]) {
    assert.throws(()=>buildMultipartOrder({...payload,productPrice}),/preço/);
  }
});
test('product price is distinct from service pricing and receipt keeps both',() => {
  const withPrice = {...payload,productPrice:'R$ 99,90'};
  assert.deepEqual(data(withPrice).sextou,data(payload).sextou);
  const receipt=normalizeReceipt({orderId:'price-test',status:'awaiting_authorization',totalCents:1990},withPrice);
  assert.equal(receipt.totalCents,1990);
  assert.match(receipt.message,/Preço do produto na arte: R\$ 99,90/);
});
test('changing price changes idempotent attempt; repeating it keeps the same attempt',async () => {
  const map=new Map(),storage={getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};
  const fingerprint=await fingerprintPayload({...payload,productPrice:'R$ 19,90'});
  const first=getOrCreateRequestId(fingerprint,storage);
  assert.equal(getOrCreateRequestId(fingerprint,storage),first);
  assert.notEqual(getOrCreateRequestId(await fingerprintPayload({...payload,productPrice:'R$ 29,90'}),storage),first);
});
test('single-product price input is optional and excluded from multiproduct mode',async () => {
  const page=await readFile(new URL('../index.html',import.meta.url),'utf8');
  const field=page.match(/<label[^\n]*id="order-product-price"[^\n]*<\/label>/)?.[0];
  assert.ok(field);
  assert.match(field,/data-single-product/);
  assert.match(field,/maxlength="30"/);
  assert.doesNotMatch(field,/required/);
  const source=await readFile(new URL('../order.js',import.meta.url),'utf8');
  assert.match(source,/if \(!products.isEnabled\(\)\)/);
});
