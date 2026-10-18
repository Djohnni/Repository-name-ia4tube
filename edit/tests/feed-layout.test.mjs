import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const app = await readFile(new URL('../app.js',import.meta.url),'utf8');
const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
const catalogSource = await readFile(new URL('../catalog.json',import.meta.url),'utf8');
const catalog = JSON.parse(catalogSource);
const digest = value => createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const fixture = {
  id:'visual-regression-fixture',label:'RÓTULO ÚNICO DO MODELO',title:'TÍTULO QUE FICA SÓ NOS DETALHES',
  kind:'DESCRIÇÃO QUE NÃO DEVE COBRIR O VÍDEO',note:'NOTA DO MODELO',
  video:'./media/example.mp4',poster:'./media/example.png',duration:10,orderEnabled:true,
};

function renderCard(item = fixture,videoOnly = false) {
  const construction = app.match(/const article = document\.createElement\('article'\);[\s\S]*?article\.innerHTML = \x60[\s\S]*?\x60;/)?.[0];
  assert.ok(construction,'The actual article template must remain testable.');
  const article = {dataset:{},attributes:{},setAttribute(name,value){this.attributes[name] = value;}};
  runInNewContext(construction,{
    item,creator:catalog.creator,prices:catalog.prices,videoOnly,
    esc:escapeHtml,mediaPath:value => value,
    money:cents => 'R$ ' + (cents / 100).toFixed(2).replace('.',','),
    icon:name => '<svg aria-hidden="true" data-icon="' + escapeHtml(name) + '"></svg>',
    document:{createElement(tag){assert.equal(tag,'article');return article;}},
  },{timeout:1000});
  return article;
}
const visibleText = html => html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();

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

test('five lateral controls retain avatar, sound, play, information and interface toggle',() => {
  const {innerHTML} = renderCard();
  const actions = innerHTML.match(/<div class="video-actions">([\s\S]*?)<\/div>/)?.[1];
  assert.ok(actions,'Lateral actions are retained.');
  const buttons = [...actions.matchAll(/<button\b[\s\S]*?<\/button>/g)].map(match => match[0]);
  assert.equal(buttons.length,5);
  ['creator-action','sound-toggle','play-toggle','model-info','interface-toggle'].forEach((className,index) => {
    assert.match(buttons[index],new RegExp('class="[^"]*\\b' + className + '\\b'));
    assert.match(buttons[index],/aria-label="[^"]+"/);
  });
  assert.match(buttons[0],/<img\b/);
  assert.match(buttons[4],/aria-label="Ocultar interface"/);
  assert.match(buttons[4],/aria-pressed="false"/);
  assert.match(buttons[4],/data-icon="eye-off"/);
  assert.equal([...innerHTML.matchAll(/<button\b/g)].length,6,'Only the five controls and order CTA are present.');
});

test('price and Fazer meu pedido are the only offer line, for all seven models',() => {
  assert.equal(catalog.catalog.length,7);
  for (const item of catalog.catalog) {
    const {innerHTML} = renderCard(item);
    assert.equal([...innerHTML.matchAll(/class="offer-row"/g)].length,1);
    assert.equal([...innerHTML.matchAll(/class="offer-price"/g)].length,1);
    assert.match(innerHTML,/<strong>R\$ 19,90<\/strong>/);
    const cta = innerHTML.match(/<button class="make-button">([\s\S]*?)<\/button>/)?.[1];
    assert.equal(visibleText(cta || ''),'Fazer meu pedido');
  }
});

test('accessible article model name and video metadata are preserved',() => {
  const article = renderCard();
  assert.equal(article.attributes['aria-label'],fixture.label + ': ' + fixture.title);
  assert.equal(article.dataset.id,fixture.id);
  assert.match(article.innerHTML,/<video[^>]+aria-label="Vídeo RÓTULO ÚNICO DO MODELO"/);
  assert.match(article.innerHTML,/\bmuted loop playsinline preload="metadata"/);
});

test('removed swipe hint leaves no DOM selector that can break navigation',() => {
  assert.doesNotMatch(page,/\bid="swipe-hint"/);
  assert.doesNotMatch(app,/#swipe-hint/);
  assert.match(app,/article\.querySelector\('\.make-button'\)\.addEventListener\('click',\(\) => openPersonalize\(item\)\)/);
  assert.match(app,/article\.querySelector\('\.model-info'\)\.addEventListener\('click',\(\) => openPersonalize\(item\)\)/);
  assert.match(app,/article\.querySelector\('\.creator-action'\)\.addEventListener\('click',\(\) => location\.hash = 'perfil'\)/);
});

test('order form remains byte-identical apart from line endings',() => {
  const form = page.match(/<form id="order-form">[\s\S]*?<\/form>/)?.[0];
  assert.ok(form);
  assert.equal(digest(form),'2a55a61ece259903033a54ef10ae2076a3e6e9934fc8700791908688a1b8cb5f');
  assert.match(form,/name="duration" value="10" checked/);
  assert.match(form,/name="duration" value="20"/);
});

test('catalog, versions, media references and prices are unchanged',() => {
  assert.equal(digest(catalogSource),'1bf55daed8fe8a351ad7a79c40a427c33b1bd57deae6715c458d7cf8cfd3c56f');
  assert.deepEqual(catalog.prices,{'10':1990,'20':2990});
  assert.equal(catalog.catalog.filter(item => item.creativeTemplate).length,5);
  assert.equal(catalog.catalog.filter(item => !item.creativeTemplate).length,2);
});

test('top navigation, profile and model details remain available',() => {
  for (const id of ['profile-view','profile-grid','personalize-dialog','chosen-title','chosen-kicker','chosen-phrase','model-note','preview-info']) {
    assert.ok(page.includes('id="' + id + '"'),id);
  }
  assert.match(page,/class="feed-tab">Em destaque<\/span>/);
  assert.match(page,/href="#perfil"/);
  assert.match(app,/function renderProfile\(\)/);
  assert.match(app,/document\.querySelector\('#chosen-title'\)\.textContent = item\.title/);
});
