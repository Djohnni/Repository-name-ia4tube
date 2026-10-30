import {legacyVideoCatalog} from './legacy-catalog.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {LEGACY_IDS,legacyItems} from './catalog-contract.mjs';
import {restorePriorMediaForHistory} from './native-media-contract.mjs';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
const catalogSource = await readFile(new URL('../catalog.json',import.meta.url),'utf8');
const catalog = JSON.parse(catalogSource);
legacyVideoCatalog(catalog);
const digest = value => createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fixture = {
  id:'visual-regression-fixture',label:'RÓTULO ÚNICO DO MODELO',title:'TÍTULO QUE FICA SÓ NOS DETALHES',
  kind:'DESCRIÇÃO QUE NÃO DEVE COBRIR O VÍDEO',note:'NOTA DO MODELO',
  video:'./media/example.mp4',poster:'./media/example.png',duration:10,orderEnabled:true,
};

function renderCard(item = fixture,videoOnly = false,insideApp=true) {
  const construction = app.match(/const article = document\.createElement\('article'\);[\s\S]*?article\.innerHTML = \x60[\s\S]*?\x60;/)?.[0];
  assert.ok(construction,'The actual article template must remain testable.');
  const article = {dataset:{},attributes:{},setAttribute(name,value){this.attributes[name] = value;}};
  runInNewContext(construction,{
    item,creator:catalog.creator,prices:catalog.prices,videoOnly,
    orderCta:runInNewContext(app.match(/const orderCta=[^\n]+/)[0]+'\norderCta',{appCheckout:()=>insideApp}),
    startingPrice:runInNewContext(app.match(/const startingPrice = [^\n]+/)[0] + '\nstartingPrice',
      {data:catalog,prices:catalog.prices},{timeout:1000}),
    esc:escapeHtml,mediaPath:value => value,posterPath:item => item.poster,
    money:cents => 'R$ ' + (cents / 100).toFixed(2).replace('.',','),
    icon:name => '<svg aria-hidden="true" data-icon="' + escapeHtml(name) + '"></svg>',
    document:{createElement(tag){assert.equal(tag,'article');return article;}},
  },{timeout:1000});
  return article;
}
const visibleText = html => html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

