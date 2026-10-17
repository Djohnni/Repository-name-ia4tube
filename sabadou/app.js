/* This page is isolated from the app and the existing Marca Grande catalog. */
(() => {
  'use strict';

  const CAMPAIGN = 'sabadou-classico-v1';
  const RECIPIENT = '554791049079';
  const STORAGE_KEY = 'ia4tube:sabadou:order:v1';
  const DRAFT_KEY = 'ia4tube:sabadou:draft:v1';
  const DB_NAME = 'ia4tube-sabadou-files-v1';
  const LOCK_KEY = 'ia4tube:sabadou:submit-lock:v1';
  const BACKUP_KEY = 'ia4tube:sabadou:tab-draft:v1';
  const MAX_LOGO = 5 * 1024 * 1024;
  const MAX_PHOTO = 10 * 1024 * 1024;
  const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const PHRASES = Object.freeze({
    'hoje-nao-cozinha': 'Hoje você não cozinha.',
    'sabado-mais-sabor': 'Seu sábado merece mais sabor.',
    'sabor-fim-semana': 'O sabor do seu fim de semana.',
    'chama-galera': 'Chama a galera e aproveita.',
    'noite-com-sabor': 'Uma noite cheia de sabor.',
    'bateu-fome': 'Bateu a fome? Deixa com a gente.',
    'hoje-voce-merece': 'Hoje você merece esse sabor.',
    'seu-favorito': 'O seu favorito te espera.',
    'sabado-combina': 'Sábado combina com comida boa.',
    'capricha-pedido': 'Capricha no pedido de hoje.'
  });
  const DEFAULT_COPY = 'hoje-nao-cozinha';
  const money = (cents) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);

  function durationChoice(data) {
    return [10, 20].includes(data.durationSeconds) ? String(data.durationSeconds) : '10';
  }

  function priceForDuration(duration, prices = { 10: 1990, 20: 2990 }, legacyPrice = 1990) {
    return duration === undefined ? legacyPrice : prices[duration];
  }

  function normalizePhone(value) {
    const digits = String(value).replace(/\D/g, '');
    return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  }

  function buildData(values) {
    if (![10, 20].includes(values.durationSeconds)) throw new Error('Escolha 10 ou 20 segundos.');
    const copyId = values.copyId || DEFAULT_COPY;
    if (!Object.hasOwn(PHRASES, copyId)) throw new Error('Escolha uma das frases da lista.');
    return {
      schemaVersion: 2,
      campaignId: CAMPAIGN,
      company: values.company.trim(),
      whatsapp: values.whatsapp ? normalizePhone(values.whatsapp) : null,
      selections: [{ id: '93', format: 'video' }],
      sabadou: { businessType: values.businessType || 'auto', date: null, copyId, durationSeconds: values.durationSeconds }
    };
  }

  function safeWhatsAppUrl(raw, message) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && url.hostname === 'wa.me' && url.port === '' &&
          url.username === '' && url.password === '' && url.pathname === `/${RECIPIENT}` &&
          url.searchParams.get('text') === message) return url.href;
    } catch { /* Use the fixed business recipient below. */ }
    return `https://wa.me/${RECIPIENT}?text=${encodeURIComponent(message)}`;
  }

  function safeReceiptUrl(raw, endpoint) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' && url.origin === new URL(endpoint).origin && !url.username && !url.password) return url.href;
    } catch { /* An unavailable receipt link does not invalidate a saved order. */ }
    return null;
  }

  function fallbackMessage(orderId, data) {
    const kind = data.sabadou.businessType === 'auto' ? 'personalização conforme a marca e o produto' : data.sabadou.businessType === 'pizzaria' ? 'pizzaria' : 'hamburgueria';
    const date = data.sabadou.date ? `data ${data.sabadou.date.split('-').reverse().join('/')}` : 'sem data na arte';
    const duration = data.sabadou.durationSeconds;
    return `Olá! Enviei esse pedido pelo site da iA4tube Empresas.\n\nPedido: ${orderId}\nProduto: Vídeo Sabadou personalizado · ${duration} segundos\nEstabelecimento: ${data.company}\nResumo: ${kind}; ${date}; SABADOU! ${PHRASES[data.sabadou.copyId]} Peça o seu.\n\nGostaria de confirmar o recebimento e combinar os próximos passos.`;
  }

  function normalizeReceipt(result, data, endpoint) {
    if (!result || typeof result.orderId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(result.orderId)) return null;
    const message = typeof result.whatsappMessage === 'string' && result.whatsappMessage.length < 6000 && result.whatsappMessage.includes(result.orderId)
      ? result.whatsappMessage : fallbackMessage(result.orderId, data);
    return {
      orderId: result.orderId,
      company: data.company,
      durationSeconds: data.sabadou.durationSeconds,
      copyId: data.sabadou.copyId,
      phrase: PHRASES[data.sabadou.copyId],
      totalCents: Number.isSafeInteger(result.totalCents) && result.totalCents >= 0 ? result.totalCents : null,
      whatsappMessage: message,
      whatsappUrl: safeWhatsAppUrl(result.whatsappUrl, message),
      receiptUrl: safeReceiptUrl(result.receiptUrl, endpoint)
    };
  }

  function createOrderLock({ locks, storage, randomKey, now = Date.now, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
    const occupied = () => new Error('Este pedido está sendo salvo em outra aba. Aguarde a confirmação e volte aqui; não é necessário enviar outra vez.');
    return async (operation) => {
      if (locks?.request) {
        return locks.request(LOCK_KEY, { mode: 'exclusive', ifAvailable: true }, (lock) => {
          if (!lock) throw occupied();
          return operation(() => {});
        });
      }
      // Older browsers: a short settling window elects one owner. The payload is
      // re-read again under this lease and verified immediately before the POST.
      const read = () => { try { return JSON.parse(storage.getItem(LOCK_KEY)); } catch { return null; } };
      if (read()?.expiresAt > now()) throw occupied();
      const token = randomKey();
      const lease = { token, expiresAt: now() + 180000 };
      storage.setItem(LOCK_KEY, JSON.stringify(lease));
      await delay(150);
      const assertCurrent = () => { const current = read(); if (current?.token !== token || current.expiresAt <= now()) throw occupied(); };
      try {
        assertCurrent();
        return await operation(assertCurrent);
      } finally {
        if (read()?.token === token) storage.removeItem(LOCK_KEY);
      }
    };
  }

  // Pure helpers can be tested without a browser or any network request.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { normalizePhone, PHRASES, DEFAULT_COPY, buildData, safeWhatsAppUrl, safeReceiptUrl, fallbackMessage, normalizeReceipt, createOrderLock, durationChoice, priceForDuration };
  }
  if (typeof document === 'undefined') return;

  const $ = (id) => document.getElementById(id);
  const config = JSON.parse($('sabadou-config').textContent);
  const files = { logo: null, photo: null };
  const previewUrls = {};
  let busy = false;
  let preparing = 0;
  let pending = null;
  let receipt = null;
  let databasePromise = null;
  let sharedUpdate = false;
  let draftBackup = null;
  const randomKey = () => [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const withOrderLock = createOrderLock({ locks: navigator.locks, storage: {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: (key) => localStorage.removeItem(key)
  }, randomKey });

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  function storageSet(key, value) {
    const serialized = JSON.stringify(value);
    localStorage.setItem(key, serialized);
    if (localStorage.getItem(key) !== serialized) throw new Error('storage');
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch { /* Keep the page usable. */ }
  }

  function openFilesDatabase() {
    if (!databasePromise) {
      databasePromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) { reject(new Error('files-storage-unavailable')); return; }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore('files');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('files-storage-blocked'));
      });
    }
    return databasePromise;
  }

  async function filesDatabase(mode, operation) {
    const database = await openFilesDatabase();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('files', mode);
      const request = operation(transaction.objectStore('files'));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('files-storage-aborted'));
    });
  }

  async function preserveFiles(key, source = files) {
    try { await filesDatabase('readwrite', (store) => store.put({ logo: source.logo, photo: source.photo }, key)); return true; }
    catch { return false; }
  }

  async function forgetFiles(key) {
    if (!key) return;
    try { await filesDatabase('readwrite', (store) => store.delete(key)); } catch { /* No server data is affected. */ }
  }

  function values() {
    const duration = document.querySelector('input[name="durationSeconds"]:checked').value;
    return {
      company: $('company').value,
      whatsapp: $('whatsapp').value,
      businessType: document.querySelector('input[name="businessType"]:checked').value,
      includeDate: $('include-date').checked,
      date: $('event-date').value,
      copyId: $('copy-id').value,
      durationSeconds: Number(duration)
    };
  }

  function applyValues(data) {
    $('copy-id').value = Object.hasOwn(PHRASES, data.copyId) ? data.copyId : DEFAULT_COPY;
    $('company').value = typeof data.company === 'string' ? data.company.slice(0, 100) : '';
    $('whatsapp').value = typeof data.whatsapp === 'string' ? data.whatsapp.slice(0, 24) : '';
    const kind = ['pizzaria', 'hamburgueria'].includes(data.businessType) ? data.businessType : 'auto';
    document.querySelector(`input[name="businessType"][value="${kind}"]`).checked = true;
    $('include-date').checked = data.includeDate === true;
    $('event-date').value = typeof data.date === 'string' ? data.date : '';
    document.querySelector(`input[name="durationSeconds"][value="${durationChoice(data)}"]`).checked = true;
    updateDuration();
    toggleDate();
  }

  function updateDuration() {
    const duration = values().durationSeconds;
    $('price').textContent = money(priceForDuration(duration, config.durationPricesCents, config.priceCents));
  }

  function saveDraft() {
    if (pending || receipt) return;
    try { storageSet(DRAFT_KEY, values()); } catch { /* Saving becomes mandatory before submission. */ }
  }

  async function backUpTabDraft() {
    if (draftBackup || pending || receipt) return;
    const current = values();
    if (!current.company.trim() && !current.whatsapp.trim() && !files.logo && !files.photo) return;
    draftBackup = { values: current, files: { ...files }, key: `draft:${randomKey()}` };
    try { sessionStorage.setItem(BACKUP_KEY, JSON.stringify({ values: current, key: draftBackup.key })); } catch { /* The in-memory backup remains usable. */ }
    await preserveFiles(draftBackup.key, draftBackup.files);
  }

  async function recoverTabDraft() {
    if (draftBackup) return draftBackup;
    try {
      const saved = JSON.parse(sessionStorage.getItem(BACKUP_KEY));
      if (saved?.values && /^draft:[a-f0-9]{64}$/.test(saved.key || '')) {
        let cached = null;
        try { cached = await filesDatabase('readonly', (store) => store.get(saved.key)); } catch { /* Text still recovers. */ }
        draftBackup = { ...saved, files: { logo: cached?.logo || null, photo: cached?.photo || null } };
      }
    } catch { /* No suspended draft. */ }
    return draftBackup;
  }

  function toggleDate() {
    $('date-field').hidden = !$('include-date').checked;
    $('date-default-help').hidden = $('include-date').checked;
  }

  function fieldError(id, message) {
    $(`${id}-error`).textContent = message;
    $(`${id}-error`).hidden = !message;
    $(id).setAttribute('aria-invalid', String(Boolean(message)));
  }

  function formError(message) {
    $('form-message').textContent = message;
    $('form-message').hidden = false;
    $('form-message').focus({ preventScroll: true });
    $('form-message').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function setControls() {
    $('order-form').setAttribute('aria-busy', String(busy || preparing > 0));
    $('form-fields').disabled = busy || Boolean(pending);
    $('date-options').disabled = busy || Boolean(pending);
    for (const kind of ['logo', 'photo']) {
      // After a connection failure, only missing original files may be reattached.
      $(kind).disabled = busy || Boolean(pending && (!pending.fileInfo[kind] || files[kind]));
    }
    $('remove-photo').disabled = busy || Boolean(pending);
    $('submit-button').disabled = busy || preparing > 0 || Boolean(receipt);
    $('new-order').disabled = busy;
    $('submit-label').textContent = busy ? 'Salvando…' : pending ? 'Tentar novamente' : 'Enviar pedido';
  }

  function updateFile(kind) {
    if (previewUrls[kind]) URL.revokeObjectURL(previewUrls[kind]);
    const file = files[kind];
    $(`${kind}-preview`).hidden = !file;
    $(`${kind}-name`).hidden = !file;
    $(`${kind}-name`).textContent = file ? file.name : '';
    $(`${kind}-label`).textContent = file ? 'Trocar imagem' : kind === 'logo' ? 'Adicionar logo' : 'Adicionar foto';
    if (file) {
      previewUrls[kind] = URL.createObjectURL(file);
      $(`${kind}-preview`).src = previewUrls[kind];
    } else {
      $(`${kind}-preview`).removeAttribute('src');
      delete previewUrls[kind];
    }
    $('remove-photo').hidden = !files.photo || Boolean(pending);
  }

  async function fileDigest(file) {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  async function fileInfo(file) {
    return file ? { name: file.name, size: file.size, type: file.type, sha256: await fileDigest(file) } : null;
  }

  async function validateFile(file, kind) {
    if (!file || !file.size) return 'Escolha uma imagem que não esteja vazia.';
    if (!TYPES.includes(file.type) || !/\.(jpe?g|png|webp)$/i.test(file.name)) return 'Use uma imagem JPG, PNG ou WebP.';
    const limit = kind === 'logo' ? MAX_LOGO : MAX_PHOTO;
    if (file.size > limit) return `O arquivo deve ter no máximo ${kind === 'logo' ? '5' : '10'} MB.`;
    const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const png = bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10;
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
    if (!(file.type === 'image/png' && png || file.type === 'image/jpeg' && jpeg || file.type === 'image/webp' && webp)) return 'O arquivo não parece uma imagem válida. Escolha outra versão em JPG, PNG ou WebP.';
    return '';
  }

  async function chooseFile(kind) {
    const candidate = $(kind).files[0];
    if (!candidate) return;
    preparing++;
    setControls();
    try {
      let error = await validateFile(candidate, kind);
      if (!error && pending) {
        const expected = pending.fileInfo[kind];
        if (!expected || expected.sha256 !== await fileDigest(candidate) || expected.name !== candidate.name) error = 'Para retomar sem duplicar, selecione o mesmo arquivo usado na primeira tentativa.';
      }
      fieldError(kind, error);
      if (error) { $(kind).value = ''; return; }
      files[kind] = candidate;
      updateFile(kind);
      if (pending) await preserveFiles(pending.key);
    } catch {
      fieldError(kind, 'Não foi possível ler essa imagem. Escolha o arquivo novamente.');
    } finally {
      preparing--;
      setControls();
      if (sharedUpdate) syncSharedState();
    }
  }

  function validate() {
    if (pending) {
      const missing = ['logo', 'photo'].find((kind) => pending.fileInfo[kind] && !files[kind]);
      if (missing) {
        fieldError(missing, 'Selecione o mesmo arquivo da tentativa anterior para recuperar este pedido.');
        $(missing).focus();
        return false;
      }
      return true;
    }
    const data = values();
    const phone = normalizePhone(data.whatsapp);
    const errors = {
      company: data.company.trim().length < 2 ? 'Informe o nome da empresa.' : '',
      whatsapp: data.whatsapp && (!/^[+\d\s().-]+$/.test(data.whatsapp) || phone.length < 12 || phone.length > 15) ? 'Confira o WhatsApp deste pedido anterior.' : '',
      logo: files.logo ? '' : 'Adicione a logo da sua empresa.',
      photo: '',
      'copy-id': Object.hasOwn(PHRASES, data.copyId) ? '' : 'Escolha uma das frases da lista.',
      'event-date': ''
    };
    Object.entries(errors).forEach(([id, error]) => fieldError(id, error));
    const first = Object.keys(errors).find((id) => errors[id]);
    if (first) { $(first).focus(); return false; }
    return true;
  }

  function isPending(value) {
    return value?.status === 'pending' && /^[a-f0-9]{64}$/.test(value.key || '') &&
      value.data?.campaignId === CAMPAIGN && typeof value.data.company === 'string' &&
      Object.hasOwn(PHRASES, value.data.sabadou?.copyId) && [10, 20].includes(value.data.sabadou?.durationSeconds) &&
      value.fileInfo?.logo?.sha256;
  }

  function showReceipt(saved, focus) {
    receipt = saved;
    $('order-form').hidden = true;
    $('receipt').hidden = false;
    $('receipt-number').textContent = saved.orderId;
    $('receipt-company').textContent = saved.company;
    $('receipt-phrase').textContent = PHRASES[saved.copyId] || saved.phrase || PHRASES[DEFAULT_COPY];
    $('receipt-duration-row').hidden = ![10, 20].includes(saved.durationSeconds);
    $('receipt-duration').textContent = [10, 20].includes(saved.durationSeconds) ? `${saved.durationSeconds} segundos` : '';
    $('receipt-price').textContent = saved.totalCents === null ? 'Consulte no WhatsApp' : money(saved.totalCents);
    $('price').textContent = saved.totalCents === null ? 'Pedido salvo' : money(saved.totalCents);
    $('whatsapp-link').href = safeWhatsAppUrl(saved.whatsappUrl, saved.whatsappMessage);
    $('saved-message').value = saved.whatsappMessage;
    const link = safeReceiptUrl(saved.receiptUrl, config.submitEndpoint);
    $('receipt-link').hidden = !link;
    if (link) $('receipt-link').href = link;
    if (focus) {
      $('receipt').focus({ preventScroll: true });
      $('receipt').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function isSaved(saved) {
    return saved?.status === 'saved' && saved.receipt && typeof saved.receipt.whatsappMessage === 'string' &&
      /^[A-Za-z0-9_-]{1,100}$/.test(saved.receipt.orderId || '');
  }

  async function adoptSharedRecord(saved) {
    if (isSaved(saved)) {
      if (!receipt && !pending) await backUpTabDraft();
      pending = null;
      showReceipt(saved.receipt, false);
      return true;
    }
    if (isPending(saved)) {
      if (pending?.key !== saved.key) {
        await backUpTabDraft();
        files.logo = null;
        files.photo = null;
        updateFile('logo');
        updateFile('photo');
      }
      pending = saved;
      receipt = null;
      $('order-form').hidden = false;
      $('receipt').hidden = true;
      applyValues({ ...pending.data, ...pending.data.sabadou, includeDate: Boolean(pending.data.sabadou.date) });
      try {
        const cached = await filesDatabase('readonly', (store) => store.get(pending.key));
        for (const kind of ['logo', 'photo']) {
          const expected = pending.fileInfo[kind];
          if (expected && cached?.[kind] instanceof File && expected.sha256 === await fileDigest(cached[kind]) && expected.name === cached[kind].name) {
            files[kind] = cached[kind];
            updateFile(kind);
          }
        }
      } catch { /* Reattaching exact files is a safe fallback when storage is unavailable. */ }
      $('restore-message').textContent = 'Encontramos uma tentativa ainda sem confirmação. Use o botão para retomar o mesmo pedido, sem criar outro. Se algum arquivo não foi recuperado, selecione o original novamente.';
      $('restore-message').hidden = false;
      return true;
    }
    return false;
  }

  async function syncSharedState() {
    if (busy || preparing) { sharedUpdate = true; return; }
    sharedUpdate = false;
    busy = true;
    setControls();
    try {
      const saved = storageGet(STORAGE_KEY);
      await adoptSharedRecord(saved);
      if (!saved && pending) {
        // Another tab received a definitive rejection. Keep the data/files here.
        pending = null;
        $('restore-message').hidden = true;
      }
    } finally {
      busy = false;
      setControls();
      if (sharedUpdate) syncSharedState();
    }
  }

  async function restore() {
    busy = true;
    setControls();
    try {
      if (await adoptSharedRecord(storageGet(STORAGE_KEY))) return;
      const draft = storageGet(DRAFT_KEY);
      if (draft && typeof draft === 'object') applyValues(draft);
    } finally {
      busy = false;
      setControls();
      if (sharedUpdate) syncSharedState();
    }
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (busy || preparing || receipt) return;
    $('form-message').hidden = true;
    if (!pending && !storageGet(STORAGE_KEY) && !validate()) return;
    busy = true;
    setControls();
    let timeout;
    try {
      await withOrderLock(async (assertCurrent) => {
      // An earlier-loaded tab must observe any newer saved/pending order first.
      const shared = storageGet(STORAGE_KEY);
      if (await adoptSharedRecord(shared)) {
        if (receipt) return;
      } else if (pending) {
        // Its definitive rejection was processed in another tab.
        pending = null;
      }
      if (!validate()) return;
      if (!pending) {
        const key = randomKey();
        const candidate = { status: 'pending', key, data: buildData(values()), fileInfo: { logo: await fileInfo(files.logo), photo: await fileInfo(files.photo) }, createdAt: new Date().toISOString() };
        assertCurrent();
        // Even the lease fallback re-reads after asynchronous file hashing.
        const latest = storageGet(STORAGE_KEY);
        if (await adoptSharedRecord(latest)) {
          if (receipt) return;
          if (!validate()) return;
        } else {
        // Persist the exact payload and key BEFORE any request. Reloads reuse both.
        try { storageSet(STORAGE_KEY, candidate); }
        catch { throw new Error('Seu navegador não permitiu guardar a segurança do pedido. Ative o armazenamento do site ou use uma janela normal e tente novamente. Nenhum pedido foi enviado.'); }
        pending = candidate;
        await preserveFiles(key);
        }
      }
      const body = new FormData();
      body.append('data', JSON.stringify(pending.data));
      body.append('website', $('website').value);
      body.append('logo', files.logo, files.logo.name);
      if (files.photo) body.append('photos', files.photo, files.photo.name);
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 60000);
      assertCurrent();
      const latest = storageGet(STORAGE_KEY);
      if (isSaved(latest)) { await adoptSharedRecord(latest); return; }
      if (!isPending(latest) || latest.key !== pending.key) throw new Error('Outra aba atualizou o pedido. Aguarde e tente novamente para recuperar a mesma identificação.');
      const response = await fetch(config.submitEndpoint, { method: 'POST', body, headers: { 'Idempotency-Key': pending.key }, signal: controller.signal, credentials: 'omit', cache: 'no-store' });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok) {
        if (response.status === 409) throw new Error('O sistema identificou uma diferença nesta tentativa. Não envie outro pedido. Fale com a iA4tube pelo WhatsApp para conferir o recebimento.');
        if (response.status === 429) throw new Error('Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente. A mesma identificação será reutilizada.');
        // A definitive validation rejection saved no order. Keep files and allow correction.
        if ([400, 413, 415, 422].includes(response.status)) {
          const oldKey = pending.key;
          pending = null;
          storageRemove(STORAGE_KEY);
          await forgetFiles(oldKey);
          throw new Error(response.status === 413 ? 'Use uma logo de até 5 MB e uma foto de até 10 MB.' : 'O pedido não foi salvo. Confira o nome e as imagens e tente novamente.');
        }
        throw new Error('Não foi possível confirmar o recebimento agora. Tente novamente: usaremos o mesmo pedido para evitar duplicidade.');
      }
      const saved = normalizeReceipt(result, pending.data, config.submitEndpoint);
      if (!saved) throw new Error('A resposta chegou sem um número de pedido válido. Tente novamente para conferir a mesma tentativa, sem duplicar.');
      const oldKey = pending.key;
      let receiptPersisted = false;
      try { storageSet(STORAGE_KEY, { status: 'saved', key: oldKey, receipt: saved }); receiptPersisted = true; }
      catch { /* The prior pending key still allows an idempotent recovery on reload. */ }
      if (receiptPersisted) { pending = null; storageRemove(DRAFT_KEY); }
      showReceipt(saved, true);
      if (receiptPersisted) await forgetFiles(oldKey);
      // Same-tab navigation avoids popup blockers after the asynchronous save.
      // Opening the chat still leaves sending its message to the customer.
      window.location.assign(saved.whatsappUrl);
      });
    } catch (error) {
      formError(error.name === 'AbortError' ? 'O envio demorou e não conseguimos confirmar o recebimento. Tente novamente: a mesma identificação será usada, sem criar outro pedido.'
        : error instanceof TypeError ? 'Não conseguimos confirmar a conexão. Confira sua internet e tente novamente com este mesmo pedido.'
        : error.message || 'Não foi possível enviar agora. Seus dados continuam aqui para tentar novamente.');
    } finally {
      clearTimeout(timeout);
      busy = false;
      setControls();
      if (sharedUpdate) syncSharedState();
    }
  }

  updateDuration();
  $('order-form').addEventListener('submit', submitOrder);
  $('company').addEventListener('input', saveDraft);
  $('copy-id').addEventListener('change', saveDraft);
  $('whatsapp').addEventListener('input', saveDraft);
  $('event-date').addEventListener('change', saveDraft);
  document.querySelectorAll('input[name="businessType"]').forEach((input) => input.addEventListener('change', saveDraft));
  document.querySelectorAll('input[name="durationSeconds"]').forEach((input) => input.addEventListener('change', () => { updateDuration(); saveDraft(); }));
  $('include-date').addEventListener('change', () => { toggleDate(); saveDraft(); });
  $('logo').addEventListener('change', () => chooseFile('logo'));
  $('photo').addEventListener('change', () => chooseFile('photo'));
  $('remove-photo').addEventListener('click', () => {
    if (busy || pending) return;
    files.photo = null;
    $('photo').value = '';
    updateFile('photo');
    fieldError('photo', '');
  });
  $('copy-message').addEventListener('click', async () => {
    if (!receipt) return;
    try {
      await navigator.clipboard.writeText(receipt.whatsappMessage);
      $('copy-status').textContent = 'Mensagem copiada. Agora você pode colar no WhatsApp.';
    } catch {
      document.querySelector('.message-details').open = true;
      $('saved-message').focus();
      $('saved-message').select();
      $('copy-status').textContent = 'Selecione e copie o texto abaixo para colar no WhatsApp.';
    }
  });
  $('new-order').addEventListener('click', async () => {
    if (busy || preparing || !receipt) return;
    busy = true;
    setControls();
    try {
      await withOrderLock(async () => {
        const shared = storageGet(STORAGE_KEY);
        if (isPending(shared) && shared.key !== pending?.key || isSaved(shared) && shared.receipt.orderId !== receipt.orderId) {
          await adoptSharedRecord(shared);
          return;
        }
        const backup = await recoverTabDraft();
        const oldPendingKey = pending?.key;
        storageRemove(STORAGE_KEY);
        storageRemove(DRAFT_KEY);
        pending = null;
        receipt = null;
        $('order-form').reset();
        $('order-form').hidden = false;
        $('receipt').hidden = true;
        $('form-message').hidden = true;
        $('restore-message').hidden = true;
        if (backup) applyValues(backup.values);
        for (const kind of ['logo', 'photo']) { files[kind] = backup?.files[kind] || null; updateFile(kind); fieldError(kind, ''); }
        ['company', 'whatsapp', 'event-date', 'copy-id'].forEach((id) => fieldError(id, ''));
        toggleDate();
        updateDuration();
        saveDraft();
        if (backup) await forgetFiles(backup.key);
        if (oldPendingKey) await forgetFiles(oldPendingKey);
        try { sessionStorage.removeItem(BACKUP_KEY); } catch { /* Optional backup. */ }
        draftBackup = null;
      });
    } catch (error) {
      $('copy-status').textContent = error.message;
    } finally {
      busy = false;
      setControls();
      if (!receipt) $('company').focus();
      if (sharedUpdate) syncSharedState();
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) syncSharedState();
  });
  restore();
})();
