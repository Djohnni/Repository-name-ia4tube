import test from 'node:test';
import assert from 'node:assert/strict';
import {captureOrderOrigin,resolveOrderOrigin} from '../order-origin.js';
const image=id=>({id,version:1,mediaKind:'image'}),video=id=>({id,version:1});
test('return preserves daily order and next model instead of silently switching to full catalog',()=>{
  const chosen=video('chosen'),next=video('next'),previous=video('previous'),other=video('catalog-only');
  const origin=captureOrderOrigin({item:chosen,items:[previous,chosen,next],key:'video-daily',hash:'#hoje'});
  const restored=resolveOrderOrigin(JSON.parse(JSON.stringify(origin)),[other,next,chosen,previous]);
  assert.deepEqual(restored.items.map(item=>item.id),['previous','chosen','next']);assert.equal(restored.index,1);
  assert.equal(restored.key,'video-daily');assert.equal(restored.hash,'#hoje');
});
test('image filters and selected model survive return; origin has no capability or upload',()=>{
  const chosen=image('chosen'),next=image('next');
  const origin=captureOrderOrigin({item:chosen,items:[chosen,next],key:'image-profile-food-cake',hash:'#video/chosen',categoryId:'food',query:'cake'});
  const restored=resolveOrderOrigin(origin,[next,chosen],{categoryIds:['all','food']});
  assert.equal(restored.categoryId,'food');assert.equal(restored.query,'cake');assert.equal(restored.mediaKind,'image');
  assert.equal(restored.index,0);assert.equal(restored.hash,'#video/chosen');
  assert.deepEqual(Object.keys(origin).sort(),['schemaVersion','modelId','modelVersion','mediaKind','playlistIds','playlistKey','hash','categoryId','query'].sort());
});
test('removed media, changed versions and damaged stored context never select an unrelated item',()=>{
  assert.equal(resolveOrderOrigin({modelId:'gone'},[image('other')]),null);
  const changed=resolveOrderOrigin({schemaVersion:1,modelId:'chosen',modelVersion:1,playlistIds:['gone','chosen'],playlistKey:'image-daily',hash:'https://attacker.invalid',categoryId:'invalid'},[{...image('chosen'),version:2}]);
  assert.equal(changed.changed,true);assert.equal(changed.key,'image-daily-version-2');assert.equal(changed.hash,'#video/chosen');
  assert.deepEqual(changed.items.map(item=>item.id),['chosen']);assert.equal(changed.categoryId,'all');
  assert.deepEqual(resolveOrderOrigin({modelId:'chosen',playlistIds:['other','other']},[video('other'),image('chosen')]).items.map(item=>item.id),['chosen']);
});
