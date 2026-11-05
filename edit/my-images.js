import {appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos} from './app-calendar.js?v=20261102-placements-v1';
import {createImageQueue} from './my-images-queue.js?v=20261102-placements-v1';

export function createMyImages({dialog,onOpenChange=()=>{}}) {
  const form=dialog.querySelector('form'),input=dialog.querySelector('[data-my-images-add]');
  const list=dialog.querySelector('[data-my-images-list]'),send=dialog.querySelector('[data-my-images-send]');
  const error=dialog.querySelector('[role=alert]'),hint=dialog.querySelector('[data-my-images-hint]');
  const summary=dialog.querySelector('[data-my-images-summary]');
  let progress=dialog.querySelector('[data-my-images-progress]');
  // Older cached HTML can load this module before its new markup is available.
  if(!progress){
    progress=document.createElement('p');progress.className='my-images-progress';progress.hidden=true;
    progress.setAttribute('data-my-images-progress','');progress.setAttribute('role','status');
    progress.setAttribute('aria-live','polite');progress.setAttribute('aria-atomic','true');form.prepend(progress);
  }
  // An unfinished draft must not prevent confirming a different, already reserved image.
  form.noValidate=true;
  let queue=null,operation=null;const nodes=new Map();
  const showError=message=>{error.textContent=message||'';error.hidden=!message;};
  const dateLabel=value=>value?value.split('-').reverse().join('/'):'Escolher dia';
  function ensureQueue() {
    const scope=appCalendarAttemptScope();
    if(!queue && scope)queue=createImageQueue({scope,storage:window.sessionStorage,onChange:render});
  }
  function rowNode(row) {
    const article=document.createElement('article');article.className='my-image-item';
    article.innerHTML=`<header><strong></strong><button type="button" class="my-image-remove" aria-label="Remover imagem">×</button></header>
      <img class="my-image-preview" alt="Imagem escolhida" loading="lazy" decoding="async" hidden>
      <label class="order-field my-image-restore" hidden>Escolher esta imagem novamente<input type="file" accept="image/png,image/jpeg,image/webp"></label>
      <label class="order-field">Legenda<textarea rows="3" maxlength="2200" placeholder="Escreva a legenda da publicação" required></textarea></label>
      <div class="my-image-schedule"><label>Dia<button type="button" class="my-image-day"><span></span><b aria-hidden="true">✎</b></button></label>
      <label>Hora<button type="button" class="my-image-time"><span></span><b aria-hidden="true">✎</b></button></label></div>
      <p class="my-image-status" role="status"></p>`;
    const caption=article.querySelector('textarea'),replace=article.querySelector('input[type=file]');
    const day=article.querySelector('.my-image-day'),time=article.querySelector('.my-image-time');
    caption.addEventListener('input',()=>{try{queue.setCaption(row.id,caption.value);showError('');}catch(failure){showError(failure.message);}});
    article.querySelector('.my-image-remove').addEventListener('click',()=>{try{queue.remove(row.id);showError('');}catch(failure){showError(failure.message);}});
    replace.addEventListener('change',()=>{try{if(replace.files?.[0])queue.replaceFile(row.id,replace.files[0]);showError('');}catch(failure){showError(failure.message);}});
    const schedule=async()=>{
      if(queue?.isBusy())return;
      operation={kind:'schedule',ids:[row.id]};
      showError('');try{await queue.schedule(row.id);}catch(failure){showError(failure.message);}finally{operation=null;render();}
    };
    day.addEventListener('click',schedule);time.addEventListener('click',schedule);
    return {article,caption,replace,day,time,image:article.querySelector('img'),status:article.querySelector('[role=status]'),file:null,url:null};
  }
  function render() {
    const rows=queue?.items()||[],busy=queue?.isBusy()||false,app=Boolean(appCalendarAttemptScope());
    const pending=rows.some(row=>row.status==='pending'),unfinished=rows.filter(row=>row.status!=='saved');
    const remaining=queue?.remaining()??null;
    const buyMore=!pending && (appCreationAllowed('image')===false || remaining===0);
    const activeId=operation?.ids.find(id=>rows.some(row=>row.id===id && row.status!=='saved'));
    const position=operation?.ids.indexOf(activeId)??-1;
    const busyMessage=operation?.kind==='schedule'?'Confirmando horário…':operation?.kind==='send'
      ?position<0?'Confirmando envio…':`Enviando imagem ${position+1} de ${operation.ids.length}…`:'Aguarde…';
    progress.hidden=!busy;progress.textContent=busy?busyMessage:'';
    list.setAttribute('aria-busy',String(busy));
    input.disabled=busy;
    send.dataset.busy=String(busy);
    send.textContent=busy?busyMessage:buyMore?'Suas imagens acabaram · Ver combos':pending?'Continuar envio':'Enviar imagens';
    send.disabled=busy||!app||(!unfinished.length&&!buyMore);send.formNoValidate=buyMore;
    for(const close of dialog.querySelectorAll('[data-my-images-close]'))close.disabled=busy;
    hint.textContent=!app?'Agende pelo app. Cada foto usa 1 imagem do plano.':remaining===null
      ?'Cada foto usa 1 imagem do seu plano.':`${remaining} ${remaining===1?'imagem disponível':'imagens disponíveis'}.`;
    const saved=rows.length-unfinished.length;
    summary.textContent=saved?`${saved} ${saved===1?'imagem enviada':'imagens enviadas'}${unfinished.length?` · ${unfinished.length} para enviar`:''}.`:'';
    summary.hidden=!saved;
    const ids=new Set(rows.map(row=>row.id));
    for(const [id,node] of nodes)if(!ids.has(id)) {
      if(node.url)URL.revokeObjectURL(node.url);node.article.remove();nodes.delete(id);
    }
    rows.forEach((row,index)=>{
      let node=nodes.get(row.id);
      if(!node){node=rowNode(row);nodes.set(row.id,node);list.append(node.article);}
      node.article.querySelector('strong').textContent=`Imagem ${index+1}`;
      node.article.dataset.status=row.status;
      const immutable=row.status==='saved'||row.status==='pending'&&!row.recoveryEditable;
      node.caption.readOnly=busy||immutable;
      if(document.activeElement!==node.caption)node.caption.value=row.caption;
      node.day.disabled=node.time.disabled=busy||row.status!=='draft';
      node.day.querySelector('span').textContent=dateLabel(row.date);
      node.time.querySelector('span').textContent=row.time||'Escolher hora';
      node.day.setAttribute('aria-label',`Dia da imagem ${index+1}: ${dateLabel(row.date)}`);
      node.time.setAttribute('aria-label',`Hora da imagem ${index+1}: ${row.time||'Escolher hora'}`);
      node.article.querySelector('.my-image-remove').disabled=busy||row.status==='pending';
      const restore=node.article.querySelector('.my-image-restore');
      restore.hidden=!(row.needsFile || row.recoveryEditable);node.replace.disabled=busy;
      node.replace.required=Boolean(row.needsFile&&row.status!=='saved');
      if(row.file && row.file!==node.file) {
        if(node.url)URL.revokeObjectURL(node.url);
        node.file=row.file;node.url=URL.createObjectURL(row.file);node.image.src=node.url;node.image.hidden=false;
      }
      const rowBusy=busy && row.id===activeId;
      node.status.dataset.busy=String(rowBusy);
      node.status.textContent=rowBusy?busyMessage:row.status==='saved'?'✓ Enviada ao Calendário':row.error||
        (row.needsFile?'Selecione novamente a imagem para continuar.':row.status==='pending'?'Confirme o mesmo envio.':'');
    });
  }
  input.addEventListener('change',()=>{
    try{ensureQueue();if(!queue)throw Error('Abra Posts prontos pelo app para agendar suas imagens.');queue.add([...input.files]);showError('');input.value='';}
    catch(failure){showError(failure.message);}finally{render();}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(queue?.isBusy())return;
    const rows=queue?.items()||[],pending=rows.some(row=>row.status==='pending');
    if(!pending && (appCreationAllowed('image')===false || queue?.remaining()===0)){openAppCombos();return;}
    showError('');
    try {
      ensureQueue();if(!queue)throw Error('Abra Posts prontos pelo app para agendar suas imagens.');
      if(!pending && !form.reportValidity())return;
      // Visual state only: queue identities, retries and upload order stay unchanged.
      operation={kind:'send',ids:queue.items().filter(row=>row.status!=='saved')
        .sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')).map(row=>row.id)};
      await queue.sendAll();refreshAppAvailability();
    }catch(failure){showError(failure.message);refreshAppAvailability();}finally{operation=null;render();}
  });
  for(const close of dialog.querySelectorAll('[data-my-images-close]'))close.addEventListener('click',()=>{if(!queue?.isBusy())dialog.close();});
  dialog.addEventListener('cancel',event=>{if(queue?.isBusy())event.preventDefault();});
  dialog.addEventListener('close',onOpenChange);
  document.addEventListener('ia4tube:edit-availability-changed',render);
  return Object.freeze({open(){
    try{ensureQueue();}catch(failure){showError('Não foi possível recuperar a lista. Reabra Posts prontos pelo app.');}
    render();dialog.showModal();onOpenChange();
  }});
}
