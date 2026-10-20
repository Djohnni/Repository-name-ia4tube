import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {COMBO_EXAMPLES,PIZZA_EXAMPLES,NEW_MODELS,LEGACY_IDS,PRE_COMBO_CATALOG_SHA256} from './catalog-contract.mjs';
import {buildMultipartOrder} from '../order-adapter.js';

const data=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const before=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-combo.json',import.meta.url),'utf8'));
const comboIds=COMBO_EXAMPLES.map(row=>row[0]);

test('pre-combo checkpoint preserves all twenty-seven previous cards and root metadata exactly',()=>{
  assert.equal(before.catalog.length,27);
  assert.equal(createHash('sha256').update(JSON.stringify(before)).digest('hex'),PRE_COMBO_CATALOG_SHA256);
  assert.deepEqual(before.catalog.map(item=>item.id),
    [...LEGACY_IDS,...NEW_MODELS.map(row=>row[0]),...PIZZA_EXAMPLES.map(row=>row[0])]);
  assert.deepEqual(data.catalog.slice(0,27),before.catalog);
  assert.deepEqual(data.catalog.slice(27).map(item=>item.id),comboIds);
  const previous=structuredClone(data);
  previous.catalog=previous.catalog.slice(0,27);
  previous.dailySelection.videoIds=previous.dailySelection.videoIds.filter(id=>!comboIds.includes(id));
  assert.deepEqual(previous,before,'Only the three appended combo cards and their daily-selection IDs may differ.');
  assert.deepEqual(data.dailySelection.videoIds,[...before.dailySelection.videoIds,...comboIds]);
});

test('combo snapshots have separate IDs and the original recipes, phrases and R$21/R$24/R$24 quotes',()=>{
  for(const[id,template,price,phrase,title,media]of COMBO_EXAMPLES) {
    const original=NEW_MODELS.find(row=>row[1]===template);
    assert.ok(original);
    assert.equal(price,original[2]);
    assert.equal(phrase,original[3]);
    assert.ok(!PIZZA_EXAMPLES.some(row=>row[0]===id));
    const item=data.catalog.find(row=>row.id===id);
    assert.deepEqual(item,{
      title,label:title,kind:'Personalizado com sua logo e produto.',
      note:'Exemplo de combo com marca fictícia. Envie a foto do lanche ou do combo completo junto. Vídeo de 10 segundos; preço na arte é opcional.',
      video:`./media/combos-20261020/${media}.mp4`,
      poster:`./media/combos-20261020/${media}.png`,
      duration:10,recipe:'sextou',copyId:'trabalho-sabor',status:'published',featuredDate:'2026-10-20',
      creativeTemplate:template,id,version:1,creatorId:'ia4tube',phrase,orderEnabled:true,prices:{'10':price},
    });
    assert.deepEqual(Object.fromEntries(['id','version','title','recipe','copyId','phrase','creativeTemplate']
      .map(key=>[key,item[key]])),{id,version:1,title,recipe:'sextou',copyId:'trabalho-sabor',
      phrase,creativeTemplate:template});
  }
});

test('all three combo pairs use exact media filenames with genuine PNG/MP4 headers',async()=>{
  const expected=[];
  for(const[,,,,,name]of COMBO_EXAMPLES) {
    for(const ext of ['png','mp4']) {
      const filename=`${name}.${ext}`;
      expected.push(filename);
      const bytes=await readFile(new URL('../media/combos-20261020/'+filename,import.meta.url));
      assert.ok(bytes.length>100000,filename);
      if(ext==='png')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      else assert.equal(bytes.subarray(4,8).toString(),'ftyp');
    }
  }
  assert.deepEqual((await readdir(new URL('../media/combos-20261020/',import.meta.url))).sort(),expected.sort());
});

test('combo order carries its example ID, one complete-combo photo and optional product price',()=>{
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jz1sAAAAASUVORK5CYII=';
  for(const[id]of COMBO_EXAMPLES) {
    const form=buildMultipartOrder({videoId:id,videoVersion:1,company:'Hamburgueria de teste',
      durationSeconds:10,consent:true,productPrice:'R$ 69,90',
      logo:{name:'logo.png',mime:'image/png',data:png},
      photo:{name:'combo-completo.png',mime:'image/png',data:png}});
    const request=JSON.parse(form.get('data'));
    assert.deepEqual(request.showcase,{videoId:id,videoVersion:1});
    assert.equal(request.productPrice,'R$ 69,90');
    assert.equal(request.sextou.durationSeconds,10);
    for(const field of ['creativeTemplate','showcaseSnapshot','priceCents','totalCents','prompt','imagePrompt','videoPrompt','animal']) {
      assert.equal(Object.hasOwn(request,field),false,field);
    }
    assert.equal(form.getAll('logo').length,1);
    assert.equal(form.getAll('photos').length,1);
    assert.equal(form.get('photos').name,'combo-completo.png');
  }
});
