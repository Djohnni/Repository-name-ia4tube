import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {orderShowcase} from '../availability.js';
import {PRODUCTS_DEMO_ID,PRE_PRODUCTS_DEMO_CATALOG_SHA256,PRODUCTS_DEMO_VIDEO_SHA256,
  PRODUCTS_DEMO_PREVIOUS,PRODUCTS_DEMO_CURRENT,restorePriorProductDemoForHistory} from './products-demo-contract.mjs';

const data=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const item=data.catalog.find(row=>row.id===PRODUCTS_DEMO_ID);

test('Ô Burgão demo changes only four approved presentation fields relative to released HEAD4854552d',()=>{
  const previous=structuredClone(data);
  previous.catalog=restorePriorProductDemoForHistory(data.catalog);
  assert.equal(sha256(JSON.stringify(previous)),PRE_PRODUCTS_DEMO_CATALOG_SHA256,
    'No unrelated catalog item, metadata, pricing, order, or production binding may change.');
  assert.deepEqual(Object.fromEntries(Object.keys(PRODUCTS_DEMO_CURRENT).map(key=>[key,item[key]])),PRODUCTS_DEMO_CURRENT);
  assert.deepEqual(Object.keys(item).filter(key=>item[key]!==previous.catalog.find(row=>row.id===item.id)[key]).sort(),
    Object.keys(PRODUCTS_DEMO_CURRENT).sort());
  assert.equal(item.version,1);
  assert.equal(item.recipe,'produtos');
  assert.equal(item.orderEnabled,true);
  assert.equal(item.status,'published');
  assert.equal(orderShowcase(data.catalog.filter(row=>row.status==='published'))[2].id,PRODUCTS_DEMO_ID);
  assert.deepEqual(data.productsPrices,{'2':3800,'4':4800,'6':5800,'8':6800});
});

test('published product demo is the exact corrected delivery and preserves earlier demo assets',async()=>{
  const video=await readFile(new URL('../'+PRODUCTS_DEMO_CURRENT.video.slice(2),import.meta.url));
  assert.equal(sha256(video),PRODUCTS_DEMO_VIDEO_SHA256);
  assert.equal(video.subarray(4,8).toString(),'ftyp');
  const poster=await readFile(new URL('../'+PRODUCTS_DEMO_CURRENT.poster.slice(2),import.meta.url));
  assert.equal(poster.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.deepEqual([poster.readUInt32BE(16),poster.readUInt32BE(20)],[720,1280]);
  for(const type of ['video','poster'])assert.ok((await stat(new URL('../'+PRODUCTS_DEMO_PREVIOUS[type].slice(2),import.meta.url))).size>100000);
});

test('product demo historical normalization refuses unapproved replacement values and preserves other fields',()=>{
  for(const key of Object.keys(PRODUCTS_DEMO_CURRENT)) {
    const changed=structuredClone(data.catalog);
    changed.find(row=>row.id===PRODUCTS_DEMO_ID)[key]=key==='duration'?26:'unapproved';
    assert.throws(()=>restorePriorProductDemoForHistory(changed));
  }
  const changed=structuredClone(data);
  changed.catalog.find(row=>row.id===PRODUCTS_DEMO_ID).version=2;
  changed.catalog=restorePriorProductDemoForHistory(changed.catalog);
  assert.notEqual(sha256(JSON.stringify(changed)),PRE_PRODUCTS_DEMO_CATALOG_SHA256,
    'A production-version mutation must remain visible to the checkpoint check.');
});
