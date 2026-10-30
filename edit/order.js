import { requestAppCalendar, appCalendarAttemptScope } from './app-calendar.js?v=20261030-combos-v1';
import { quotaCombosLabel } from './order-cta.js?v=20261030-media-quota-v1';
import { createOrderRecovery } from './order-recovery.js?v=20261030-availability-v1';
import { buildMultipartOrder, idempotencyKey, normalizeReceipt, calendarContextHash, safeWhatsAppUrl, SUBMIT_ENDPOINT } from './order-adapter.js?v=20261030-receipt-alias-v1';
import { createModelOptions } from './model-options.js?v=20261020-styles';
import { createReadyPostOptions,isReadyPost } from './ready-posts.js?v=20261030-media-quota-v1';
import { createExtraPostOptions } from './ready-posts-extra.js?v=20261029-extra40';
import { createProductsForm } from './products-form.js?v=20261021-upload';
import { normalizeProductPrice } from './optional-price.js?v=20261019-price';
import { normalizeProductDescription } from './product-description.js?v=20261022-no-photo';
import { modelMainPhrase, normalizeCustomPhrase } from './custom-phrase.js?v=20261022-phrase';
import { createUploadField } from './upload-field.js?v=20261021-upload';
import { releaseInfo } from './availability.js?v=20261021-products-open';

// v1 permanently identified matching content, including completed purchases
// without a receipt in this tab. Keep those records untouched as history;
// only explicit per-tab pending attempts may recover a pre-migration request.
const ATTEMPT_PREFIX = 'ia4tube.edit.attempt.v2.';
const PENDING_PREFIX = 'ia4tube.edit.pending.v1.';
const RECEIPT_KEY = 'ia4tube.edit.receipt.v1';
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

function storedAttempt(raw) {
  if (!raw) return null;
  // Unconfirmed attempts in this lifecycle remain recoverable after a timeout.
  if (REQUEST_ID.test(raw)) return {requestId:raw,confirmed:false};
  const value = JSON.parse(raw);
  if (!value || !REQUEST_ID.test(value.requestId) || value.confirmed !== true) throw new Error('Não foi possível recuperar esta tentativa.');
  return value;
}

