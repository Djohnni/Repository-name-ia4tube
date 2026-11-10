import {appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos} from './app-calendar.js?v=20261102-placements-v1';
import {createImageQueue} from './my-images-queue.js?v=20261109-my-images-video-v1';
import {SEGMENTS,normalizeImageSegment,createSegmentMemory} from './my-images-segment.js?v=20261107-segment-v1';

export function createMyImages({dialog,onOpenChange=()=>{},onSent=()=>{}}) {
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
  let queue=null,operation=null,batchLogo=null,segmentLoading=false,segmentTouched=false;const nodes=new Map();
  const modes=[...form.querySelectorAll('[name="my-images-mode"]')];
  const logoInput=form.querySelector('[data-my-images-logo]'),logoField=form.querySelector('[data-my-images-logo-field]');
  let segmentField=form.querySelector('[data-my-images-segment-field]');
  let segmentOtherField=form.querySelector('[data-my-images-segment-other-field]');
  if(!segmentField||!segmentOtherField){
    const holder=document.createElement('div');
    holder.innerHTML='<label class="order-field my-images-segment" data-my-images-segment-field hidden>Segmento do negócio<select data-my-images-segment aria-label="Segmento do negócio"></select></label><label class="order-field my-images-segment" data-my-images-segment-other-field hidden>Qual segmento?<input data-my-images-segment-other type="text" maxlength="80" placeholder="Ex.: Loja de móveis" autocomplete="off"></label>';
    while(holder.firstChild)form.insertBefore(holder.firstChild,logoField||input.parentElement);
    segmentField=form.querySelector('[data-my-images-segment-field]');segmentOtherField=form.querySelector('[data-my-images-segment-other-field]');
  }
  const segmentInput=segmentField.querySelector('select'),segmentOther=segmentOtherField.querySelector('input');
  for(const [value,label] of [['auto','Identificar pela foto'],...SEGMENTS.map(value=>[value,value]),['other','Outro segmento']]){
    const option=document.createElement('option');option.value=value;option.textContent=label;segmentInput.append(option);
  }
  const segmentMemory=createSegmentMemory({storage:{getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)}});
  const chosenSegment=()=>normalizeImageSegment(segmentInput.value==='other'?segmentOther.value:segmentInput.value);
  function showSegment(value){
    segmentInput.value=value==='auto'||SEGMENTS.includes(value)?value:'other';
    segmentOther.value=segmentInput.value==='other'?value:'';
  }
  const selectedMode=()=>modes.find(input=>input.checked)?.value||'original';
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
      <label class="order-field" data-image-format-field hidden>Receber como<select data-image-format><option value="image">Imagem</option><option value="video">Vídeo com movimento suave · 10 segundos</option></select><small data-image-format-hint hidden>Usa 1 vídeo do plano.</small></label>
      <label class="order-field" data-image-text-field hidden>Preço ou informação na imagem<input type="text" data-image-text maxlength="300" placeholder="Ex.: R$ 39,90 · Combo para 2 pessoas" autocomplete="off"></label>
      <label class="order-field"><span data-caption-label>Legenda</span><textarea rows="3" maxlength="2200" placeholder="Escreva a legenda da publicação" required></textarea></label>
      <label class="my-image-caption-option"><input type="checkbox" data-caption-ai>Legenda iA4tube</label>
      <div class="my-image-schedule"><label>Dia<button type="button" class="my-image-day"><span></span><b aria-hidden="true">✎</b></button></label>
      <label>Hora<button type="button" class="my-image-time"><span></span><b aria-hidden="true">✎</b></button></label></div>
      <p class="my-image-status" role="status"></p>`;
    const caption=article.querySelector('textarea'),replace=article.querySelector('input[type=file]');
    const captionAI=article.querySelector('[data-caption-ai]'),captionLabel=article.querySelector('[data-caption-label]');
    const format=article.querySelector('[data-image-format]'),formatField=article.querySelector('[data-image-format-field]'),formatHint=article.querySelector('[data-image-format-hint]');
    format.addEventListener('change',()=>{try{queue.setOutputKind(row.id,format.value);showError('');}catch(failure){showError(failure.message);render();}});
    const imageText=article.querySelector('[data-image-text]'),imageTextField=article.querySelector('[data-image-text-field]');
    const day=article.querySelector('.my-image-day'),time=article.querySelector('.my-image-time');
    caption.addEventListener('input',()=>{try{queue.setCaption(row.id,caption.value);showError('');}catch(failure){showError(failure.message);}});
    imageText.addEventListener('input',()=>{try{queue.setImageText(row.id,imageText.value);showError('');}catch(failure){showError(failure.message);}});
    captionAI.addEventListener('change',()=>{try{queue.setCaptionMode(row.id,captionAI.checked?'ia4tube':'manual');showError('');}catch(failure){showError(failure.message);render();}});
    article.querySelector('.my-image-remove').addEventListener('click',()=>{try{queue.remove(row.id);showError('');}catch(failure){showError(failure.message);}});
    replace.addEventListener('change',()=>{try{if(replace.files?.[0])queue.replaceFile(row.id,replace.files[0]);showError('');}catch(failure){showError(failure.message);}});
    const schedule=async()=>{
      if(queue?.isBusy())return;
      operation={kind:'schedule',ids:[row.id]};
      showError('');try{await queue.schedule(row.id);}catch(failure){showError(failure.message);}finally{operation=null;render();}
    };
    day.addEventListener('click',schedule);time.addEventListener('click',schedule);
    return {article,caption,captionAI,captionLabel,format,formatField,formatHint,imageText,imageTextField,replace,day,time,image:article.querySelector('img'),status:article.querySelector('[role=status]'),file:null,url:null};
  }
  function render() {
    const rows=queue?.items()||[],busy=(queue?.isBusy()||false)||segmentLoading,app=Boolean(appCalendarAttemptScope());
    const pending=rows.some(row=>row.status==='pending'),unfinished=rows.filter(row=>row.status!=='saved');
    const remaining=queue?.remaining()??null;
    const kinds=[...new Set(unfinished.map(row=>row.outputKind||'image'))];
    const blocked=kinds.find(kind=>appCreationAllowed(kind)===false||queue?.remaining(kind)===0);
    const buyMore=!pending && (blocked!==undefined||!unfinished.length&&(appCreationAllowed('image')===false||remaining===0));
    const hasVideo=rows.some(row=>row.outputKind==='video');
    const activeId=operation?.ids.find(id=>rows.some(row=>row.id===id && row.status!=='saved'));
    const position=operation?.ids.indexOf(activeId)??-1;
    const busyMessage=operation?.kind==='schedule'?'Confirmando horário…':operation?.kind==='send'
      ?position<0?'Confirmando envio…':`Enviando imagem ${position+1} de ${operation.ids.length}…`:'Aguarde…';
    progress.hidden=!busy;progress.textContent=busy?busyMessage:'';
    list.setAttribute('aria-busy',String(busy));
    input.disabled=busy;
    for(const mode of modes)mode.disabled=busy;
    if(logoInput)logoInput.disabled=busy;
    segmentField.hidden=selectedMode()!=='ia4tube';segmentInput.disabled=busy;
    segmentOtherField.hidden=selectedMode()!=='ia4tube'||segmentInput.value!=='other';
    segmentOther.disabled=busy||segmentOtherField.hidden;
    if(logoField)logoField.hidden=selectedMode()!=='ia4tube'&&!rows.some(row=>row.needsLogo);
    send.dataset.busy=String(busy);
    send.textContent=busy?busyMessage:buyMore?(blocked==='video'?'Seus vídeos acabaram · Ver combos':'Suas imagens acabaram · Ver combos'):pending?'Continuar envio':hasVideo?'Enviar publicações':'Enviar imagens';
    send.disabled=busy||!app||(!unfinished.length&&!buyMore);send.formNoValidate=buyMore;
    for(const close of dialog.querySelectorAll('[data-my-images-close]'))close.disabled=busy;
    hint.textContent=hasVideo?'Cada vídeo usa 1 vídeo do plano; cada imagem usa 1 imagem.':!app?'Agende pelo app. Cada foto usa 1 imagem do plano.':remaining===null
      ?'Cada foto usa 1 imagem do seu plano.':`${remaining} ${remaining===1?'imagem disponível':'imagens disponíveis'}.`;
    const saved=rows.length-unfinished.length;
    summary.textContent=saved?`${saved} ${hasVideo?(saved===1?'publicação enviada':'publicações enviadas'):(saved===1?'imagem enviada':'imagens enviadas')}${unfinished.length?` · ${unfinished.length} para enviar`:''}.`:'';
    summary.hidden=!saved;
    const ids=new Set(rows.map(row=>row.id));
    for(const [id,node] of nodes)if(!ids.has(id)) {
      if(node.url)URL.revokeObjectURL(node.url);node.article.remove();nodes.delete(id);
    }
    rows.forEach((row,index)=>{
      let node=nodes.get(row.id);
      if(!node){node=rowNode(row);nodes.set(row.id,node);list.append(node.article);}
      node.article.querySelector('strong').textContent=`Imagem ${index+1}${row.mode==='ia4tube'?' · Modo iA4tube':''}`;
      node.article.dataset.status=row.status;
      const immutable=row.status==='saved'||row.status==='pending'&&!row.recoveryEditable;
      node.formatField.hidden=row.mode!=='ia4tube';node.format.disabled=busy||row.status!=='draft';node.format.value=row.outputKind||'image';node.formatHint.hidden=row.outputKind!=='video';
      node.imageTextField.hidden=row.mode!=='ia4tube';node.imageText.readOnly=busy||immutable;
      if(document.activeElement!==node.imageText)node.imageText.value=row.imageText||'';
      node.caption.readOnly=busy||immutable;
      const aiCaption=row.captionMode==='ia4tube';
      node.captionAI.checked=aiCaption;node.captionAI.disabled=busy||immutable;
      node.captionLabel.textContent=aiCaption?'Oriente a legenda':'Legenda';
      node.caption.placeholder=aiCaption?'Ex.: destaque o combo e use #minhamarca':'Escreva a legenda da publicação';
      node.caption.required=!aiCaption;
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
      node.status.textContent=rowBusy?busyMessage:row.status==='saved'?(row.mode==='ia4tube'?'✓ Enviada à produção':'✓ Enviada ao Calendário'):row.error||
        (row.needsLogo?'Adicione novamente a mesma logo para continuar.':row.needsFile?'Selecione novamente a imagem para continuar.':row.status==='pending'?'Confirme o mesmo envio.':'');
    });
  }
  for(const mode of modes)mode.addEventListener('change',render);
  const changeSegment=()=>{
    segmentTouched=true;
    try{const value=chosenSegment();queue?.setSharedSegment(value);if(batchLogo)void segmentMemory.save(batchLogo,value);showError('');}
    catch(failure){if(segmentInput.value!=='other'||segmentOther.value.trim())showError(failure.message);}finally{render();}
  };
  segmentInput.addEventListener('change',changeSegment);segmentOther.addEventListener('input',changeSegment);
  logoInput?.addEventListener('change',async()=>{
    try{
      ensureQueue();const logo=logoInput.files?.[0];if(!logo)return;
      const keepChoice=!batchLogo&&segmentTouched;
      queue.setSharedLogo(logo);batchLogo=logo;segmentLoading=true;render();
      if(!keepChoice)showSegment(await segmentMemory.load(logo)||'auto');
      const value=chosenSegment();queue.setSharedSegment(value);await segmentMemory.save(logo,value);
      segmentTouched=false;showError('');
    }catch(failure){showError(failure.message);}finally{segmentLoading=false;render();}
  });
  input.addEventListener('change',()=>{
    try{ensureQueue();if(!queue)throw Error('Abra Posts prontos pelo app para agendar suas imagens.');queue.add([...input.files],{mode:selectedMode(),logo:batchLogo,...(selectedMode()==='ia4tube'?{segment:chosenSegment()}:{})});showError('');input.value='';}
    catch(failure){showError(failure.message);}finally{render();}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(segmentLoading||queue?.isBusy())return;
    const rows=queue?.items()||[],pending=rows.some(row=>row.status==='pending');
    const kinds=[...new Set(rows.filter(row=>row.status!=='saved').map(row=>row.outputKind||'image'))];
    if(!pending && (kinds.length?kinds.some(kind=>appCreationAllowed(kind)===false||queue?.remaining(kind)===0):(appCreationAllowed('image')===false||queue?.remaining()===0))){openAppCombos();return;}
    showError('');
    try {
      ensureQueue();if(!queue)throw Error('Abra Posts prontos pelo app para agendar suas imagens.');
      if(!pending && !form.reportValidity())return;
      // Visual state only: queue identities, retries and upload order stay unchanged.
      operation={kind:'send',ids:queue.items().filter(row=>row.status!=='saved')
        .sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')).map(row=>row.id)};
      await queue.sendAll();refreshAppAvailability();
      const sent=queue.items().filter(row=>operation.ids.includes(row.id));
      if(operation.ids.length&&sent.length===operation.ids.length&&sent.every(row=>row.status==='saved')) {
        dialog.close();
        try{onSent({count:sent.length,...(sent.some(row=>row.outputKind==='video')?{videoCount:sent.filter(row=>row.outputKind==='video').length,imageCount:sent.filter(row=>row.outputKind!=='video').length}:{})});}catch{/* A visual acknowledgement cannot undo confirmed images. */}
      }
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
