import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NATIVE_MEDIA,nativeMediaPath,PRE_NATIVE_CATALOG_SHA256,restorePriorMediaForHistory} from './native-media-contract.mjs';

const data=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const before=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-native-audio.json',import.meta.url),'utf8'));
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');

test('native-audio update changes only ten authorized media fields and preserves all thirty cards and metadata',()=>{
  assert.equal(sha256(JSON.stringify(before)),PRE_NATIVE_CATALOG_SHA256);
  assert.equal(before.catalog.length,30);
  assert.equal(data.catalog.length,30);
  assert.deepEqual(data.catalog.map(row=>row.id),before.catalog.map(row=>row.id));
  const original=structuredClone(data);
  original.catalog=restorePriorMediaForHistory(original.catalog);
  assert.deepEqual(original,before,'Only the five authorized poster/video pairs may differ.');
  const changed=data.catalog.filter((item,index)=>JSON.stringify(item)!==JSON.stringify(before.catalog[index]));
  assert.deepEqual(changed.map(row=>row.id),NATIVE_MEDIA.map(row=>row.id));
  for(const item of changed) {
    const previous=before.catalog.find(row=>row.id===item.id);
    assert.deepEqual(Object.keys(item).filter(key=>JSON.stringify(item[key])!==JSON.stringify(previous[key])),['poster','video']);
  }
});

test('the ten native-audio assets are byte-identical to the authorized source files and old assets remain',async()=>{
  const expected=[];
  for(const row of NATIVE_MEDIA) {
    for(const type of ['poster','video']) {
      const relative=nativeMediaPath(row,type);
      expected.push(relative.split('/').at(-1));
      const bytes=await readFile(new URL('../'+relative.slice(2),import.meta.url));
      assert.equal(sha256(bytes),row.sha256[type],relative);
      assert.ok(bytes.length>100000,relative);
      if(type==='poster')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      else assert.equal(bytes.subarray(4,8).toString(),'ftyp');
      assert.ok((await stat(new URL('../'+row.previous[type].slice(2),import.meta.url))).size>100000);
    }
  }
  assert.deepEqual((await readdir(new URL('../media/audio-api-20261021/',import.meta.url))).sort(),expected.sort());
});

test('historical normalization refuses unrelated or unexpected media substitutions',()=>{
  const altered=structuredClone(data.catalog);
  altered.find(row=>row.id===NATIVE_MEDIA[0].id).video='./media/unapproved.mp4';
  assert.throws(()=>restorePriorMediaForHistory(altered));
  const restored=restorePriorMediaForHistory(data.catalog);
  for(const item of restored.filter(row=>!NATIVE_MEDIA.some(approved=>approved.id===row.id))) {
    assert.deepEqual(item,data.catalog.find(row=>row.id===item.id));
  }
});
