import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
import {isReadyPost,feedItems} from '../ready-posts.js';
import {isExtraReadyPost,normalizeExtraFields,normalizeTemplateFieldObject,createExtraPostOptions} from '../ready-posts-extra.js';
import {buildMultipartOrder} from '../order-adapter.js';
import {fingerprintPayload} from '../order.js';

const catalog=JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const baseline=JSON.parse(await readFile(new URL('./fixtures/catalog-pre-extra40.json',import.meta.url),'utf8'));
const extras=catalog.catalog.filter(isExtraReadyPost);
const base={id:'12345678-1234-4123-8123-123456789abc',creativeTemplate:'posts-prontos-extra-25-v1',mediaKind:'image',photoRole:'person',allowDescription:false,allowProductPrice:false,primaryTemplate:'PARABÉNS, {{name}}!',secondaryTemplate:'É BOM TER VOCÊ NA EQUIPE.',personalizationFields:[{key:'name',label:'Nome da pessoa',required:true,multiline:false,maxLength:60}]};
class Element{constructor(tag='div'){this.tag=tag;this.children=[];this.value='';this.hidden=false;this.disabled=false;this.listeners=new Map();this.attributes=new Map();}append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}addEventListener(type,handler){this.listeners.set(type,handler);}setAttribute(key,value){this.attributes.set(key,value);}}
function fixture(t){const before=globalThis.document,ids=['extra-post-fields','order-photo-mode','order-photo-legend','order-photo-caption','order-photo','order-description-caption','order-product-description','order-description-note','order-product-price','order-product-price-field'];const nodes=new Map(ids.map(id=>[id,new Element()]));globalThis.document={querySelector:selector=>{assert.ok(nodes.has(selector.slice(1)),selector);return nodes.get(selector.slice(1));},createElement:tag=>new Element(tag)};t.after(()=>{if(before===undefined)delete globalThis.document;else globalThis.document=before;});const options=createExtraPostOptions({});const input=key=>nodes.get('extra-post-fields').children.flatMap(row=>row.children||[]).find(node=>node.name==='templateFields.'+key);return{options,nodes,input};}

test('forty extra models append without changing any of the70 released catalogue rows',()=>{
  assert.equal(extras.length,40);assert.equal(catalog.catalog.length,110);assert.deepEqual(catalog.catalog.slice(0,70),baseline.catalog);
  assert.deepEqual(catalog.dailySelection.videoIds,[...extras.map(row=>row.id),...baseline.dailySelection.videoIds]);
  const old=structuredClone(catalog);old.catalog=old.catalog.slice(0,70);const ids=new Set(old.catalog.map(row=>row.id));old.dailySelection.videoIds=old.dailySelection.videoIds.filter(id=>ids.has(id));assert.deepEqual(old,baseline);
  assert.equal(feedItems(catalog.catalog,'image').length,80);assert.equal(feedItems(catalog.catalog,'video').length,30);
});

