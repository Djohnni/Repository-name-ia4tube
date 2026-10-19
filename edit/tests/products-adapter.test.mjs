import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMultipartOrder,normalizeReceipt} from '../order-adapter.js';
import {PRODUCT_PACKAGES} from '../products-form.js';
const upload = index => ({name:'produto-'+index+'.png',mime:'image/png',data:btoa('foto-'+index)});
function payload(count) {
  return {videoId:'2830b796-2375-49e8-8e97-9a731c115252',videoVersion:1,company:'TESTE iA4tube',logo:upload('logo'),consent:true,
    photos:Array.from({length:count},(_,i)=>upload(i+1)),
    productsVideo:{packageCount:count,branch:'HAMBURGUERIA',openingText:'CONFIRA NOSSAS OFERTAS!',openingSeconds:6,
      whatsapp:'',instagram:'',location:'',items:Array.from({length:count},(_,i)=>({name:'PRODUTO '+(i+1),price:'R$ 19,90',seconds:4,speechOverrideEnabled:false,speechText:''}))}};
}
test('all four packages serialize ordered photos and metadata, keeping logo separate',async () => {
  assert.deepEqual(PRODUCT_PACKAGES,{2:3800,4:4800,6:5800,8:6800});
  for (const count of [2,4,6,8]) {
    const value=payload(count),form=buildMultipartOrder(value),data=JSON.parse(form.get('data'));
    assert.equal(data.campaignId,'produtos-cardapio-v1');
    assert.deepEqual(data.productsVideo,value.productsVideo);
    assert.deepEqual(data.selections,[{id:'93',format:'video'}]);
    assert.equal(data.whatsapp,null);assert.equal(data.sextou,undefined);assert.equal(data.durationSeconds,undefined);
    assert.equal(form.getAll('logo').length,1);
    assert.deepEqual(form.getAll('photos').map(file=>file.name),value.photos.map(file=>file.name));
    assert.deepEqual(await Promise.all(form.getAll('photos').map(file=>file.text())),value.photos.map(file=>atob(file.data)));
  }
});
test('mismatched photos and metadata are rejected before network',() => {
  const value=payload(4);value.photos.pop();assert.throws(()=>buildMultipartOrder(value),/quantidade/);
  const other=payload(2);other.productsVideo.items.pop();assert.throws(()=>buildMultipartOrder(other),/quantidade/);
});
test('products receipt fallback describes image count rather than undefined duration',() => {
  const receipt=normalizeReceipt({orderId:'test-order',status:'awaiting_authorization',totalCents:3800},payload(2));
  assert.match(receipt.message,/2 imagens/);assert.doesNotMatch(receipt.message,/undefined/);
});