test('production distinguishes storefront CTA from app checkout for every existing video model',()=>{
  assert.match(app,/createOrderController\(\{[^\n]*appOnly:true/);
  for(const item of catalog.catalog){
    assert.match(renderCard(item,false,false).innerHTML,/class="make-button">Peça pelo app /);
    assert.match(renderCard(item,false,true).innerHTML,/class="make-button">Fazer meu pedido /);
  }
});
test('feed overlay has no model title, description, creator label or example badge',() => {
  const {innerHTML} = renderCard();
  assert.doesNotMatch(innerHTML,/\b(?:creator-label|model-kicker|caption|example-label|swipe-hint)\b/);
  assert.doesNotMatch(innerHTML,/<h[1-6]\b/i);
  const text = visibleText(innerHTML);
  for (const value of [fixture.label,fixture.title,fixture.kind,fixture.note,'iA4tube','Exemplo','Teste local']) {
    assert.ok(!text.includes(value),'Overlay must not include: ' + value);
  }
  assert.equal(text.replace('a partir de','').replace('R$ 19,90','').replace('Fazer meu pedido','').trim(),'');
});

test('three lateral controls retain only avatar, sound and interface toggle',() => {
  const {innerHTML} = renderCard();
  const actions = innerHTML.match(/<div class="video-actions">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(actions,'Lateral actions are retained.');
  const buttons = [...actions.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(buttons.length,3);
  ['creator-action','sound-toggle','interface-toggle'].forEach((className,index) => {
    assert.match(buttons[index],new RegExp('class="[^"]*\\b' + className + '\\b'));
    assert.match(buttons[index],/aria-label="[^"]+"/);
  });
  assert.match(buttons[0],/<img\b/);
  assert.match(buttons[2],/aria-label="Ocultar interface"/);
  assert.match(buttons[2],/aria-pressed="false"/);
  assert.match(buttons[2],/data-icon="eye-off"/);
  assert.equal([...innerHTML.matchAll(/<button\b/g)].length,4,'Only the three controls and order CTA are present.');
  assert.doesNotMatch(innerHTML,/\b(?:play-toggle|model-info)\b/);
});

test('each model keeps only its correct starting price and order action',() => {
  assert.equal(catalog.catalog.length,30);
  for (const item of catalog.catalog) {
    const {innerHTML} = renderCard(item);
    assert.equal([...innerHTML.matchAll(/class="offer-row"/g)].length,1);
    assert.equal([...innerHTML.matchAll(/class="offer-price"/g)].length,1);
    const expectedCents = item.recipe === 'produtos' ? 3800 : item.prices?.['10'] ?? 1990;
    assert.ok(innerHTML.includes('<strong>R$ ' + (expectedCents / 100).toFixed(2).replace('.',',') + '</strong>'));
    const cta = innerHTML.match(/<button class="make-button">([\s\S]*?)<\/button>/)?.[1];
    assert.equal(visibleText(cta || ''),'Fazer meu pedido');
  }
});

test('accessible article model name and video metadata are preserved',() => {
  const article = renderCard();
  assert.equal(article.attributes['aria-label'],fixture.label + ': ' + fixture.title);
  assert.equal(article.dataset.id,fixture.id);
  assert.match(article.innerHTML,/<video[^>]+aria-label="Vídeo RÓTULO ÚNICO DO MODELO"/);
  assert.match(article.innerHTML,/\bmuted loop playsinline preload="none"/);
  assert.match(article.innerHTML,/<video data-src="[^"]+" data-poster="[^"]+"/);
  assert.doesNotMatch(article.innerHTML,/<video[^>]*\s(?:src|poster)="/);
});

test('removed swipe hint leaves no DOM selector that can break navigation',() => {
  assert.doesNotMatch(page,/\bid="swipe-hint"/);
  assert.doesNotMatch(app,/#swipe-hint/);
  assert.match(app,/article\.querySelector\('\.make-button'\)\.addEventListener\('click',\(\) => openPersonalize\(item\)\)/);
  assert.doesNotMatch(app,/querySelector\('\.(?:model-info|play-toggle)'\)/);
  assert.match(app,/article\.querySelector\('\.creator-action'\)\.addEventListener\('click',\(\) => location\.hash = 'perfil'\)/);
});

test('video activation and Space preserve playback controls without a lateral play button',() => {
  assert.match(app,/article\.querySelector\('video'\)\.addEventListener\('click',activateVideo\)/);
  assert.match(app,/video\.addEventListener\('keydown',handleVideoKeydown\)/);
  assert.match(app,/if \(event\.key === ' '\) \{event\.preventDefault\(\);togglePlay\(\);\}/);
  const source = app.match(/function syncPlayButton\(card\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source,'Playback state must remain synchronizable.');
  const video = {paused:true,attributes:{},setAttribute(name,value){this.attributes[name]=value;}};
  const classes = new Map();
  const card = {classList:{toggle(name,value){classes.set(name,value);}},querySelector(selector){
    assert.equal(selector,'video','Do not query the removed lateral play button.');return video;
  }};
  const context = {};
  runInNewContext(source,context,{timeout:1000});
  assert.doesNotThrow(()=>context.syncPlayButton(null));
  context.syncPlayButton(card);assert.equal(classes.get('is-paused'),true);
  video.paused=false;context.syncPlayButton(card);assert.equal(classes.get('is-paused'),false);
});

test('legacy form stays intact apart from authorized individual options and package-only company',() => {
  const form = page.match(/<form id="order-form">[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  const company = form.match(/        (<label[^\n]*id="order-company"[^\n]*<\/label>)/)?.[1];
  assert.ok(company,'The existing company input belongs to the product package.');
  // Restore only the authorized UI additions, relocation and prior copy removals.
  const legacy = form.replace(/      <fieldset id="extra-post-fields"[^\n]*\r?\n/,'')
    .replace(' id="order-photo-mode"','').replace(' id="order-photo-legend"','')
    .replace('<span id="order-photo-caption" hidden></span>','')
    .replace(/      <fieldset id="products-options"[\s\S]*?      <\/fieldset>\r?\n/,'')
    .replace(/      <section id="order-phrase-options"[^\n]*\r?\n/,'')
    .replace(/      <fieldset class="product-image-mode"[^\n]*\r?\n/,'')
    .replace(/      <label id="order-description-field"[^\n]*\r?\n/,'')
    .replace(/      <label[^\n]*id="order-product-price"[^\n]*\r?\n/,'')
    .replace('data-single-product><input id="order-photo"','data-single-product>Foto do produto <span class="optional">opcional</span><input id="order-photo"')
    .replace(' aria-label="Foto do produto opcional"','')
    .replace(/ data-single-product/g,'').replace(' id="order-photo-field"','')
    .replace('<form id="order-form">','<form id="order-form">\n      '+company)
    .replace(/(<input id="order-logo"[^>]*>)(<\/label>)/,'$1<small>PNG, JPG ou WebP · até 5 MB</small>$2')
    .replace(/(<input id="order-photo"[^>]*>)(<\/label>)/,'$1<small>PNG, JPG ou WebP · até 10 MB</small>$2')
    .replace('<p class="order-explanation"></p>','<p class="order-explanation">A versão de 20s repete a animação de 10s. Você recebe o vídeo pelo WhatsApp.</p>')
    .replace('Enviar pedido pelo app','Salvar pedido e ir para o WhatsApp')
    .replace('Seu pedido ficará salvo. Acompanhe pelo app.','Seu pedido será salvo antes de abrir o WhatsApp. Combine a confirmação e os próximos passos com a iA4tube.');
  assert.equal(digest(legacy),'2a55a61ece259903033a54ef10ae2076a3e6e9934fc8700791908688a1b8cb5f');
  assert.match(form,/name="duration" value="10" checked/);
  assert.match(form,/name="duration" value="20"/);
});

test('photo upload has no repeated visible label and keeps its accessible name and optional file contract',() => {
  const field=page.match(/<label id="order-photo-field"[^\n]*<\/label>/)?.[0];
  assert.ok(field);
  assert.equal(field.replace(/<[^>]*>/g,''),'');
  assert.match(field,/<input id="order-photo" type="file" name="photo" accept="image\/png,image\/jpeg,image\/webp" aria-label="Foto do produto opcional">/);
  assert.doesNotMatch(field,/\brequired\b|class="optional"/);
});

test('order form removes only requested fixed helper copy and keeps compatibility node',async () => {
  for (const id of ['order-logo','order-photo','order-product-price']) {
    const field=page.match(new RegExp('<label[^\\n]*id="'+id+'"[^\\n]*<\\/label>'))?.[0];
    assert.ok(field,id);
    assert.doesNotMatch(field,/<small>/);
  }
  assert.match(page,/<p class="order-explanation" data-single-product><\/p>/);
  assert.doesNotMatch(page,/Deixe vazio para não mostrar valor na arte|A versão de 20s repete a animação de 10s/);
  assert.match(page,/até 10 MB por foto e 24 MB no total/);
  const css=await readFile(new URL('../styles.css',import.meta.url),'utf8');
  assert.match(css,/\.order-explanation:empty\s*\{\s*display:\s*none;?\s*\}/);
});

test('archiving weekend cards preserves every model, media reference and price',() => {
  const original = structuredClone(catalog);
  original.catalog = restorePriorMediaForHistory(legacyItems(original).filter(row => row.recipe !== 'produtos'));
  original.dailySelection.videoIds = original.dailySelection.videoIds.filter(id => LEGACY_IDS.includes(id) && id !== '2830b796-2375-49e8-8e97-9a731c115252');
  original.dailySelection.date = '2026-10-18';
  delete original.productsPrices;
  const weekendIds = ['4bb25879-a745-4577-812a-5a94286e324c','7503ea91-b4f7-41eb-9869-be10f23df935'];
  for (const id of weekendIds) {
    const item = original.catalog.find(row => row.id === id);
    assert.equal(item.status,'archived');
    assert.equal(item.featuredDate,null);
    item.status = 'published';
    item.featuredDate = '2026-10-18';
  }
  original.dailySelection.videoIds.unshift(...weekendIds);
  assert.equal(digest(JSON.stringify(original,null,2)+'\n'),'1bf55daed8fe8a351ad7a79c40a427c33b1bd57deae6715c458d7cf8cfd3c56f');
  assert.deepEqual(catalog.prices,{'10':1990,'20':2990});
  assert.equal(legacyItems(catalog).filter(item => item.creativeTemplate).length,5);
  assert.equal(legacyItems(catalog).filter(item => !item.creativeTemplate && item.recipe !== 'produtos').length,2);
});

test('top navigation, profile and model details remain available',() => {
  for (const id of ['profile-view','profile-grid','personalize-dialog','chosen-title','chosen-kicker','chosen-phrase','model-note','preview-info']) {
    assert.ok(page.includes('id="' + id + '"'),id);
  }
  assert.match(page,/data-media-kind="image" aria-selected="true">Imagens<\/button>/);
  assert.match(page,/href="#perfil"/);
  assert.match(app,/function renderProfile\(\)/);
  assert.match(app,/document\.querySelector\('#chosen-title'\)\.textContent = item\.title/);
});
