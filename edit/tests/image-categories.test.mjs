import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {IMAGE_CATEGORIES,imageCategories,filterImageItems,categoryCounts,normalizeCategoryId} from '../image-categories.js';

const document=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const all=document.catalog,images=all.filter(item=>item.mediaKind==='image');
const byStyle=id=>images.find(item=>item.creativeTemplate===id);
const image=(title,extra={})=>({id:'future-model',mediaKind:'image',title,...extra});

test('the 80 current still images are classified under nine nonempty groups',()=>{
  assert.equal(images.length,80);assert.equal(IMAGE_CATEGORIES.length,9);
  const ids=new Set(IMAGE_CATEGORIES.map(category=>category.id));
  for(const category of IMAGE_CATEGORIES){assert.match(category.id,/^[a-z]+(?:-[a-z]+)*$/);assert.ok(category.label.length>2);}
  for(const item of images){const categories=imageCategories(item);assert.ok(categories.length>0,item.creativeTemplate);assert.equal(new Set(categories).size,categories.length);assert.ok(categories.every(id=>ids.has(id)));}
  const counts=categoryCounts(all);assert.equal(counts.all,80);
  for(const category of IMAGE_CATEGORIES)assert.ok(counts[category.id]>0,category.id);
  assert.equal(counts['dias-semana'],20);assert.equal(counts.saudacoes,4);assert.equal(counts.equipe,5);assert.equal(counts.mascotes,6);
});

test('classification uses released creativeTemplate identity rather than customer text',()=>{
  const greeting=byStyle('posts-prontos-extra-21-v1');
  assert.deepEqual(imageCategories(greeting),['saudacoes']);
  assert.deepEqual(imageCategories({...greeting,title:'Outro cliente e outro título',phrase:'PIZZA',label:'Campanha'}),['saudacoes']);
  assert.deepEqual(imageCategories(byStyle('posts-prontos-extra-25-v1')),['equipe']);
  assert.deepEqual(imageCategories(byStyle('posts-prontos-extra-30-v1')),['avisos']);
  assert.deepEqual(imageCategories(byStyle('posts-prontos-extra-09-v1')),['ambientes']);
  assert.deepEqual(imageCategories(byStyle('posts-prontos-extra-01-v1')),['interacao','produtos']);
  assert.deepEqual(imageCategories(byStyle('posts-prontos-12-v1')),['dias-semana','produtos']);
});

test('video and non-image records are never classified or returned by image filtering',()=>{
  const videos=all.filter(item=>item.mediaKind!=='image');assert.equal(videos.length,30);
  for(const item of [...videos,null,undefined,{}, {...images[0],mediaKind:'video'}])assert.deepEqual(imageCategories(item),[]);
  for(const id of ['all',...IMAGE_CATEGORIES.map(category=>category.id)])assert.ok(filterImageItems(all,id).every(item=>item.mediaKind==='image'));
});

test('filters preserve the exact relative order and object references without changing catalogue or prices',()=>{
  const before=JSON.stringify(document);
  for(const id of ['all',...IMAGE_CATEGORIES.map(category=>category.id)]){
    const selected=filterImageItems(all,id);
    assert.deepEqual(selected,images.filter(item=>id==='all'||imageCategories(item).includes(id)));
    let previous=-1;for(const item of selected){const next=all.indexOf(item);assert.ok(next>previous);previous=next;}
  }
  const first=imageCategories(images[0]);first.push('modified');assert.ok(!imageCategories(images[0]).includes('modified'));
  categoryCounts(all,'pizza');filterImageItems(all,'produtos','pizza');
  assert.equal(JSON.stringify(document),before);
  assert.equal(images[0].outputPrices.image,990);
});

test('category IDs normalize safely to All while non-array sources remain empty',()=>{
  assert.equal(normalizeCategoryId(' EQUIPE '),'equipe');
  for(const invalid of ['all','unknown','__proto__','constructor','',null,undefined,{},1])assert.equal(normalizeCategoryId(invalid),'all');
  assert.deepEqual(filterImageItems(null),[]);assert.deepEqual(filterImageItems({}),[]);
  assert.deepEqual(filterImageItems(all,'unknown'),images);
  assert.equal(categoryCounts(undefined).all,0);
});

test('future unknown image models remain discoverable in All with conservative fallback',()=>{
  const future=image('Minha nova arte');assert.deepEqual(imageCategories(future),['produtos']);
  assert.deepEqual(filterImageItems([future],'all'),[future]);assert.deepEqual(filterImageItems([future],'produtos'),[future]);
  assert.ok(imageCategories(image('NOVO HORÁRIO')).includes('avisos'));
  assert.ok(imageCategories(image('Bom dia na fachada',{photoRole:'place'})).includes('saudacoes'));
  assert.ok(imageCategories(image('Bom dia na fachada',{photoRole:'place'})).includes('ambientes'));
  assert.ok(imageCategories(image('SEXTÓU')).includes('dias-semana'));
  assert.ok(imageCategories(image('Dia Mundial da Pizza',{contentType:'product'})).includes('datas'));
  assert.ok(imageCategories(image('Um personagem novo',{defaultAnimal:'leao'})).includes('mascotes'));
});

test('word search is accent-insensitive, case-insensitive and combines terms using AND',()=>{
  assert.deepEqual(filterImageItems(all,'all','  HÓRÁRIO  '),filterImageItems(all,'all','horario'));
  assert.deepEqual(filterImageItems(all,'all','pizza borda').map(item=>item.creativeTemplate),['posts-prontos-extra-04-v1']);
  const names=filterImageItems(all,'all','PARABENS FUNCIONARIO').map(item=>item.creativeTemplate);
  assert.deepEqual(names,['posts-prontos-extra-25-v1','posts-prontos-extra-26-v1']);
  const future=image('Título',{label:'Aviso semanal',phrase:'Boa noite!',secondaryPhrase:'Pizza saindo quente.'});
  assert.deepEqual(filterImageItems([future],'all','semanal boa quente'),[future]);
  assert.deepEqual(filterImageItems([future],'all','semanal ausente'),[]);
  assert.deepEqual(filterImageItems(all,'equipe','pizza'),[]);
  assert.deepEqual(filterImageItems(all,'all','   '),images);
  assert.equal(categoryCounts(all,'pizza borda').all,1);assert.equal(categoryCounts(all,'pizza borda').interacao,1);
});
