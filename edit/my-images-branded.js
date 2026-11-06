import {createImageSubmission,imageSubmissionFingerprint} from './my-images-submit.js?v=20261106-brand-mode-v1';
import {SUBMIT_ENDPOINT,idempotencyKey,calendarContextHash,normalizeReceipt} from './order-adapter.js?v=20261029-extra40';
export const MY_IMAGE_MODEL='73f8a30b-6cb5-4f82-9e11-6e325941f590';
export const MY_IMAGE_MODE='ia4tube';

export function createBrandedSubmission({scope,storage,uuid,requestCalendar,getLogo,post=postBrandedImage}) {
  return createImageSubmission({scope,storage,uuid,requestCalendar,successStatus:'queued',
    fingerprint:async(image,caption)=>{
      const logo=getLogo();
      if(!logo)throw new Error('Adicione a logo da empresa para usar o Modo iA4tube.');
      const logoHash=await imageSubmissionFingerprint(logo,'');
      return imageSubmissionFingerprint(image,JSON.stringify({mode:MY_IMAGE_MODE,caption,logoHash}));
    },post:input=>post({...input,logo:getLogo()})});
}

export async function postBrandedImage({image,logo,caption,requestId,ticket}) {
  if(!logo || !['image/png','image/jpeg','image/webp'].includes(logo.type) || !logo.size || logo.size>5*1024*1024)
    throw new Error('Adicione a logo da empresa.');
  const data={schemaVersion:2,campaignId:'sextou-classico-v1',company:'',whatsapp:null,
    selections:[{id:'93',format:'image'}],mediaKind:'image',imageCaption:caption,
    sextou:{businessType:'auto',date:null,copyId:'trabalho-sabor',durationSeconds:10},
    showcase:{videoId:MY_IMAGE_MODEL,videoVersion:1},appCalendar:{ticket}};
  const body=new FormData();body.set('data',JSON.stringify(data));
  const ext=mime=>({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[mime]);
  body.set('logo',logo,'logo.'+ext(logo.type));body.set('photos',image,'imagem.'+ext(image.type));
  const key=await idempotencyKey(requestId),contextHash=await calendarContextHash(ticket);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
  try {
    const response=await fetch(SUBMIT_ENDPOINT,{method:'POST',headers:{'Idempotency-Key':key},body,
      signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'});
    const result=await response.json();
    if(!response.ok){const e=new Error(result.error||'Não foi possível confirmar o pedido. Tente o mesmo envio.');e.code=result.code;throw e;}
    const confirmed=normalizeReceipt(result,{mediaKind:'image',durationSeconds:10,company:'',appCalendar:{ticket}},
      {requireAdmission:true,contextHash});
    return {ok:true,requestId,planningId:confirmed.admission.planningId,pedidoId:confirmed.admission.pedidoId,status:'queued'};
  } catch(error) {
    if(error.name==='AbortError'||error instanceof TypeError)
      throw new Error('O envio ainda não foi confirmado. Tente novamente com a mesma imagem e logo.');
    throw error;
  } finally{clearTimeout(timer);}
}
