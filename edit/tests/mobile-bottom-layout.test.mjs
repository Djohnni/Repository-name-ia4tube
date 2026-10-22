import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const page = await readFile(new URL('../index.html',import.meta.url),'utf8');
const css = await readFile(new URL('../styles.css',import.meta.url),'utf8');
const app = await readFile(new URL('../app.js',import.meta.url),'utf8');

function mobileLayout() {
  const marker = '/* Mobile feed without a bottom navigation bar. */';
  const start = css.indexOf(marker);
  assert.ok(start >= 0,'Keep the isolated mobile layout override identifiable.');
  const section = css.slice(start + marker.length).trimStart();
  assert.match(section,/^@media\s*\(max-width:\s*700px\)\s*\{/);
  const open = section.indexOf('{');
  let depth = 1;
  for (let i = open + 1; i < section.length; i++) {
    if (section[i] === '{') depth++;
    if (section[i] === '}' && --depth === 0) return section.slice(open + 1,i);
  }
  assert.fail('Mobile layout media query must close.');
}

test('mobile bottom navigation is absent while desktop navigation remains',() => {
  assert.doesNotMatch(page,/<nav\b[^>]*class="[^"]*\bmobile-nav\b/);
  assert.match(page,/<nav\b[^>]*class="desktop-nav"/);
  assert.match(page,/class="feed-tab">Em destaque<\/span>/);
});

test('mobile price stays low and compact lateral controls move nearer the order row',() => {
  const block = mobileLayout();
  assert.match(block,/\.video-info\s*\{[^}]*bottom:\s*calc\(19px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(block,/\.video-actions\s*\{[^}]*bottom:\s*calc\(88px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});

test('mobile video progress respects the device safe area without a nav reservation',() => {
  const block = mobileLayout();
  assert.match(block,/\.video-progress\s*\{[^}]*bottom:\s*env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(block,/var\(--nav\)/);
});

test('profile and toast spacing also stop reserving the deleted navigation height',() => {
  const block = mobileLayout();
  assert.match(block,/\.profile-view\s*\{[^}]*padding-bottom:\s*calc\(37px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
  assert.match(block,/\.toast\s*\{[^}]*bottom:\s*calc\(32px\s*\+\s*env\(safe-area-inset-bottom\)\)/);
});

test('profile remains reachable from the lateral avatar and has two return controls',() => {
  assert.match(app,/class="creator-action" aria-label="Ver perfil da iA4tube"/);
  assert.match(app,/article\.querySelector\('\.creator-action'\)\.addEventListener\('click',\(\) => location\.hash = 'perfil'\)/);
  assert.match(page,/<button id="back-feed"[^>]*>/);
  assert.match(app,/document\.querySelector\('#back-feed'\)\.addEventListener\('click',\(\) => location\.hash = 'hoje'\)/);
  assert.match(page,/<a href="#hoje" class="profile-today"/);
});

test('mobile overlay change does not resize the player or alter the order form',() => {
  const block = mobileLayout();
  assert.doesNotMatch(block,/(?:\.stage|\.feed\s|\.video-card|\.sheet|\.order-field|#order-form)\s*\{/);
  assert.doesNotMatch(block,/(?:height|width|transform|animation|transition)\s*:/);
});

test('stylesheet URL is versioned for the current swipe guide update',() => {
  assert.match(page,/<link rel="stylesheet" href="\.\/styles\.css\?v=20261022-swipe-guide-v3">/);
});
