// Run with Node. These tests never access the network or create an order.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { normalizePhone, isFriday, buildData, safeWhatsAppUrl, safeReceiptUrl, fallbackMessage, normalizeReceipt, createOrderLock } = require('./app.js');
const endpoint = 'https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders';
const input = { company: '  TESTE LOCAL  ', whatsapp: '(47) 99999-9999', businessType: 'hamburgueria', includeDate: false, date: '' };

test('payload uses only the Sextou campaign and one video; photo is not part of JSON', () => {
  assert.deepEqual(buildData(input), {
    schemaVersion: 2, campaignId: 'sextou-classico-v1', company: 'TESTE LOCAL', whatsapp: '5547999999999',
    selections: [{ id: '93', format: 'video' }], sextou: { businessType: 'hamburgueria', date: null, copyId: 'trabalho-sabor' }
  });
});

test('optional date and pizza are preserved independently', () => {
  assert.deepEqual(buildData({ ...input, businessType: 'pizzaria', includeDate: true, date: '2026-10-23' }).sextou,
    { businessType: 'pizzaria', date: '2026-10-23', copyId: 'trabalho-sabor' });
  assert.equal(buildData({ ...input, date: '2026-10-23' }).sextou.date, null);
});

test('minimal three-field form leaves contact for WhatsApp and segment for image references', () => {
  const data = buildData({company: 'Minha empresa'});
  assert.equal(data.whatsapp, null);
  assert.deepEqual(data.sextou, {businessType: 'auto', date: null, copyId: 'trabalho-sabor'});
});

test('Friday validation checks the calendar instead of accepting normalized invalid dates', () => {
  assert.equal(isFriday('2026-10-16'), true);
  assert.equal(isFriday('2026-10-23'), true);
  assert.equal(isFriday('2026-10-17'), false);
  assert.equal(isFriday('2026-02-30'), false);
  assert.equal(isFriday('2026-13-02'), false);
  assert.equal(isFriday('2026-1-2'), false);
  assert.equal(isFriday(null), false);
});

test('Brazilian domestic numbers get their country code exactly once', () => {
  assert.equal(normalizePhone('(47) 99999-9999'), '5547999999999');
  assert.equal(normalizePhone('+55 47 99999-9999'), '5547999999999');
});

test('WhatsApp only links to the confirmed business number over HTTPS', () => {
  const text = 'Pedido abc-123 · iA4tube';
  const expected = `https://wa.me/554791049079?text=${encodeURIComponent(text)}`;
  for (const unsafe of [undefined, 'javascript:alert(1)', 'https://evil.invalid/', 'http://wa.me/554791049079', 'https://wa.me/5511111111111', 'https://user:secret@wa.me/554791049079', 'https://wa.me:444/554791049079', 'https://wa.me/554791049079?text=wrong']) {
    assert.equal(safeWhatsAppUrl(unsafe, text), expected);
  }
  assert.equal(new URL(safeWhatsAppUrl(expected, text)).searchParams.get('text'), text);
});

test('receipt URLs are restricted to the existing API origin', () => {
  assert.equal(safeReceiptUrl('https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders/abc', endpoint), 'https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders/abc');
  assert.equal(safeReceiptUrl('https://evil.invalid/orders/abc', endpoint), null);
  assert.equal(safeReceiptUrl('javascript:alert(1)', endpoint), null);
});

test('completed receipt uses the saved ID and server price rather than guessing', () => {
  const data = buildData(input);
  const message = fallbackMessage('abc-123', data);
  const result = normalizeReceipt({ orderId: 'abc-123', totalCents: 2500, whatsappMessage: message }, data, endpoint);
  assert.equal(result.orderId, 'abc-123');
  assert.equal(result.totalCents, 2500);
  assert.equal(result.company, 'TESTE LOCAL');
  assert.equal(new URL(result.whatsappUrl).searchParams.get('text'), message);
  assert.match(message, /Pedido: abc-123/);
  assert.match(message, /sem data na arte/);
  assert.match(message, /iA4tube/);
});

test('missing and invalid saved IDs cannot be treated as success', () => {
  for (const result of [null, {}, { orderId: '' }, { orderId: '<script>' }, { orderId: 'x'.repeat(101) }]) {
    assert.equal(normalizeReceipt(result, buildData(input), endpoint), null);
  }
});

test('a mismatching server message is rebuilt with the correct saved order ID', () => {
  const result = normalizeReceipt({ orderId: 'abc-123', whatsappMessage: 'another order', totalCents: '2000' }, buildData(input), endpoint);
  assert.match(result.whatsappMessage, /Pedido: abc-123/);
  assert.equal(result.totalCents, null);
});

