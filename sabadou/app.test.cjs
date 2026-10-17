// Local-only contract and interaction tests. No network, orders, or generation.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PHRASES, DEFAULT_COPY, normalizePhone, buildData, safeWhatsAppUrl, safeReceiptUrl, fallbackMessage, normalizeReceipt, createOrderLock, durationChoice, priceForDuration } = require('./app.js');
const endpoint = 'https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders';
const input = { company: '  TESTE LOCAL  ', whatsapp: '', businessType: 'auto', includeDate: false, date: '', copyId: DEFAULT_COPY, durationSeconds: 10 };

test('new Sabadou payload is isolated from Sextou, requires one video and no date', () => {
  assert.deepEqual(buildData(input), {
    schemaVersion: 2, campaignId: 'sabadou-classico-v1', company: 'TESTE LOCAL', whatsapp: null,
    selections: [{ id: '93', format: 'video' }], sabadou: { businessType: 'auto', date: null, copyId: 'hoje-nao-cozinha', durationSeconds: 10 }
  });
  assert.equal(buildData({ ...input, includeDate: true, date: '2026-10-17' }).sabadou.date, null);
  assert.equal(Object.hasOwn(buildData(input), 'sextou'), false);
});

test('all ten exact preset phrases are allowed but custom or prototype keys are rejected', () => {
  assert.deepEqual(Object.keys(PHRASES), ['hoje-nao-cozinha', 'sabado-mais-sabor', 'sabor-fim-semana', 'chama-galera', 'noite-com-sabor', 'bateu-fome', 'hoje-voce-merece', 'seu-favorito', 'sabado-combina', 'capricha-pedido']);
  for (const [copyId, phrase] of Object.entries(PHRASES)) {
    const data = buildData({ ...input, copyId });
    assert.equal(data.sabadou.copyId, copyId);
    const message = fallbackMessage('preset-123', data);
    assert.ok(message.includes(phrase));
    assert.ok(message.includes('SABADOU!'));
    assert.ok(message.includes('Peça o seu.'));
    assert.doesNotMatch(message, /Sextou|SEXTOU/);
    assert.equal(normalizeReceipt({orderId:'preset-123'}, data, endpoint).phrase, phrase);
  }
  for (const copyId of ['trabalho-sabor', 'frase livre', 'constructor', '__proto__']) assert.throws(() => buildData({ ...input, copyId }), /frases da lista/);
});

test('10 and 20 seconds use exact duration and prices; invalid or missing durations are rejected', () => {
  for (const [durationSeconds, price] of [[10,1990],[20,2990]]) {
    const data = buildData({...input, durationSeconds});
    assert.equal(data.sabadou.durationSeconds, durationSeconds);
    assert.equal(priceForDuration(durationSeconds), price);
    assert.equal(durationChoice(data.sabadou), String(durationSeconds));
    const receipt = normalizeReceipt({orderId:'duration-test',totalCents:price},data,endpoint);
    assert.equal(receipt.durationSeconds,durationSeconds);
    assert.equal(receipt.totalCents,price);
    assert.match(receipt.whatsappMessage, new RegExp(durationSeconds + ' segundos'));
  }
  for (const durationSeconds of [undefined,null,'10',4,8,15,30,10.5,true]) assert.throws(() => buildData({...input,durationSeconds}), /10 ou 20/);
});

test('receipt keeps order id, selected phrase, company and authoritative server price', () => {
  const data = buildData({...input,copyId:'sabado-combina'});
  const receipt = normalizeReceipt({orderId:'receipt-123',totalCents:2990},data,endpoint);
  assert.equal(receipt.company,'TESTE LOCAL');
  assert.equal(receipt.copyId,'sabado-combina');
  assert.equal(receipt.phrase,'Sábado combina com comida boa.');
  assert.equal(receipt.totalCents,2990);
  assert.match(receipt.whatsappMessage,/Pedido: receipt-123/);
  assert.equal(new URL(receipt.whatsappUrl).searchParams.get('text'),receipt.whatsappMessage);
});

test('invalid receipt ids are never treated as success', () => {
  for (const result of [null,{}, {orderId:''}, {orderId:'<script>'}, {orderId:'x'.repeat(101)}]) assert.equal(normalizeReceipt(result,buildData(input),endpoint),null);
});

