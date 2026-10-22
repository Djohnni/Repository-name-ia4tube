import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {relative,isAbsolute,sep} from 'node:path';
import {NATIVE_MEDIA,nativeMediaPath,PRE_NATIVE_CATALOG_SHA256,restorePriorMediaForHistory} from './native-media-contract.mjs';

const editUrl=new URL('../',import.meta.url);
const data=JSON.parse(await readFile(new URL('catalog.json',editUrl),'utf8'));
const previews=JSON.parse(await readFile(new URL('poster-previews.json',editUrl),'utf8'));
const published=data.catalog.filter(item=>item.status==='published');
const prefix='./media/previews-20261022/';
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const assetUrl=path=>new URL(path,editUrl);

function webpDimensions(bytes,label) {
  assert.ok(bytes.length>=30,label);
  assert.equal(bytes.toString('ascii',0,4),'RIFF',label);
  assert.equal(bytes.toString('ascii',8,12),'WEBP',label);
  assert.equal(bytes.readUInt32LE(4)+8,bytes.length,`${label}: complete RIFF payload`);
  let canvas=null,image=null,offset=12;
  while(offset<bytes.length) {
    assert.ok(offset+8<=bytes.length,`${label}: complete chunk header`);
    const kind=bytes.toString('ascii',offset,offset+4);
    const size=bytes.readUInt32LE(offset+4);
    const start=offset+8,end=start+size;
    assert.ok(end+(size%2)<=bytes.length,`${label}: complete ${kind} chunk`);
    if(kind==='VP8X') {
      assert.equal(size,10,`${label}: VP8X header size`);
      canvas=[bytes.readUIntLE(start+4,3)+1,bytes.readUIntLE(start+7,3)+1];
    }
    if(kind==='VP8 ') {
      assert.ok(size>=10,`${label}: complete VP8 frame header`);
      assert.equal(bytes[start]&1,0,`${label}: still-image key frame`);
      assert.equal(bytes.subarray(start+3,start+6).toString('hex'),'9d012a',label);
      image=[bytes.readUInt16LE(start+6)&0x3fff,bytes.readUInt16LE(start+8)&0x3fff];
    }
    offset=end+(size%2);
  }
  assert.ok(image,`${label}: encoded VP8 image is present`);
  if(canvas)assert.deepEqual(canvas,image,`${label}: canvas matches encoded image`);
  return image;
}

test('preview manifest covers exactly the twenty-eight published original posters',()=>{
  assert.equal(published.length,28);
  assert.equal(new Set(published.map(item=>item.poster)).size,28);
  assert.deepEqual(Object.keys(previews).sort(),published.map(item=>item.poster).sort());
  assert.equal(new Set(Object.values(previews)).size,28);
  for(const item of data.catalog.filter(item=>item.status!=='published')) {
    assert.equal(Object.hasOwn(previews,item.poster),false);
  }
});

test('all preview paths stay in the separate local directory and point to real files',async()=>{
  const mediaRoot=await realpath(new URL('media/',editUrl));
  const previewRoot=await realpath(new URL(prefix,editUrl));
  for(const[original,preview]of Object.entries(previews)) {
    assert.match(original,/^\.\/media\/(?:[a-z0-9-]+\/)*[a-z0-9-]+\.png$/);
    assert.equal(typeof preview,'string');
    assert.equal(preview,prefix+original.slice('./media/'.length).replace(/\.png$/,'.webp'));
    assert.notEqual(preview,original);
    for(const[root,path]of [[mediaRoot,original],[previewRoot,preview]]) {
      const inside=relative(root,await realpath(assetUrl(path)));
      assert.ok(inside&&!isAbsolute(inside)&&inside!=='..'&&!inside.startsWith('..'+sep),path);
    }
  }
});

test('valid WebP copies retain PNG dimensions, shrink every poster and save at least seventy-five percent',async t=>{
  let originalBytes=0,previewBytes=0;
  for(const[original,preview]of Object.entries(previews)) {
    const[png,webp]=await Promise.all([readFile(assetUrl(original)),readFile(assetUrl(preview))]);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a',original);
    assert.equal(png.toString('ascii',12,16),'IHDR',original);
    const dimensions=[png.readUInt32BE(16),png.readUInt32BE(20)];
    assert.deepEqual(dimensions,[720,1280],original);
    assert.deepEqual(webpDimensions(webp,preview),dimensions,preview);
    assert.ok(webp.length<png.length,`${preview}: smaller than original`);
    originalBytes+=png.length;previewBytes+=webp.length;
  }
  assert.ok(previewBytes<=originalBytes*.25,'Total previews must save at least 75%');
  t.diagnostic(JSON.stringify({posters:published.length,originalBytes,previewBytes,
    savedBytes:originalBytes-previewBytes,savedPercent:Number((100*(1-previewBytes/originalBytes)).toFixed(2))}));
});

test('preview copies preserve the catalog and original media contracts already pinned by existing fixtures',async()=>{
  const before=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-native-audio.json',import.meta.url),'utf8'));
  assert.equal(sha256(JSON.stringify(before)),PRE_NATIVE_CATALOG_SHA256);
  const historical=structuredClone(data);
  historical.catalog=restorePriorMediaForHistory(data.catalog);
  assert.deepEqual(historical,before,'Preview paths must not replace catalog poster or video fields.');
  // Reuse approved source hashes; do not invent baselines for other media.
  for(const approved of NATIVE_MEDIA) {
    for(const type of ['poster','video']) {
      const path=nativeMediaPath(approved,type);
      assert.equal(sha256(await readFile(assetUrl(path))),approved.sha256[type],path);
    }
  }
});
