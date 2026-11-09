import {createImageSubmission,imageSubmissionFingerprint,postImageCaption} from './my-images-submit.js?v=20261109-ai-caption-v1';
import {normalizeImageSegment} from './my-images-segment.js?v=20261107-segment-v1';
import {SUBMIT_ENDPOINT,idempotencyKey,calendarContextHash,normalizeReceipt} from './order-adapter.js?v=20261029-extra40';
export const MY_IMAGE_MODEL='73f8a30b-6cb5-4f82-9e11-6e325941f590';
export const MY_IMAGE_MODE='ia4tube';

export function normalizeImageText(value) {
  if(value===undefined)return undefined;
  if(typeof value!=='string')throw new Error('Use até 300 caracteres no preço ou informação da imagem.');
  const text=value.trim().normalize('NFC');
  if(text.length>300||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ud800-\udfff]/u.test(text))
    throw new Error('Use até 300 caracteres no preço ou informação da imagem.');
  return text||undefined;
}

export function createBrandedSubmission({scope,storage,uuid,requestCalendar,getLogo,getSegment=()=>undefined,getImageText=()=>undefined,post=postBrandedImage}) {
  return createImageSubmission({scope,storage,uuid,requestCalendar,successStatus:'queued',
    fingerprint:async(image,caption,captionMode)=>{
      const logo=getLogo();
      if(!logo)throw new Error('Adicione a logo da empresa para usar o Modo iA4tube.');
      const logoHash=await imageSubmissionFingerprint(logo,'');
      const segment=normalizeImageSegment(getSegment());
      const imageText=normalizeImageText(getImageText());
      return imageSubmissionFingerprint(image,JSON.stringify({mode:MY_IMAGE_MODE,caption,logoHash,
        ...(segment!==undefined?{imageSegment:segment}:{}),...(imageText!==undefined?{imageText}:{})}),captionMode);
    },post:input=>post({...input,logo:getLogo(),...(getSegment()!==undefined?{imageSegment:normalizeImageSegment(getSegment())}:{}),
      ...(normalizeImageText(getImageText())!==undefined?{imageText:normalizeImageText(getImageText())}:{})})});
}

export async function postBrandedImage({image,logo,caption,requestId,ticket,imageSegment,imageText,captionMode='manual'}) {
  if(!logo || !['image/png','image/jpeg','image/webp'].includes(logo.type) || !logo.size || logo.size>5*1024*1024)
    throw new Error('Adicione a logo da empresa.');
  imageText=normalizeImageText(imageText);
  if(captionMode==='ia4tube')caption=await postImageCaption({image,caption,requestId,ticket});
  const data={schemaVersion:2,campaignId:'sextou-classico-v1',company:'',whatsapp:null,
    selections:[{id:'93',format:'image'}],mediaKind:'image',imageCaption:caption,
    ...(imageSegment!==undefined?{imageSegment:normalizeImageSegment(imageSegment)}:{}),
    ...(imageText!==undefined?{imageText}:{}),
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
