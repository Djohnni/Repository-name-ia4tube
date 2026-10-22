import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../saturday-previews.json',import.meta.url),'utf8'));
const catalog = JSON.parse(await readFile(new URL('../catalog.json',import.meta.url),'utf8'));
const expected = ['burger','combo','pizza','mascote','pizza-dupla'];

test('Saturday has exactly five new image previews and no countdown or video generation',() => {
  assert.equal(manifest.label,'Sábado, novos vídeos');
  assert.deepEqual(manifest.items.map(item => item.id),expected.map(id => 'previa-sabado-' + id));
  for (const item of manifest.items) {
    assert.deepEqual(Object.keys(item).sort(),['id','poster','title']);
    assert.equal(typeof item.title,'string');assert.ok(item.title.length > 0);
    assert.equal(catalog.catalog.some(current => current.id === item.id),false);
    assert.equal(catalog.dailySelection.videoIds.includes(item.id),false);
  }
});

test('preview assets are local, distinct, lightweight WebP files',async () => {
  const paths = new Set();let total = 0;
  for (const item of manifest.items) {
    assert.match(item.poster,/^\.\/media\/sabado-20261024\/[a-z-]+\.webp$/);
    assert.equal(paths.has(item.poster),false);paths.add(item.poster);
    const path = new URL('../' + item.poster,import.meta.url);
    const [info,buffer] = await Promise.all([stat(path),readFile(path)]);
    assert.equal(buffer.subarray(0,4).toString(),'RIFF');
    assert.equal(buffer.subarray(8,12).toString(),'WEBP');
    assert.ok(info.size > 1024 && info.size < 220000,`${item.id}: ${info.size} bytes`);
    total += info.size;
  }
  assert.ok(total < 1000000,'All five previews together should be smaller than 1 MB.');
});