test('only fixed business recipient and API receipt origin are linked', () => {
  const text = 'Pedido abc-123 · iA4tube';
  const expected = 'https://wa.me/554791049079?text=' + encodeURIComponent(text);
  for (const raw of [undefined,'javascript:alert(1)','https://evil.invalid/','https://wa.me/5511111111111','https://wa.me/554791049079?text=wrong','https://user:secret@wa.me/554791049079']) assert.equal(safeWhatsAppUrl(raw,text),expected);
  assert.equal(new URL(safeWhatsAppUrl(expected,text)).searchParams.get('text'),text);
  assert.equal(safeReceiptUrl(endpoint+'/abc',endpoint),endpoint+'/abc');
  assert.equal(safeReceiptUrl('https://evil.invalid/abc',endpoint),null);
  assert.equal(normalizePhone('(47) 99999-9999'),'5547999999999');
});

test('HTML has every referenced ID, exact preset options, honest demo and current terms', () => {
  const html = fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const js = fs.readFileSync(path.join(__dirname,'app.js'),'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(ids.length,new Set(ids).size);
  for(const m of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(m[1]),'missing #'+m[1]);
  const options = [...html.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g)].map(m=>[m[1],m[2]]);
  assert.deepEqual(options,Object.entries(PHRASES));
  assert.match(html,/name="durationSeconds" value="10" checked/);
  assert.match(html,/name="durationSeconds" value="20"/);
  assert.match(html,/R\$ 19,90/);
  assert.match(html,/R\$ 29,90/);
  assert.match(html,/20s repete a animação de 10s/);
  assert.match(html,/Exemplo de arte/);
  assert.doesNotMatch(html,/<video|Sextou|SEXTOU|sextou/);
  assert.ok(fs.existsSync(path.join(__dirname,'exemplo-sabadou.png')));
  const config=JSON.parse(html.match(/<script id="sabadou-config"[^>]*>(.*?)<\/script>/s)[1]);
  assert.equal(config.campaignId,'sabadou-classico-v1');
  assert.equal(config.submitEndpoint,endpoint);
  assert.equal(config.recipientWhatsApp,'554791049079');
  assert.deepEqual(config.durationPricesCents,{10:1990,20:2990});
  for(const key of ['ia4tube:sabadou:order:v1','ia4tube:sabadou:draft:v1','ia4tube-sabadou-files-v1','ia4tube:sabadou:submit-lock:v1','ia4tube:sabadou:tab-draft:v1']) assert.ok(js.includes(key));
  assert.doesNotMatch(js,/ia4tube:sextou|ia4tube-sextou/);
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
  const lockKey = 'ia4tube:sabadou:submit-lock:v1';
  const run = createOrderLock({ storage, randomKey: () => 'first', now: () => 100, delay: async () => {
    storage.setItem(lockKey, JSON.stringify({ token: 'second', expiresAt: 200000 }));
  } });
  await assert.rejects(run(async () => assert.fail('lost owner must not submit')), /outra aba/);
  assert.equal(JSON.parse(storage.getItem(lockKey)).token, 'second');
});

test('fallback verifies lease ownership again immediately before sending', async () => {
  const storage = memoryStorage();
  const lockKey = 'ia4tube:sabadou:submit-lock:v1';
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

// Lightweight DOM contract checks: no browser, network or submitted orders.
async function formHarness(stored = {}) {
  const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
  const storage = memoryStorage();
  for (const [key, value] of Object.entries(stored)) storage.setItem(key, JSON.stringify(value));
  const element = (extra = {}) => ({ value: '', hidden: false, disabled: false, textContent: '', listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; }, setAttribute() {}, removeAttribute() {},
    focus() {}, scrollIntoView() {}, ...extra });
  const nodes = Object.fromEntries([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], element()]));
  nodes['sabadou-config'].textContent = html.match(/<script id="sabadou-config"[^>]*>(.*?)<\/script>/s)[1];
  nodes['include-date'].checked = false;
  nodes['copy-id'].value = 'hoje-nao-cozinha';
  const groups = { durationSeconds: ['10', '20'], businessType: ['auto', 'hamburgueria', 'pizzaria'] };
  for (const name of Object.keys(groups)) {
    const radios = groups[name].map((value, index) => element({ value, _checked: index === 0 }));
    for (const radio of radios) Object.defineProperty(radio, 'checked', {
      get: () => radio._checked,
      set: (checked) => { if (checked) for (const item of radios) item._checked = false; radio._checked = checked; }
    });
    groups[name] = radios;
  }
  const document = { getElementById: (id) => nodes[id],
    querySelectorAll: (selector) => groups[selector.match(/name="([^"]+)"/)[1]],
    querySelector(selector) {
      const group = this.querySelectorAll(selector);
      const value = selector.match(/value="([^"]+)"/);
      return group.find((radio) => value ? radio.value === value[1] : radio.checked);
    }
  };
  const context = { document, localStorage: storage, sessionStorage: memoryStorage(), navigator: {},
    window: { addEventListener() {} }, URL, Intl, Date, Uint8Array, setTimeout, clearTimeout,
    crypto: require('node:crypto').webcrypto };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8'), context);
  await new Promise(setImmediate);
  await new Promise(setImmediate);
  return { nodes, groups, storage, select(value) {
    const radio = groups.durationSeconds.find((item) => item.value === value);
    radio.checked = true;
    radio.listeners.change();
  } };
}


