import {requestAppCalendar,appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos} from './app-calendar.js?v=20261030-combos-v1';
import {createUploadField} from './upload-field.js?v=20261021-upload';
import {createImageSubmission} from './my-images-submit.js?v=20261101-my-images-v1';

export function createMyImages({dialog,onOpenChange=()=>{}}) {
  const form=dialog.querySelector('form'),input=dialog.querySelector('input[type=file]');
  const caption=dialog.querySelector('textarea'),send=dialog.querySelector('[data-my-images-send]');
  const error=dialog.querySelector('[role=alert]'),preview=dialog.querySelector('[data-my-images-preview]');
  const success=dialog.querySelector('[data-my-images-success]'),hint=dialog.querySelector('[data-my-images-hint]');
  const upload=createUploadField(input,{maxBytes:10*1024*1024,label:'Imagem'});
  let busy=false,locked=false,snapshot=null,previewUrl=null,submission=null;
  const showError=message=>{error.textContent=message||'';error.hidden=!message;};
  function hasPending(){try{return Boolean(submission?.hasPending());}catch{return true;}}
  function refresh() {
    const app=Boolean(appCalendarAttemptScope()),exhausted=appCreationAllowed('image')===false;
    const recovering=hasPending(),buyMore=exhausted&&!locked&&!recovering;
    send.textContent=busy?'Enviando sua imagem…':buyMore?'Suas imagens acabaram · Ver combos':locked||recovering?'Confirmar o mesmo envio':'Escolher dia e hora';
    send.disabled=busy||!app;
    send.formNoValidate=buyMore;
    input.disabled=busy||locked;caption.readOnly=busy||locked;
    for(const button of dialog.querySelectorAll('[data-my-images-close]'))button.disabled=busy;
  }
  function reset() {
    form.reset();upload.reset();snapshot=null;locked=false;showError('');
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;preview.removeAttribute('src');preview.hidden=true;
    form.hidden=false;success.hidden=true;refresh();
    try {hint.textContent=submission?.hasPending()?'Há um envio para confirmar. Escolha a mesma imagem e legenda.':'Usa 1 imagem do seu plano.';}
    catch(error){showError(error.message);}
  }
  function ensureSubmission() {
    const scope=appCalendarAttemptScope();
    if(!submission && scope)submission=createImageSubmission({scope,storage:window.sessionStorage,requestCalendar:requestAppCalendar});
  }
  input.addEventListener('change',()=>{
    showError('');snapshot=null;
    if(previewUrl)URL.revokeObjectURL(previewUrl);
    previewUrl=null;preview.hidden=true;
    const file=input.files?.[0];
    if(file && ['image/png','image/jpeg','image/webp'].includes(file.type) && file.size<=10*1024*1024) {
      previewUrl=URL.createObjectURL(file);preview.src=previewUrl;preview.hidden=false;
    }
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    if(!locked && !hasPending() && appCreationAllowed('image')===false){openAppCombos();return;}
    if(!form.reportValidity())return;
    busy=true;showError('');refresh();
    try {
      ensureSubmission();
      if(!submission)throw new Error('Abra Posts prontos pelo app para agendar sua imagem.');
      if(!snapshot) {
        const value=await upload.read();
        if(!value)throw new Error('Escolha sua imagem.');
        const bytes=Uint8Array.from(atob(value.data),c=>c.charCodeAt(0));
        snapshot={image:new Blob([bytes],{type:value.mime}),caption:caption.value.trim()};
      }
      const result=await submission.send(snapshot);
      locked=false;form.hidden=true;success.hidden=false;
      dialog.querySelector('[data-my-images-receipt]').textContent=result.automatic===true
        ?'Imagem agendada. Acompanhe no Calendário.':'Imagem salva. Acompanhe no Calendário.';
      refreshAppAvailability();
      document.dispatchEvent(new CustomEvent('ia4tube:my-image-saved',{detail:{requestId:result.requestId}}));
    } catch(failure) {
      try {locked=Boolean(submission?.hasPending()) && failure.code!=='ready_image_pending_mismatch';}catch {locked=true;}
      if(!locked)snapshot=null;
      showError(failure.message||'Não foi possível confirmar. Tente novamente com a mesma imagem e legenda.');
    } finally {busy=false;refresh();}
  });
  for(const button of dialog.querySelectorAll('[data-my-images-close]'))button.addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.querySelector('[data-my-images-another]').addEventListener('click',reset);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  dialog.addEventListener('close',onOpenChange);
  document.addEventListener('ia4tube:edit-availability-changed',refresh);
  return Object.freeze({open(){
    try{ensureSubmission();}catch(error){showError('Não foi possível preservar o envio neste aparelho. Reabra Posts prontos pelo app.');}
    if(!appCalendarAttemptScope())showError('Abra Posts prontos pelo app para agendar sua imagem.');
    else if(!locked && !success.hidden)reset();
    else {
      try {hint.textContent=submission?.hasPending()?'Há um envio para confirmar. Escolha a mesma imagem e legenda.':'Usa 1 imagem do seu plano.';}
      catch(error){showError(error.message);}
    }
    refresh();dialog.showModal();onOpenChange();
  }});
}