test('HTML has all referenced IDs, unique IDs, required assets and a configured price', () => {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size, 'duplicate HTML IDs');
  for (const match of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(match[1]), `missing #${match[1]}`);
  assert.ok(fs.existsSync(path.join(__dirname, '../site-publico/logo-iA4tube.png')));
  const config = JSON.parse(html.match(/<script id="sextou-config"[^>]*>(.*?)<\/script>/s)[1]);
  assert.equal(config.submitEndpoint, endpoint);
  assert.equal(config.recipientWhatsApp, '554791049079');
  assert.equal(config.campaignId, 'sextou-classico-v1');
  assert.equal(Number.isSafeInteger(config.priceCents), true);
  assert.match(html, /politica-de-privacidade/);
});

function memoryStorage() {
  const records = new Map();
  return { getItem: (key) => records.get(key) || null, setItem: (key, value) => records.set(key, value), removeItem: (key) => records.delete(key), records };
}

function memoryLocks() {
  let held = false;
  return { request: async (key, options, callback) => {
    assert.equal(options.mode, 'exclusive');
    assert.equal(options.ifAvailable, true);
    if (held) return callback(null);
    held = true;
    try { return await callback({ name: key }); } finally { held = false; }
  } };
}

test('two tabs cannot enter the submission operation concurrently with Web Locks', async () => {
  const locks = memoryLocks();
  const storage = memoryStorage();
  const first = createOrderLock({ locks, storage, randomKey: () => 'first' });
  const second = createOrderLock({ locks, storage, randomKey: () => 'second' });
  let finish;
  let calls = 0;
  const running = first(async () => { calls++; await new Promise((resolve) => { finish = resolve; }); });
  await assert.rejects(second(async () => { calls++; }), /outra aba/);
  assert.equal(calls, 1);
  finish();
  await running;
  await second(async () => { calls++; });
  assert.equal(calls, 2);
});

test('older-browser fallback blocks a second tab and releases only its own lease', async () => {
  const storage = memoryStorage();
  const first = createOrderLock({ storage, randomKey: () => 'first', now: () => 100, delay: async () => {} });
  const second = createOrderLock({ storage, randomKey: () => 'second', now: () => 100, delay: async () => {} });
  let finish;
  const running = first(async (assertCurrent) => { assertCurrent(); await new Promise((resolve) => { finish = resolve; }); });
  await Promise.resolve();
  await assert.rejects(second(async () => assert.fail('second operation must not run')), /outra aba/);
  finish();
  await running;
  assert.equal(storage.records.size, 0);
  await second(async (assertCurrent) => assertCurrent());
  assert.equal(storage.records.size, 0);
});

test('fallback settling detects another winner before any operation', async () => {
  const storage = memoryStorage();
  const lockKey = 'ia4tube:sextou:submit-lock:v1';
  const run = createOrderLock({ storage, randomKey: () => 'first', now: () => 100, delay: async () => {
    storage.setItem(lockKey, JSON.stringify({ token: 'second', expiresAt: 200000 }));
  } });
  await assert.rejects(run(async () => assert.fail('lost owner must not submit')), /outra aba/);
  assert.equal(JSON.parse(storage.getItem(lockKey)).token, 'second');
});

test('fallback verifies lease ownership again immediately before sending', async () => {
  const storage = memoryStorage();
  const lockKey = 'ia4tube:sextou:submit-lock:v1';
  const run = createOrderLock({ storage, randomKey: () => 'first', now: () => 100, delay: async () => {} });
  await assert.rejects(run(async (assertCurrent) => {
    storage.setItem(lockKey, JSON.stringify({ token: 'replacement', expiresAt: 200000 }));
    assertCurrent();
    assert.fail('lost owner must not send');
  }), /outra aba/);
  assert.equal(JSON.parse(storage.getItem(lockKey)).token, 'replacement');
});

test('two pre-opened tabs re-read a saved receipt under the lock without a second submission', async () => {
  const locks = memoryLocks();
  const storage = memoryStorage();
  const first = createOrderLock({ locks, storage, randomKey: () => 'first' });
  const second = createOrderLock({ locks, storage, randomKey: () => 'second' });
  let posts = 0;
  let finish;
  const submit = async () => {
    const existing = storage.getItem('order');
    if (existing) return existing;
    posts++;
    await new Promise((resolve) => { finish = resolve; });
    storage.setItem('order', 'same-saved-id');
    return 'same-saved-id';
  };
  const running = first(submit);
  await assert.rejects(second(submit), /outra aba/);
  finish();
  assert.equal(await running, 'same-saved-id');
  assert.equal(await second(submit), 'same-saved-id');
  assert.equal(posts, 1);
});