test('fresh form defaults to first phrase and 10s; chosen phrase and duration persist in draft',async()=>{
  const ui=await formHarness();
  assert.equal(ui.nodes['copy-id'].value,DEFAULT_COPY);
  assert.match(ui.nodes.price.textContent,/19,90/);
  ui.nodes['copy-id'].value='capricha-pedido';
  ui.nodes['copy-id'].listeners.change();
  assert.equal(JSON.parse(ui.storage.getItem('ia4tube:sabadou:draft:v1')).copyId,'capricha-pedido');
  ui.select('20');
  const draft=JSON.parse(ui.storage.getItem('ia4tube:sabadou:draft:v1'));
  assert.equal(draft.durationSeconds,20);
  assert.equal(draft.copyId,'capricha-pedido');
  assert.match(ui.nodes.price.textContent,/29,90/);
});

test('saved draft restores phrase and duration without adopting Sextou state',async()=>{
  const sextou={ company:'SEXTOU MUST STAY',copyId:'trabalho-sabor',durationSeconds:20 };
  const ui=await formHarness({
    'ia4tube:sabadou:draft:v1':{...input,copyId:'bateu-fome',durationSeconds:20},
    'ia4tube:sextou:draft:v1':sextou,
    'ia4tube:sextou:order:v1':{status:'saved',receipt:{orderId:'do-not-use',whatsappMessage:'sextou'}}
  });
  assert.equal(ui.nodes['copy-id'].value,'bateu-fome');
  assert.equal(ui.groups.durationSeconds.find(x=>x.checked).value,'20');
  assert.equal(ui.nodes.company.value,'  TESTE LOCAL  ');
  assert.deepEqual(JSON.parse(ui.storage.getItem('ia4tube:sextou:draft:v1')),sextou);
  assert.equal(ui.storage.getItem('ia4tube:sabadou:order:v1'),null);
});

test('pending retry restores selected phrase and preserves exact payload/key',async()=>{
  const record={status:'pending',key:'a'.repeat(64),data:buildData({...input,copyId:'noite-com-sabor',durationSeconds:20}),fileInfo:{logo:{sha256:'original-logo',name:'logo.png'},photo:null}};
  const ui=await formHarness({'ia4tube:sabadou:order:v1':record});
  assert.equal(ui.nodes['copy-id'].value,'noite-com-sabor');
  assert.equal(ui.nodes['form-fields'].disabled,true);
  assert.equal(ui.nodes['submit-label'].textContent,'Tentar novamente');
  assert.match(ui.nodes.price.textContent,/29,90/);
  assert.deepEqual(JSON.parse(ui.storage.getItem('ia4tube:sabadou:order:v1')),record);
});

test('saved receipt restores phrase, duration and price without another submission',async()=>{
  const receipt=normalizeReceipt({orderId:'saved-sabadou',totalCents:2990},buildData({...input,copyId:'chama-galera',durationSeconds:20}),endpoint);
  const ui=await formHarness({'ia4tube:sabadou:order:v1':{status:'saved',key:'a'.repeat(64),receipt}});
  assert.equal(ui.nodes['order-form'].hidden,true);
  assert.equal(ui.nodes['receipt-phrase'].textContent,'Chama a galera e aproveita.');
  assert.equal(ui.nodes['receipt-duration'].textContent,'20 segundos');
  assert.match(ui.nodes['receipt-price'].textContent,/29,90/);
});
