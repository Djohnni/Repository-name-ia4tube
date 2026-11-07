import {requestAppCalendar} from './app-calendar.js?v=20261102-placements-v1';
import {createImageSubmission,postReadyImage} from './my-images-submit.js?v=20261107-segment-v1';
import {readReadyImageContext,prepareReadyImage} from './my-images-api.js?v=20261101-my-images-list-v1';

import {createBrandedSubmission,MY_IMAGE_MODE} from './my-images-branded.js?v=20261107-segment-v1';
import {normalizeImageSegment} from './my-images-segment.js?v=20261107-segment-v1';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const TYPES=new Set(['image/png','image/jpeg','image/webp']);
const fail=(message,code,row)=>Object.assign(new Error(message),{code,...(row?{rowId:row.id}:{})});
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&
  Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const validTime=value=>typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);
const fileValid=file=>file&&TYPES.has(file.type)&&Number.isSafeInteger(file.size)&&file.size>0&&
  file.size<=10*1024*1024&&typeof file.arrayBuffer==='function';

// The manifest contains metadata only. Original files must be selected again after reload.
// Each row keeps its own existing one-image admission, never a parallel/bulk debit.
export function createImageQueue({scope,storage,onChange=()=>{},uuid=()=>crypto.randomUUID(),
  requestCalendar=requestAppCalendar,readContext=readReadyImageContext,readImage=prepareReadyImage,
  submitImage=postReadyImage,submitBrandedImage}) {
  if(typeof scope!=='string'||!scope)throw fail('Abra Posts prontos pelo app.','ready_image_app_required');
  const key='ia4tube:my-images-queue:v1:'+scope,legacyKey='ia4tube:my-images:v1:'+scope;
  let rows=[],busy=false,balance=null;
  const snapshot=row=>Object.freeze({id:row.id,file:row.file||null,fileName:row.fileName,caption:row.caption,
    date:row.date,time:row.time,status:row.status,requestId:row.requestId,
    mode:row.mode||'original',needsLogo:row.mode===MY_IMAGE_MODE&&row.status!=='saved'&&!row.logoFile,
    ...(row.segment!==undefined?{segment:row.segment}:{}),
    needsFile:row.status!=='saved'&&!row.file,recoveryEditable:row.status==='pending'&&row.recoveryEditable===true,
    ...(row.receipt?{receipt:Object.freeze({...row.receipt})}:{}),...(row.error?{error:row.error}:{})});
  const items=()=>rows.map(snapshot);
  const notify=()=>{try{onChange(items());}catch{/* A rendering callback cannot undo a confirmed image. */}};
  function persist() {
    const value={schema:1,rows:rows.map(({id,fileName,caption,date,time,status,requestId,receipt,legacy,contextPending,error,mode,segment})=>
      ({id,fileName,caption,date,time,status,requestId,receipt:receipt||null,legacy:legacy===true,
        contextPending:contextPending===true,...(mode===MY_IMAGE_MODE?{mode,...(segment!==undefined?{segment}:{})}:{}),...(error?{error}: {})}))};
    try{storage.setItem(key,JSON.stringify(value));}
    catch{throw fail('Não foi possível preservar sua lista neste aparelho. Não envie outra tentativa.','ready_image_storage_unavailable');}
  }
  function changed(){try{persist();}finally{notify();}}
  function idle(){if(busy)throw fail('Aguarde a confirmação do envio atual.','ready_image_queue_busy');}
  function rowFor(id){const row=rows.find(value=>value.id===id);if(!row)throw fail('Imagem não encontrada na lista.','ready_image_row_missing');return row;}
  function editable(row){idle();if(row.status==='saved'||row.status==='pending'&&!row.recoveryEditable)
    throw fail('Confirme o mesmo envio antes de modificar esta imagem.','ready_image_row_locked',row);}
  function newId(){const id=uuid();if(!UUID.test(id||''))throw fail('Não foi possível identificar esta imagem.','ready_image_identity_invalid');return id;}
  function helper(row) {
    if(!row.helper)row.helper=(row.mode===MY_IMAGE_MODE?createBrandedSubmission:createImageSubmission)({
      ...(row.mode===MY_IMAGE_MODE?{getLogo:()=>row.snapshot?.logo,getSegment:()=>row.snapshot?.segment}:{}),scope:row.legacy?scope:scope+':'+row.id,storage,
      uuid:()=>row.requestId,requestCalendar:async id=>{
        if(id!==row.requestId)throw fail('Confira a tentativa original desta imagem.','ready_image_identity_conflict',row);
        return {ticket:await ticketFor(row)};
      },...(row.mode===MY_IMAGE_MODE?{post:submitBrandedImage}:{post:submitImage})});
    return row.helper;
  }
  async function ticketFor(row) {
    if(row.ticket)return row.ticket;
    if(!UUID.test(row.requestId||''))throw fail('Escolha o dia e a hora desta imagem.','ready_image_schedule_required',row);
    const value=await requestCalendar(row.requestId,{mediaKind:'image'});
    if(typeof value?.ticket!=='string'||!new RegExp('^'+row.requestId.replaceAll('.','\\.')+'\\.[A-Za-z0-9_-]{43}$').test(value.ticket))
      throw fail('Confirme o dia e a hora desta imagem no app.','ready_image_schedule_required',row);
    row.ticket=value.ticket;return row.ticket;
  }
  async function contextFor(row) {
    const value=await readContext(await ticketFor(row));
    if(value?.ok!==true||value.requestId!==row.requestId||!validDate(value.date)||!validTime(value.time)||
      !(value.remainingImages===null||Number.isSafeInteger(value.remainingImages)&&value.remainingImages>=0))
      throw fail('Não foi possível conferir o horário e o saldo. Tente novamente.','ready_image_context_invalid',row);
    row.date=value.date;row.time=value.time;row.contextPending=false;balance=value.remainingImages;changed();
    return value;
  }
  function load() {
    let saved,legacy;
    try{saved=JSON.parse(storage.getItem(key)||'null');legacy=JSON.parse(storage.getItem(legacyKey)||'null');}
    catch{throw fail('Não foi possível recuperar sua lista. Reabra Posts prontos pelo app.','ready_image_storage_invalid');}
    if(saved) {
      if(saved.schema!==1||!Array.isArray(saved.rows))throw fail('Sua lista precisa ser conferida.','ready_image_storage_invalid');
      const ids=new Set();
      rows=saved.rows.map(value=>{
        if(!value||!UUID.test(value.id||'')||ids.has(value.id)||!['draft','pending','saved'].includes(value.status)||
          !(value.mode===undefined||value.mode===MY_IMAGE_MODE)||typeof value.fileName!=='string'||typeof value.caption!=='string'||value.caption.length>2200||
          !(value.segment===undefined||value.mode===MY_IMAGE_MODE&&normalizeImageSegment(value.segment)===value.segment)||
          !(value.requestId===null||UUID.test(value.requestId||''))||
          !(value.date===null||validDate(value.date))||!(value.time===null||validTime(value.time))||
          value.status!=='draft'&&!UUID.test(value.requestId||''))throw fail('Sua lista precisa ser conferida.','ready_image_storage_invalid');
        ids.add(value.id);
        const row={...value,file:null,ticket:null,snapshot:null,recoveryEditable:value.status==='pending'};
        if(helper(row).hasPending()){row.status='pending';row.recoveryEditable=true;}
        return row;
      });
    }
    if(legacy) {
      if(legacy.schema!==1||!UUID.test(legacy.requestId||'')||!HASH.test(legacy.fingerprint||''))
        throw fail('O envio anterior precisa ser conferido.','ready_image_storage_invalid');
      if(!rows.some(row=>row.legacy&&row.requestId===legacy.requestId)) {
        rows.unshift({id:newId(),file:null,fileName:'Imagem do envio anterior',caption:'',date:null,time:null,
          requestId:legacy.requestId,status:'pending',legacy:true,contextPending:true,recoveryEditable:true});
        persist();
      }
    }
  }
  load();
  function markError(row,error) {if(row){row.error=error.message||'Confira esta imagem.';try{changed();}catch{/* Keep the original failure and in-memory row. */}}}
  function validateRow(row) {
    if(!fileValid(row.file))throw fail('Escolha novamente a imagem salva neste aparelho.','ready_image_file_required',row);
    if(row.mode===MY_IMAGE_MODE && (!fileValid(row.logoFile)||row.logoFile.size>5*1024*1024))throw fail('Adicione a logo da empresa para este lote.','ready_image_logo_required',row);
    if(!row.caption.trim()||row.caption.trim().length>2200)throw fail('Escreva a legenda de cada imagem.','ready_image_caption_required',row);
    if(!UUID.test(row.requestId||'')||!validDate(row.date)||!validTime(row.time))
      throw fail('Escolha o dia e a hora de cada imagem.','ready_image_schedule_required',row);
  }
  function checkBalance(drafts) {
    if(balance!==null&&drafts.length>balance)throw fail('Seu saldo permite '+balance+' imagem(ns). Remova as extras ou veja os combos.','billing_required',drafts[0]);
  }
  async function sendRow(row) {
    const wasPending=helper(row).hasPending()||row.status==='pending';
    try {
      if(!row.snapshot)row.snapshot={image:await readImage(row.file),caption:row.caption.trim(),
        ...(row.mode===MY_IMAGE_MODE?{logo:await readImage(row.logoFile),...(row.segment!==undefined?{segment:row.segment}:{})}:{})};
      row.status='pending';row.recoveryEditable=false;delete row.error;changed();
      const result=await helper(row).send(row.snapshot);
      row.status='saved';row.receipt={requestId:result.requestId,planningId:result.planningId,pedidoId:result.pedidoId,status:result.status};
      row.snapshot=null;row.recoveryEditable=false;delete row.error;
      if(!wasPending&&balance!==null)balance=Math.max(0,balance-1);
      changed();
    } catch(error) {
      if(row.status!=='saved') {
        const pending=helper(row).hasPending();row.status=pending?'pending':'draft';
        row.recoveryEditable=pending&&error.code==='ready_image_pending_mismatch';
        if(!pending||row.recoveryEditable)row.snapshot=null;
      }
      markError(row,error);throw Object.assign(error,{rowId:row.id});
    }
    // The original-image context intentionally rejects tickets admitted by the
    // Edit producer. Its durable admission receipt is the confirmation here.
    // Each following draft reads its own unused context before reserving quota.
    if(row.mode!==MY_IMAGE_MODE)await contextFor(row);
    else if(wasPending)balance=null;
  }
  return Object.freeze({items,isBusy:()=>busy,remaining:()=>balance,
    setSharedSegment(value) {
      idle();const segment=normalizeImageSegment(value);
      if(segment===undefined)throw fail('Escolha o segmento do negócio.','ready_image_segment_invalid');
      for(const row of rows)if(row.mode===MY_IMAGE_MODE&&row.status==='draft'){row.segment=segment;row.snapshot=null;}
      changed();
    },
    setSharedLogo(file) {
      idle();if(!fileValid(file)||file.size>5*1024*1024)throw fail('Escolha uma logo PNG, JPG ou WebP de até 5 MB.','ready_image_logo_invalid');
      for(const row of rows)if(row.mode===MY_IMAGE_MODE && (row.status==='draft'||row.status==='pending'&&(!row.logoFile||row.recoveryEditable))){row.logoFile=file;row.snapshot=null;}
      changed();
    },
    add(files,{mode='original',logo=null,segment}={}) {
      if(!['original',MY_IMAGE_MODE].includes(mode))throw fail('Escolha como enviar as imagens.','ready_image_mode_invalid');
      idle();segment=mode===MY_IMAGE_MODE?normalizeImageSegment(segment):undefined;const selected=Array.from(files||[]);
      if(selected.some(file=>!fileValid(file)))throw fail('Escolha imagens PNG, JPG ou WebP de até 10 MB.','ready_image_file_invalid');
      if(balance!==null&&rows.filter(row=>row.status==='draft').length+selected.length>balance)
        throw fail('Seu saldo permite '+balance+' imagem(ns). Remova as extras ou veja os combos.','billing_required');
      const added=selected.map(file=>({id:newId(),file,fileName:String(file.name||'Imagem'),caption:'',date:null,time:null,
        requestId:null,status:'draft',legacy:false,contextPending:false,recoveryEditable:false,
        ...(mode===MY_IMAGE_MODE?{mode,logoFile:logo,...(segment!==undefined?{segment}:{})}:{})}));
      const ids=new Set(rows.map(row=>row.id));for(const row of added){if(ids.has(row.id))throw fail('Imagem repetida na lista.','ready_image_identity_conflict');ids.add(row.id);}
      rows.push(...added);changed();return added.map(snapshot);
    },
    replaceFile(id,file) {
      const row=rowFor(id);editable(row);if(!fileValid(file))throw fail('Escolha uma imagem PNG, JPG ou WebP de até 10 MB.','ready_image_file_invalid',row);
      row.file=file;if(row.status==='draft')row.fileName=String(file.name||'Imagem');row.snapshot=null;delete row.error;changed();return snapshot(row);
    },
    setCaption(id,text) {
      const row=rowFor(id);editable(row);if(typeof text!=='string'||text.length>2200)throw fail('Use até 2.200 caracteres na legenda.','ready_image_caption_invalid',row);
      row.caption=text;row.snapshot=null;delete row.error;changed();return snapshot(row);
    },
    remove(id) {
      const row=rowFor(id);idle();if(row.status==='pending')throw fail('Confirme o envio pendente antes de remover esta imagem.','ready_image_row_locked',row);
      rows=rows.filter(value=>value!==row);changed();return items();
    },
    async schedule(id) {
      idle();const row=rowFor(id);if(row.status!=='draft')throw fail('O horário deste envio já está preservado.','ready_image_row_locked',row);
      busy=true;notify();
      try {
        if(!row.contextPending) {
          const requestId=newId(),calendar=await requestCalendar(requestId,{mediaKind:'image'});
          if(typeof calendar?.ticket!=='string'||!calendar.ticket.startsWith(requestId+'.'))throw fail('Escolha o dia e a hora no app.','ready_image_schedule_required',row);
          row.requestId=requestId;row.ticket=calendar.ticket;row.date=row.time=null;row.contextPending=true;row.helper=null;changed();
        }
        await contextFor(row);delete row.error;changed();return snapshot(row);
      }catch(error){markError(row,error);throw error;}finally{busy=false;notify();}
    },
    async sendAll() {
      idle();busy=true;notify();let active=null;
      try {
        const unsent=rows.filter(row=>row.status!=='saved');if(!unsent.length)return items();
        // A lost response may already have spent its unit. Reconcile it before
        // asking the user to reselect unrelated draft files lost on reload.
        for(const row of unsent.filter(value=>value.status==='pending')) {
          active=row;
          if(!row.date||!row.time)await contextFor(row);
          validateRow(row);if(row.mode!==MY_IMAGE_MODE)await contextFor(row);await sendRow(row);
        }
        const drafts=rows.filter(row=>row.status==='draft');
        // New allocations start only after every remaining draft is complete.
        for(const row of drafts){active=row;validateRow(row);}
        if(drafts.length){active=drafts[0];await contextFor(active);checkBalance(drafts);}
        for(let index=0;index<drafts.length;index++) {
          active=drafts[index];if(index>0)await contextFor(active);checkBalance(drafts.slice(index));await sendRow(active);
        }
        return items();
      }catch(error){markError(active,error);throw error;}finally{busy=false;notify();}
    },
  });
}