export async function fingerprintPayload(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const digest = await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
export function getOrCreateRequestId(fingerprint,storage = localStorage,pendingStorage = null) {
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Não foi possível identificar esta tentativa.');
  const pendingKey = PENDING_PREFIX + fingerprint;
  const pending = pendingStorage?.getItem(pendingKey);
  if (pending) {
    if (!REQUEST_ID.test(pending)) throw new Error('Não foi possível recuperar esta tentativa.');
    return pending;
  }
  const key = ATTEMPT_PREFIX + fingerprint;
  const existing = storedAttempt(storage.getItem(key));
  const requestId = existing && !existing.confirmed ? existing.requestId : crypto.randomUUID();
  if (requestId !== existing?.requestId) {
    storage.setItem(key,requestId);
    if (storage.getItem(key) !== requestId) throw new Error('O navegador não conseguiu preservar esta tentativa.');
  }
  if (pendingStorage) {
    pendingStorage.setItem(pendingKey,requestId);
    if (pendingStorage.getItem(pendingKey) !== requestId) throw new Error('O navegador não conseguiu preservar esta tentativa.');
  }
  return requestId;
}
export function confirmSavedAttempt(saved,storage = localStorage,pendingStorage = null) {
  if (!REQUEST_ID.test(saved?.orderId || '') || saved.status !== 'awaiting_authorization' || !/^[a-f0-9]{64}$/.test(saved.fingerprint || '') || !REQUEST_ID.test(saved.requestId || '')) throw new Error('Só é possível iniciar outro pedido após confirmar que este foi salvo.');
  const key = ATTEMPT_PREFIX + saved.fingerprint;
  // An old receipt cannot retire a newer purchase in another tab.
  const current = storedAttempt(storage.getItem(key));
  if (current?.requestId === saved.requestId && !current.confirmed) {
    storage.setItem(key,JSON.stringify({requestId:saved.requestId,confirmed:true}));
    if (storedAttempt(storage.getItem(key))?.confirmed !== true) throw new Error('Não foi possível confirmar esta tentativa no navegador.');
  }
  const pendingKey = PENDING_PREFIX + saved.fingerprint;
  if (pendingStorage?.getItem(pendingKey) === saved.requestId) pendingStorage.removeItem(pendingKey);
}
export function createOrderController({dialog,money,toast,onBusy,onSaved = () => {},appOnly=false,
  hasAppContext=()=>Boolean(appCalendarAttemptScope()),requestCalendar=requestAppCalendar,
  originFor=()=>null,onReturnToOrigin=()=>false,canCreate=()=>null,onPendingChange=()=>{},
  attemptScope=appCalendarAttemptScope,onAdmitted=()=>{},onOpenCombos=()=>false}) {
  const form = document.querySelector('#order-form');
  const errorBox = document.querySelector('#order-error');
  const submit = document.querySelector('#send-order');
  const success = document.querySelector('#order-success');
  const displayOnly = document.querySelector('#display-only-note');
  const messageBox = document.querySelector('#saved-message');
  let item = null,config = null,busy = false,receipt = null,origin = null;
  const recovery=appOnly?createOrderRecovery({storage:{getItem:key=>sessionStorage.getItem(key),setItem:(key,value)=>sessionStorage.setItem(key,value)},scope:attemptScope,
    isPending:(fingerprint,id)=>sessionStorage.getItem(PENDING_PREFIX+fingerprint)===id}):{hasModel:()=>false};
  const initialSubmitLabel = submit.innerHTML;
  const logoUpload = createUploadField(document.querySelector('#order-logo'),{maxBytes:5 * 1024 * 1024,label:'Logo'});
  const photoUpload = createUploadField(document.querySelector('#order-photo'),{maxBytes:10 * 1024 * 1024,label:'Foto do produto'});
  const products = createProductsForm({form,money});
  const modelOptions = createModelOptions(form,money);
  const readyPosts = createReadyPostOptions(form,money,kind=>appOnly?canCreate(kind):null,()=>appOnly&&recovery.hasModel(item?.id),
    {onOpenCombos:()=>{if(!busy)openCombos();},onSelectionChange:()=>syncSubmitAction()});
  const extraPosts = createExtraPostOptions(form,{onChange:()=>syncPhraseFields()});
  const photoInput = document.querySelector('#order-photo');
  const descriptionInput = document.querySelector('#order-product-description');
  const photoChoice = document.querySelector('#order-has-photo');
  const descriptionChoice = document.querySelector('#order-no-photo');
  const phraseOptions = document.querySelector('#order-phrase-options');
  const phraseInput = document.querySelector('#order-custom-phrase');
  const modifyPhrase = document.querySelector('#modify-main-phrase');
  const resetPhrase = document.querySelector('#reset-main-phrase');
  let editingPhrase = false,phraseEditingSeed = null;

  function syncPhraseFields() {
    const mainPhrase=extraPosts.previewPhrase() ?? modelMainPhrase(item);
    if (editingPhrase && extraPosts.isEnabled() && phraseInput.value===phraseEditingSeed) {
      phraseInput.value=mainPhrase;phraseEditingSeed=mainPhrase;
    }
    const active = !products.isEnabled() && !form.hidden && (!extraPosts.isEnabled() || Boolean(mainPhrase));
    phraseOptions.hidden = !active;
    document.querySelector('#order-phrase-current').textContent = mainPhrase;
    document.querySelector('#order-phrase-current').hidden = editingPhrase;
    document.querySelector('#order-phrase-editor').hidden = !active || !editingPhrase;
    document.querySelector('#chosen-phrase').hidden = active || extraPosts.isEnabled();
    modifyPhrase.hidden = editingPhrase;
    modifyPhrase.disabled = busy || !active;
    modifyPhrase.setAttribute('aria-expanded',String(editingPhrase));
    phraseInput.disabled = resetPhrase.disabled = busy || !active || !editingPhrase;
    phraseInput.required = active && editingPhrase;
    if (!editingPhrase) phraseInput.value = mainPhrase;
  }
  modifyPhrase.addEventListener('click',() => {
    if (busy || products.isEnabled() || form.hidden) return;
    phraseEditingSeed=extraPosts.previewPhrase() ?? modelMainPhrase(item);
    phraseInput.value=phraseEditingSeed;
    editingPhrase = true;syncPhraseFields();phraseInput.focus();phraseInput.select();
  });
  resetPhrase.addEventListener('click',() => {
    if (busy || products.isEnabled()) return;
    editingPhrase = false;syncPhraseFields();modifyPhrase.focus();
  });

  function usesDescription() {return !products.isEnabled() && extraPosts.allowDescription() && descriptionChoice.checked;}
  function syncImageFields() {
    const single = !products.isEnabled(),described = usesDescription();
    photoChoice.disabled = descriptionChoice.disabled = busy || !single || !extraPosts.allowDescription();
    document.querySelector('#order-photo-field').hidden = !single || described || !extraPosts.allowPhoto();
    photoInput.disabled = busy || !single || described || !extraPosts.allowPhoto();
    document.querySelector('#order-description-field').hidden = !single || !described;
    descriptionInput.disabled = busy || !single || !described;
    descriptionInput.required = described;
    document.querySelector('#order-company').disabled = busy || single;
    extraPosts.sync(busy,{single});
  }
  for (const choice of [photoChoice,descriptionChoice]) choice.addEventListener('change',() => {
    photoUpload.reset();syncImageFields();
  });

  function clearUploads() {logoUpload.reset();photoUpload.reset();products.resetUploads();}
  function resetForm() {editingPhrase = false;phraseEditingSeed=null;clearUploads();form.reset();syncImageFields();syncPhraseFields();}
  form.addEventListener('reset',() => {editingPhrase = false;phraseEditingSeed=null;clearUploads();});

  const currentOutput=()=>readyPosts.selected() || item?.mediaKind || 'video';
  function wantsCombos() {
    return appOnly && !busy && !receipt && item && !form.hidden && hasAppContext() &&
      !releaseInfo(item) && canCreate(currentOutput())===false && !recovery.hasModel(item.id);
  }
  function openCombos() {
    let opened=false;try{opened=onOpenCombos()===true;}catch{}
    if(!opened)toast('Abra Combo na tela inicial do app para comprar mais artes.');
  }
  function syncSubmitAction() {
    const buying=wantsCombos();
    submit.type=buying?'button':'submit';
    submit.innerHTML=busy?'Salvando seu pedido…':buying?quotaCombosLabel(currentOutput(),canCreate):
      appOnly && item && recovery.hasModel(item.id)?'Conferir pedido':initialSubmitLabel;
  }
  submit.addEventListener('click',event=>{
    if(wantsCombos()){event.preventDefault();openCombos();}
  });
  form.addEventListener('change',syncSubmitAction);

  function setBusy(value) {
    busy = value;
    [...form.elements].forEach(control => control.disabled = value);
    products.sync(value);
    modelOptions.sync(value);
    readyPosts.sync(value);
    syncImageFields();
    syncPhraseFields();
    dialog.querySelector('.close-dialog').disabled = value;
    syncSubmitAction();
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
    try {link.href = safeWhatsAppUrl(saved.whatsappUrl,saved.message,saved.orderId);link.hidden = appOnly;}
    catch {link.removeAttribute('href');link.hidden = true;if(!appOnly)toast('Pedido salvo. Copie a mensagem para continuar pelo WhatsApp.');}
    if(appOnly){
      document.querySelector('#copy-message').hidden=true;
      const guidance=document.querySelector('#receipt-guidance');
      if(guidance)guidance.textContent=saved.admission?'Pedido recebido. Acompanhe pelo app.':'Comprovante anterior preservado. A autorização atual precisa ser conferida antes de produzir.';
      const back=document.querySelector('#return-source');if(back)back.hidden=false;
    }
    success.scrollIntoView({block:'nearest'});
  }
  function rememberReceipt(saved) {
    try {
      const value = JSON.stringify({...saved,savedAt:Date.now()});
      sessionStorage.setItem(RECEIPT_KEY,value);
      return sessionStorage.getItem(RECEIPT_KEY) === value;
    }
    catch {return false;} // Keep the saved confirmation visible if browser storage is unavailable.
  }
  function knownReceipt() {
    const raw = sessionStorage.getItem(RECEIPT_KEY);
    try {return JSON.parse(raw || 'null');} catch {return null;}
  }
  function withAttemptLock(fingerprint,action) {
    return navigator.locks ? navigator.locks.request(`edit-${fingerprint}`,action) : action();
  }
  function open(nextItem,nextConfig,{preferredKind=null}={}) {
    if (busy) return;
    if(appOnly && !hasAppContext()){toast('Peça pelo app da iA4tube. O catálogo continua disponível para você escolher.');return false;}
    if(preferredKind!==null && (!isReadyPost(nextItem) || !['image','video'].includes(preferredKind)))return false;
    if(appOnly && receipt?.videoId===nextItem.id && recovery.hasModel(nextItem.id)){showReceipt(receipt);return true;}
    const release = releaseInfo(nextItem);
    if (release) {toast(release.label);return false;}
    const recovering=appOnly&&recovery.hasModel(nextItem.id);
    const previousKind=item?.id===nextItem.id&&item?.version===nextItem.version&&!receipt&&readyPosts.isEnabled()?readyPosts.selected():null;
    const intendedKind=(recovering?previousKind:preferredKind || previousKind) || nextItem.mediaKind || 'video';
    if(appOnly && canCreate(intendedKind)===false && !recovering){
      openCombos();return false;
    }
    if (item?.id !== nextItem.id || receipt) resetForm();
    item = nextItem;config = nextConfig;receipt = null;origin = originFor(nextItem);
    document.querySelector('#sheet-title').textContent = 'Gostou? Faça o seu.';
    errorBox.hidden = true;success.hidden = true;messageBox.hidden = true;
    const enabled = item.orderEnabled === true && ['sextou','sabadou','produtos'].includes(item.recipe);
    products.open(item.recipe === 'produtos');
    form.hidden = !enabled;displayOnly.hidden = enabled;
    const invalidPrice = modelOptions.open(item,config);
    const invalidPostPrice = readyPosts.open(item,intendedKind);
    const invalidExtraFields = extraPosts.open(item);
    if(appOnly){const explanation=form.querySelector('.order-explanation[data-single-product]');
      explanation.textContent=explanation.textContent.replace('Receba pelo WhatsApp.','Acompanhe pelo app.');}
    syncImageFields();
    if (enabled && (invalidPrice || invalidPostPrice || invalidExtraFields)) {
      form.hidden = true;displayOnly.hidden = false;displayOnly.textContent = 'O preço deste modelo precisa ser conferido no programa antes de receber pedidos.';
    } else displayOnly.textContent = 'Este vídeo é apenas uma referência visual. A personalização ainda não foi habilitada para ele.';
    syncPhraseFields();syncSubmitAction();
    return true;
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
    if (busy || receipt || form.hidden || !item || !config) return;
    if(wantsCombos()){openCombos();return;}
    if(!form.reportValidity())return;
    if(appOnly && !hasAppContext()){showError('Envie este pedido pelo app da iA4tube.');return;}
    const release = releaseInfo(item);
    if (release) {showError(release.label);return;}
    // Freeze the person's output choice before busy synchronization or any file await.
    const selectedKind=readyPosts.isEnabled()?readyPosts.selected():null;
    const selectedOutput=selectedKind || item.mediaKind || 'video';
    errorBox.hidden = true;setBusy(true);
    try {
      const company = products.isEnabled() ? document.querySelector('#order-company').value.trim() : '';
      const durationSeconds = Number(form.querySelector('[name="duration"]:checked')?.value);
      if (products.isEnabled() && (company.length < 2 || company.length > 100)) throw new Error('Preencha o nome da empresa com 2 a 100 caracteres.');
      if (!products.isEnabled() && ![10,20].includes(durationSeconds)) throw new Error('Escolha 10 ou 20 segundos.');
      if (!document.querySelector('#order-consent').checked) throw new Error('Confirme a autorização para usar as imagens.');
      const productDescription = usesDescription() ? normalizeProductDescription(descriptionInput.value,{required:true}) : '';
      const enteredPhrase = !products.isEnabled() && editingPhrase ? normalizeCustomPhrase(phraseInput.value,{required:true}) : '';
      const customPhrase = enteredPhrase && enteredPhrase !== (extraPosts.previewPhrase() ?? modelMainPhrase(item)) ? enteredPhrase : '';
      const templateFields=extraPosts.read();
      const [logo,photo] = await Promise.all([
        logoUpload.read(),
        products.isEnabled() || usesDescription() || !extraPosts.allowPhoto() ? null : photoUpload.read(),
      ]);
      if (!logo) throw new Error('Adicione o logo da empresa.');
      extraPosts.validateReference(photo,productDescription);
      const payload = products.isEnabled()
        ? {videoId:item.id,videoVersion:item.version,company,logo,consent:true,...await products.payload()}
        : {videoId:item.id,videoVersion:item.version,company,durationSeconds,logo,photo,consent:true};
      if (selectedKind) payload.mediaKind = selectedKind;
      if (templateFields) payload.templateFields=templateFields;
      if (!products.isEnabled()) {
        if (productDescription) payload.productDescription = productDescription;
        if (customPhrase) payload.customPhrase = customPhrase;
        const productPrice = extraPosts.allowProductPrice() ? normalizeProductPrice(document.querySelector('#order-product-price').value) : '';
        if (productPrice) payload.productPrice = productPrice;
        const animal = modelOptions.animal();
        if (animal) payload.animal = animal;
      }
      const appScope = attemptScope();
      const fingerprint = await fingerprintPayload(appScope ? {...payload,appCalendarSession:appScope} : payload);
      if(appOnly && canCreate(selectedOutput)===false && !REQUEST_ID.test(sessionStorage.getItem(PENDING_PREFIX+fingerprint) || ''))
        throw new Error(quotaCombosLabel(selectedOutput,canCreate)+'. Você pode continuar vendo os modelos e conferir uma tentativa pendente.');
      let requestId;
      try {
        // Finalize the previous known receipt before another model can replace
        // it. Its own lock protects unrelated newer purchases in other tabs.
        const known = knownReceipt();
        if (known) await withAttemptLock(known.fingerprint,() => confirmSavedAttempt(known,localStorage,sessionStorage));
        requestId = await withAttemptLock(fingerprint,() => {
          return getOrCreateRequestId(fingerprint,localStorage,sessionStorage);
        });
      } catch {throw new Error('Ative o armazenamento deste navegador para salvar o pedido sem duplicações. Nenhum pedido foi enviado.');}
      const appCalendar = await requestCalendar(requestId);
      if(appOnly && !appCalendar?.ticket)throw new Error('Confirme a conta e o calendário no app. Nenhum pedido foi enviado.');
      if (appCalendar) payload.appCalendar = appCalendar;
      const contextHash=appOnly?await calendarContextHash(appCalendar.ticket):null;
      if(appOnly){recovery.record(fingerprint,{requestId,modelId:item.id,modelVersion:item.version});try{onPendingChange();}catch{/* Visual refresh only. */}}
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(),90000);
      let response;
      try {
        const release = releaseInfo(item);
        if (release) throw new Error(release.label);
        response = await fetch(SUBMIT_ENDPOINT,{method:'POST',headers:{'Idempotency-Key':await idempotencyKey(requestId)},body:buildMultipartOrder(payload),signal:controller.signal,credentials:'omit',cache:'no-store'});
      } finally {clearTimeout(timeout);}
      const responseBody = await response.json().catch(() => ({}));
      const result = response.ok ? normalizeReceipt(responseBody,payload,{requireAdmission:appOnly,contextHash}) : responseBody;
      if (!response.ok) {
        const messages={billing_required:'Seu saldo não permite enviar este pedido. Confira seus créditos no app.',
          app_required:'Peça pelo app da iA4tube.',edit_calendar_context_expired:'A autorização do calendário expirou. Reabra o Edit pelo app antes de enviar.',
          edit_calendar_admission_disabled:'O envio pelo app está temporariamente indisponível. Sua tentativa foi preservada.',
          edit_calendar_admission_unavailable:'A reserva ainda não foi confirmada. Tente novamente com a mesma tentativa.',
          edit_calendar_admission_rate_limited:'Aguarde alguns segundos e tente o mesmo pedido.',
          edit_calendar_allocation_busy:'Sua reserva está sendo conferida. Aguarde e repita a mesma tentativa.',
          edit_calendar_allocation_reconciliation_required:'Sua reserva precisa ser conferida. Preserve este pedido e procure o suporte.',
          edit_calendar_session_required:'Entre novamente na sua conta pelo app antes de enviar.',
          edit_calendar_free_art_receipt_unconfirmed:'A confirmação da arte grátis precisa ser conferida. Preserve este pedido e procure o suporte.'};
        throw new Error(messages[result.error] || (typeof result.error === 'string' ? result.error : typeof result.message === 'string' ? result.message : 'Não foi possível confirmar o pedido. Tente novamente; a mesma tentativa será preservada.'));
      }
      if (!result.orderId || result.status !== 'awaiting_authorization') throw new Error('A resposta não confirmou o pedido. Tente novamente para consultar a mesma tentativa, sem criar outra.');
      const saved = {orderId:result.orderId,status:result.status,totalCents:result.totalCents,message:result.message,whatsappUrl:result.whatsappUrl,fingerprint,requestId,videoId:item.id,
        ...(appOnly?{admission:result.admission,receiptUrl:result.receiptUrl,videoVersion:item.version,origin}:{})};
      const receiptPreserved = rememberReceipt(saved);showReceipt(saved);
      // Optional statistics never participate in saving or redirecting the order.
      try {onSaved({orderId:saved.orderId,videoId:item.id,recipe:item.recipe,
        ...(payload.productsVideo ? {productCount:payload.productsVideo.packageCount} : {durationSeconds:payload.durationSeconds,productCount:1})});}
      catch { /* Analytics must never turn a saved order into a checkout error. */ }
      let attemptConfirmed=false;
      try {if (receiptPreserved) {await withAttemptLock(fingerprint,() => confirmSavedAttempt(saved,localStorage,sessionStorage));attemptConfirmed=true;}}
      catch { /* A confirmed order remains saved; its receipt can recover this next time. */ }
      if(appOnly){
        if(attemptConfirmed)try{recovery.forget(fingerprint,requestId);}catch{/* Pending identity is already retired. */}
        try{onAdmitted(saved);}catch{/* Read-only hint refresh cannot undo a saved order. */}
        try{onPendingChange();}catch{/* Visual refresh only. */}
      }
      // Persist the receipt route before leaving. Browser Back restores the saved order.
      history.replaceState(null,'','#pedido-salvo');
      try {if(appOnly){if(receiptPreserved&&attemptConfirmed)returnToOrigin(saved);}
        else if (receiptPreserved) location.assign(safeWhatsAppUrl(result.whatsappUrl,result.message,result.orderId));}
      catch {toast(appOnly?'O pedido foi salvo. Seu comprovante continua disponível nesta tela.':'O pedido foi salvo. Use “Continuar no WhatsApp” ou copie a mensagem.');}
    } catch(error) {
      showError(error.name === 'AbortError' ? 'A confirmação demorou mais que o esperado. Tente novamente; usaremos a mesma tentativa para não duplicar.' : error.message || 'Não foi possível confirmar o pedido. Tente novamente.');
    } finally {setBusy(false);}
  });
  function returnToOrigin(saved){
    if(onReturnToOrigin(saved.origin || {modelId:saved.videoId,modelVersion:saved.videoVersion},saved)===false)return false;
    dialog.close();toast('Pedido '+saved.orderId+' salvo. Seu comprovante foi preservado.');return true;
  }
  if(appOnly)document.querySelector('#return-source')?.addEventListener('click',()=>{if(!busy&&receipt)returnToOrigin(receipt);});
  document.querySelector('#copy-message').addEventListener('click',async () => {
    if (!receipt?.message) return;
    try {await navigator.clipboard.writeText(receipt.message);toast('Mensagem copiada.');}
    catch {messageBox.hidden = false;messageBox.focus();messageBox.select();toast('Selecione e copie a mensagem abaixo.');}
  });
  document.querySelector('#new-order').addEventListener('click',async () => {
    if (busy || !receipt) return;
    const saved = receipt;
    if(appOnly && !saved.admission){toast('O comprovante anterior foi preservado. Confira sua autorização no app antes de produzir.');return;}
    try {
      await withAttemptLock(saved.fingerprint,() => confirmSavedAttempt(saved,localStorage,sessionStorage));
      if (receipt !== saved) return;
      if(!appOnly)sessionStorage.removeItem(RECEIPT_KEY);
    } catch(error) {toast(error.message || 'Não foi possível preparar outro pedido. O anterior continua salvo.');return;}
    if(appOnly && !returnToOrigin(saved))return;
    receipt = null;item = null;resetForm();errorBox.hidden = true;success.hidden = true;messageBox.hidden = true;
    if(!appOnly)dialog.close();toast('Pedido anterior preservado. Escolha um modelo para fazer outro pedido.');
  });
  dialog.addEventListener('close',() => {
    document.querySelector('.chosen-model').hidden = false;document.querySelector('#model-note').hidden = false;
    if (location.hash === '#pedido-salvo' && !appOnly) history.replaceState(null,'','#hoje');
  });
  return {open,restore,isBusy:() => busy,canRecover:modelId=>appOnly&&recovery.hasModel(modelId),
    refreshAvailability:()=>{readyPosts.sync(busy);syncSubmitAction();}};
}
