import { buildMultipartOrder, idempotencyKey, normalizeReceipt, safeWhatsAppUrl, SUBMIT_ENDPOINT } from './order-adapter.js?v=20261019-price';
import { createProductsForm } from './products-form.js?v=20261019-products';
import { normalizeProductPrice } from './optional-price.js?v=20261019-price';

const ATTEMPT_PREFIX = 'ia4tube.edit.attempt.v1.';
const RECEIPT_KEY = 'ia4tube.edit.receipt.v1';
const ACCEPTED_TYPES = new Set(['image/png','image/jpeg','image/webp']);

export async function fingerprintPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export function getOrCreateRequestId(fingerprint,storage = localStorage) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Não foi possível identificar esta tentativa.');
  const key = ATTEMPT_PREFIX + fingerprint;
  const existing = storage.getItem(key);
  if (existing && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(existing)) return existing;
  const requestId = crypto.randomUUID();
  storage.setItem(key,requestId);
  if (storage.getItem(key) !== requestId) throw new Error('O navegador não conseguiu preservar esta tentativa.');
  return requestId;
}
export function resetSavedAttempt(saved,storage = localStorage) {
  if (!saved?.orderId || saved.status !== 'awaiting_authorization' || !/^[a-f0-9]{64}$/.test(saved.fingerprint || '') || !saved.requestId) throw new Error('Só é possível iniciar outro pedido após confirmar que este foi salvo.');
  const key = ATTEMPT_PREFIX + saved.fingerprint;
  // A newer attempt in another tab must never be removed by an older receipt.
  if (storage.getItem(key) === saved.requestId) storage.removeItem(key);
}
async function readUpload(file,maxBytes,label) {
  if (!file) return null;
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error(`${label}: escolha uma imagem PNG, JPG ou WebP.`);
  if (!file.size || file.size > maxBytes) throw new Error(`${label}: o limite é ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const data = await new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error(`Não foi possível ler ${label.toLowerCase()}. Selecione o arquivo novamente.`));
    reader.readAsDataURL(file);
  });
  return {name:file.name,mime:file.type,data};
}

export function createOrderController({dialog,money,toast,onBusy}) {
  const form = document.querySelector('#order-form');
  const errorBox = document.querySelector('#order-error');
  const submit = document.querySelector('#send-order');
  const success = document.querySelector('#order-success');
  const displayOnly = document.querySelector('#display-only-note');
  const messageBox = document.querySelector('#saved-message');
  let item = null,config = null,busy = false,receipt = null;
  const initialSubmitLabel = submit.innerHTML;
  const products = createProductsForm({form,money,readUpload});

  function setBusy(value) {
    busy = value;
    [...form.elements].forEach(control => control.disabled = value);
    products.sync(value);
    dialog.querySelector('.close-dialog').disabled = value;
    submit.innerHTML = value ? 'Salvando seu pedido…' : initialSubmitLabel;
    form.setAttribute('aria-busy',String(value));onBusy();
  }
  function showError(message) {errorBox.textContent = message;errorBox.hidden = false;errorBox.scrollIntoView({block:'nearest'});}
  function showReceipt(saved) {
    receipt = saved;
    form.hidden = true;displayOnly.hidden = true;success.hidden = false;
    document.querySelector('#sheet-title').textContent = 'Tudo certo, pedido salvo.';
    document.querySelector('#saved-order-id').textContent = `Pedido ${saved.orderId} · ${money(saved.totalCents)}`;
    messageBox.value = saved.message || '';
    const link = document.querySelector('#whatsapp-link');
    try {link.href = safeWhatsAppUrl(saved.whatsappUrl,saved.message,saved.orderId);link.hidden = false;}
    catch {link.removeAttribute('href');link.hidden = true;toast('Pedido salvo. Copie a mensagem para continuar pelo WhatsApp.');}
    success.scrollIntoView({block:'nearest'});
  }
  function rememberReceipt(saved) {
    try {sessionStorage.setItem(RECEIPT_KEY,JSON.stringify({...saved,savedAt:Date.now()}));return true;}
    catch {return false;} // Keep the saved confirmation visible if browser storage is unavailable.
  }
  function open(nextItem,nextConfig) {
    if (busy) return;
    if (item?.id !== nextItem.id || receipt) form.reset();
    item = nextItem;config = nextConfig;receipt = null;
    document.querySelector('#sheet-title').textContent = 'Gostou? Faça o seu.';
    errorBox.hidden = true;success.hidden = true;messageBox.hidden = true;
    const enabled = item.orderEnabled === true && ['sextou','sabadou','produtos'].includes(item.recipe);
    products.open(item.recipe === 'produtos');
    form.hidden = !enabled;displayOnly.hidden = enabled;
    for (const seconds of [10,20]) document.querySelector(`#price-${seconds}`).textContent = money(config.prices?.[String(seconds)]);
    if (enabled && item.recipe !== 'produtos' && [10,20].some(seconds => !Number.isSafeInteger(config.prices?.[String(seconds)]))) {
      form.hidden = true;displayOnly.hidden = false;displayOnly.textContent = 'O preço deste modelo precisa ser conferido no programa antes de receber pedidos.';
    } else displayOnly.textContent = 'Este vídeo é apenas uma referência visual. A personalização ainda não foi habilitada para ele.';
  }
  function restore() {
    if (location.hash !== '#pedido-salvo') return false;
    try {
      const saved = JSON.parse(sessionStorage.getItem(RECEIPT_KEY));
      if (!saved || !saved.orderId || Date.now() - saved.savedAt > 86400000) return false;
      document.querySelector('.chosen-model').hidden = true;
      document.querySelector('#model-note').hidden = true;
      showReceipt(saved);return true;
    } catch {return false;}
  }
  form.addEventListener('submit',async event => {
    event.preventDefault();
    if (busy || !item || !config || !form.reportValidity()) return;
    errorBox.hidden = true;setBusy(true);
    try {
      const company = document.querySelector('#order-company').value.trim();
      const durationSeconds = Number(form.querySelector('[name="duration"]:checked')?.value);
      if (company.length < 2 || company.length > 100) throw new Error('Preencha o nome da empresa com 2 a 100 caracteres.');
      if (!products.isEnabled() && ![10,20].includes(durationSeconds)) throw new Error('Escolha 10 ou 20 segundos.');
      if (!document.querySelector('#order-consent').checked) throw new Error('Confirme a autorização para usar as imagens.');
      const [logo,photo] = await Promise.all([
        readUpload(document.querySelector('#order-logo').files[0],5 * 1024 * 1024,'Logo'),
        products.isEnabled() ? null : readUpload(document.querySelector('#order-photo').files[0],10 * 1024 * 1024,'Foto do produto'),
      ]);
      if (!logo) throw new Error('Adicione o logo da empresa.');
      const payload = products.isEnabled()
        ? {videoId:item.id,videoVersion:item.version,company,logo,consent:true,...await products.payload()}
        : {videoId:item.id,videoVersion:item.version,company,durationSeconds,logo,photo,consent:true};
      if (!products.isEnabled()) {
        const productPrice = normalizeProductPrice(document.querySelector('#order-product-price').value);
        if (productPrice) payload.productPrice = productPrice;
      }
      const fingerprint = await fingerprintPayload(payload);
      let requestId;
      try {
        requestId = navigator.locks ? await navigator.locks.request(`edit-${fingerprint}`,() => getOrCreateRequestId(fingerprint)) : getOrCreateRequestId(fingerprint);
      } catch {throw new Error('Ative o armazenamento deste navegador para salvar o pedido sem duplicações. Nenhum pedido foi enviado.');}
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(),90000);
      let response;
      try {
        response = await fetch(SUBMIT_ENDPOINT,{method:'POST',headers:{'Idempotency-Key':await idempotencyKey(requestId)},body:buildMultipartOrder(payload),signal:controller.signal,credentials:'omit',cache:'no-store'});
      } finally {clearTimeout(timeout);}
      const responseBody = await response.json().catch(() => ({}));
      const result = response.ok ? normalizeReceipt(responseBody,payload) : responseBody;
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : typeof result.message === 'string' ? result.message : 'Não foi possível confirmar o pedido. Tente novamente; a mesma tentativa será preservada.');
      if (!result.orderId || result.status !== 'awaiting_authorization') throw new Error('A resposta não confirmou o pedido. Tente novamente para consultar a mesma tentativa, sem criar outra.');
      const saved = {orderId:result.orderId,status:result.status,totalCents:result.totalCents,message:result.message,whatsappUrl:result.whatsappUrl,fingerprint,requestId,videoId:item.id};
      const receiptPreserved = rememberReceipt(saved);showReceipt(saved);
      // Persist the receipt route before leaving. Browser Back restores the saved order.
      history.replaceState(null,'','#pedido-salvo');
      try {if (receiptPreserved) location.assign(safeWhatsAppUrl(result.whatsappUrl,result.message,result.orderId));}
      catch {toast('O pedido foi salvo. Use “Continuar no WhatsApp” ou copie a mensagem.');}
    } catch(error) {
      showError(error.name === 'AbortError' ? 'A confirmação demorou mais que o esperado. Tente novamente; usaremos a mesma tentativa para não duplicar.' : error.message || 'Não foi possível confirmar o pedido. Tente novamente.');
    } finally {setBusy(false);}
  });
  document.querySelector('#copy-message').addEventListener('click',async () => {
    if (!receipt?.message) return;
    try {await navigator.clipboard.writeText(receipt.message);toast('Mensagem copiada.');}
    catch {messageBox.hidden = false;messageBox.focus();messageBox.select();toast('Selecione e copie a mensagem abaixo.');}
  });
  document.querySelector('#new-order').addEventListener('click',() => {
    if (busy || !receipt) return;
    try {
      resetSavedAttempt(receipt);
      sessionStorage.removeItem(RECEIPT_KEY);
    } catch(error) {toast(error.message || 'Não foi possível preparar outro pedido. O anterior continua salvo.');return;}
    receipt = null;item = null;form.reset();errorBox.hidden = true;success.hidden = true;messageBox.hidden = true;
    dialog.close();toast('Pedido anterior preservado. Escolha um vídeo para fazer outro pedido.');
  });
  dialog.addEventListener('close',() => {
    document.querySelector('.chosen-model').hidden = false;document.querySelector('#model-note').hidden = false;
    if (location.hash === '#pedido-salvo') history.replaceState(null,'','#hoje');
  });
  return {open,restore,isBusy:() => busy};
}