test('every extra exposes only safe input metadata and an existing compressed preview',async()=>{
  for(const [index,item]of extras.entries()){
    assert.ok(isReadyPost(item));assert.equal(item.creativeTemplate,`posts-prontos-extra-${String(index+1).padStart(2,'0')}-v1`);
    assert.match(item.id,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    assert.equal(item.mediaKind,'image');assert.equal(item.outputPrices.image,990);assert.ok(item.outputPrices.video>=1990&&item.outputPrices.video<=2790);
    assert.match(item.poster,/^\.\/media\/posts-extra-20261029\/modelo-extra-\d\d\.webp$/);assert.ok((await stat(new URL('../'+item.poster.slice(2),import.meta.url))).size<400000);
    assert.ok(['product','person','place','none'].includes(item.photoRole));assert.equal(typeof item.allowDescription,'boolean');assert.equal(typeof item.allowProductPrice,'boolean');
    for(const field of item.personalizationFields){assert.equal(Object.hasOwn(field,'value'),false);assert.equal(Object.hasOwn(field,'defaultValue'),false);}
    for(const key of ['prompt','imagePrompt','videoPrompt','reference','referencePath','sha256'])assert.equal(Object.hasOwn(item,key),false,key);
  }
});

test('personalized values are plain strict NFC fields with controls checked before trim and UTF16 limits',()=>{
  assert.deepEqual(normalizeExtraFields(base,{name:'  JOA\u0303O  '}),{name:'JOÃO'});
  assert.equal(normalizeExtraFields(base,{name:'😀'.repeat(30)}).name.length,60);
  for(const value of [null,[],1,{}, {name:1},{name:''},{name:' ANA\n'},{name:'\nANA'},{name:'\tANA'},{name:'ANA\u2028'},{name:'😀'.repeat(31)},{name:'ANA',unknown:'x'}])assert.throws(()=>normalizeExtraFields(base,value));
  const hours={...base,personalizationFields:[{key:'hours',label:'Horários',required:true,multiline:true,maxLength:280}]};
  assert.deepEqual(normalizeExtraFields(hours,{hours:' Seg: 18h\r\nSáb: 17h '}),{hours:'Seg: 18h\nSáb: 17h'});
  assert.throws(()=>normalizeExtraFields(hours,{hours:'Seg:\t18h'}));
  assert.equal(normalizeExtraFields({...base,personalizationFields:[{key:'note',label:'Observação',required:false,multiline:false,maxLength:20}]},{note:'   '}),undefined);
});

test('subject-aware controls hide price and inappropriate uploads, and missing people never become sample names',t=>{
  const f=fixture(t);assert.equal(f.options.open(base),false);f.options.sync();
  assert.equal(f.nodes.get('order-photo-mode').hidden,true);assert.equal(f.nodes.get('order-photo-caption').hidden,false);assert.equal(f.nodes.get('order-product-price-field').hidden,true);
  assert.equal(f.options.previewPhrase(),'PARABÉNS!');assert.throws(()=>f.options.read(),/Nome da pessoa/);
  f.input('name').value='JOÃO';assert.equal(f.options.previewPhrase(),'PARABÉNS, JOÃO!');assert.deepEqual(f.options.read(),{name:'JOÃO'});
  f.options.sync(true);assert.equal(f.input('name').disabled,true);f.options.sync(false);assert.equal(f.input('name').disabled,false);
  f.options.open({...base,id:'other',photoRole:'place',allowDescription:true,requireReference:true,personalizationFields:[],primaryTemplate:'BOM DIA!'});f.options.sync();
  assert.equal(f.nodes.get('order-photo-mode').hidden,false);assert.equal(f.nodes.get('order-photo-legend').textContent,'Imagem do local');assert.equal(f.nodes.get('order-description-caption').textContent,'Descreva o local');
  assert.throws(()=>f.options.validateReference(null,''),/foto ou descreva o local/);assert.doesNotThrow(()=>f.options.validateReference({},''));assert.doesNotThrow(()=>f.options.validateReference(null,'Salão com parede verde.'));
  f.options.open({...base,id:'none',photoRole:'none',personalizationFields:[],primaryTemplate:'BOA NOITE!'});f.options.sync();assert.equal(f.options.allowPhoto(),false);assert.equal(f.options.allowDescription(),false);
  f.options.open({recipe:'sextou'});f.options.sync();assert.equal(f.nodes.get('order-photo-legend').textContent,'Imagem do produto');assert.equal(f.nodes.get('order-product-price-field').hidden,false);assert.equal(f.options.previewPhrase(),null);
});

test('all four clean product models keep an intentionally empty headline without a Sextou fallback',t=>{
  const f=fixture(t);
  for(const n of [5,6,7,8]){const item=extras[n-1];assert.equal(item.phrase,'');assert.equal(item.primaryTemplate,'');assert.equal(item.secondaryTemplate,'');f.options.open(item);assert.equal(f.options.previewPhrase(),'');}
});

test('wire format and order identity preserve personal fields without altering the calendar ticket',async()=>{
  const payload={videoId:base.id,videoVersion:1,company:'',durationSeconds:10,mediaKind:'image',consent:true,logo:{name:'logo.png',mime:'image/png',data:btoa('logo')},templateFields:{name:'  JOÃO '},appCalendar:{ticket:'12345678-1234-4123-8123-123456789abc.'+'a'.repeat(43)}};
  const data=JSON.parse(buildMultipartOrder(payload).get('data'));assert.deepEqual(data.templateFields,{name:'JOÃO'});assert.deepEqual(data.appCalendar,payload.appCalendar);assert.deepEqual(data.selections,[{id:'93',format:'image'}]);
  assert.notEqual(await fingerprintPayload(payload),await fingerprintPayload({...payload,templateFields:{name:'MARIA'}}));
  assert.throws(()=>buildMultipartOrder({...payload,mediaKind:undefined}));assert.throws(()=>normalizeTemplateFieldObject({name:'ANA\t'}));
});

test('optional animated previews are guarded to extras, deferred, contained and never alter default image choice',async()=>{
  const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),css=await readFile(new URL('../styles.css',import.meta.url),'utf8'),page=await readFile(new URL('../index.html',import.meta.url),'utf8');
  assert.match(app,/isExtraReadyPost\(item\) && typeof item\.video==='string' && item\.video/);
  const animated=app.match(/function createAnimatedPostCard\(item\) \{[\s\S]*?^\}/m)[0];assert.match(animated,/<video data-src=/);assert.match(animated,/preload="none"/);assert.doesNotMatch(animated,/<video src=/);assert.match(animated,/dataset\.mediaKind='image'/);
  assert.match(css,/\.animated-post-card video\{object-fit:contain!important/);assert.match(page,/data-media-kind="image" aria-selected="true"/);assert.match(page,/app\.js\?v=20261029-extra40/);
});
