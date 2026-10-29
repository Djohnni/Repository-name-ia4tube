import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {NEW_MODELS,LEGACY_IDS,PIZZA_EXAMPLES,COMBO_EXAMPLES} from './catalog-contract.mjs';

const data=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const additions=data.catalog.filter(item=>item.mediaKind!=='image' && !LEGACY_IDS.includes(item.id)
  && !PIZZA_EXAMPLES.some(row=>row[0]===item.id)
  && !COMBO_EXAMPLES.some(row=>row[0]===item.id));
const animals={capivara:'Capivara',preguica:'Bicho-preguiça',gato:'Gato',cachorro:'Cachorro',
  leao:'Leão',tigre:'Tigre',urso:'Urso',panda:'Panda',raposa:'Raposa',coelho:'Coelho'};

test('all sixteen approved models have exact identifiers, phrases and distinct authoritative ten-second quotes',()=>{
  assert.equal(additions.length,16);
  for(const [id,template,price,phrase]of NEW_MODELS) {
    const item=additions.find(row=>row.id===id);
    assert.ok(item,template);
    assert.equal(item.version,1);
    assert.equal(item.creativeTemplate,template);
    assert.equal(item.phrase,phrase);
    assert.equal(item.recipe,'sextou');
    assert.equal(item.copyId,'trabalho-sabor');
    assert.equal(item.duration,10);
    assert.equal(item.status,'published');
    assert.equal(item.orderEnabled,true);
    assert.equal(item.creatorId,'ia4tube');
    assert.deepEqual(item.prices,{'10':price});
    assert.ok(price>=2100&&price<=2800);
    for(const field of ['prompt','imagePrompt','videoPrompt','referencePath','productionModel']) {
      assert.equal(Object.hasOwn(item,field),false);
    }
  }
  assert.deepEqual(data.dailySelection.videoIds,data.catalog.filter(item=>item.status==='published').map(item=>item.id));
});

test('only the two animal models expose the exact selectable species and matching defaults',()=>{
  const animalItems=additions.filter(item=>item.animalOptions);
  assert.equal(animalItems.length,2);
  for(const item of additions) {
    const expected={'so-vim-olhar-v1':'capivara','preguica-delivery-v1':'preguica'}[item.creativeTemplate];
    if(expected) {
      assert.deepEqual(item.animalOptions,animals);
      assert.equal(item.defaultAnimal,expected);
    } else {
      assert.equal(Object.hasOwn(item,'animalOptions'),false);
      assert.equal(Object.hasOwn(item,'defaultAnimal'),false);
    }
  }
});

test('each new model has its own real PNG and MP4 in the isolated media directory',async()=>{
  const expected=[];
  for(const [,template]of NEW_MODELS) {
    for(const ext of ['png','mp4']) {
      const filename=`${template}.${ext}`;expected.push(filename);
      const bytes=await readFile(new URL('../media/novos-20261020/'+filename,import.meta.url));
      assert.ok(bytes.length>100000,filename);
      if(ext==='png')assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
      else assert.equal(bytes.subarray(4,8).toString(),'ftyp');
    }
  }
  assert.deepEqual((await readdir(new URL('../media/novos-20261020/',import.meta.url))).sort(),expected.sort());
});

test('political example is the approved neutral food phrase without names or voting numbers',()=>{
  const item=additions.find(row=>row.creativeTemplate==='depois-do-voto-v1');
  assert.equal(item.phrase,'DEPOIS DO VOTO, BORA DE LANCHE.');
  assert.match(item.note,/neutro, sem candidato ou partido/);
  assert.doesNotMatch(item.phrase,/\d/);
});
