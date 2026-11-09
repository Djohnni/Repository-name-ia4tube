export const READY_IMAGE_ENDPOINT='https://ia4tube-api.onrender.com/empresa/edit/ready-images';
export const IMAGE_CAPTION_ENDPOINT=READY_IMAGE_ENDPOINT+'/caption';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const TYPES=new Set(['image/png','image/jpeg','image/webp']);
const MAX_BYTES=10*1024*1024;
const hex=value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');

export async function imageSubmissionFingerprint(image,caption,captionMode='manual') {
  const fileHash=hex(await crypto.subtle.digest('SHA-256',await image.arrayBuffer()));
  return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({fileHash,caption,
    ...(captionMode==='ia4tube'?{captionMode}:{})}))));
}

// The native ticket carries the account and chosen date/time. Never accept them from the form.
// Only pending identifiers/digests are kept in session storage; images and captions stay in memory.
export function createImageSubmission({scope,storage,requestCalendar,post=postReadyImage,
  fingerprint=imageSubmissionFingerprint,uuid=()=>crypto.randomUUID(),successStatus='ready'}) {
  const key='ia4tube:my-images:v1:'+scope;
  let busy=false;
  function pending() {
    if(!scope)throw new Error('Abra Posts prontos pelo app para agendar sua imagem.');
    let value;
    try {value=JSON.parse(storage.getItem(key)||'null');}
    catch {throw new Error('Não foi possível recuperar seu envio. Reabra Posts prontos pelo app.');}
    if(value && (value.schema!==1 || !UUID.test(value.requestId||'') || !HASH.test(value.fingerprint||'')))
      throw new Error('Seu envio precisa ser conferido. Reabra Posts prontos pelo app.');
    return value;
  }
  return Object.freeze({
    hasPending:()=>Boolean(pending()),
    async send({image,caption,captionMode='manual'}) {
      if(busy)throw new Error('Aguarde a confirmação deste envio.');
      const text=String(caption||'').trim();
      if(!image || !TYPES.has(image.type) || !image.size || image.size>MAX_BYTES)
        throw new Error('Escolha uma imagem PNG, JPG ou WebP de até 10 MB.');
      if(!['manual','ia4tube'].includes(captionMode))throw new Error('Escolha como criar a legenda.');
      if((captionMode==='manual'&&!text) || text.length>2200)throw new Error('Escreva a legenda da publicação, com até 2.200 caracteres.');
      busy=true;
      try {
        let attempt=pending();
        const digest=await fingerprint(image,text,captionMode);
        if(attempt && attempt.fingerprint!==digest)
          throw Object.assign(new Error('Há um envio para confirmar. Selecione a mesma imagem e use a mesma legenda para tentar novamente.'),
            {code:'ready_image_pending_mismatch'});
        const requestId=attempt?.requestId||uuid();
        if(!UUID.test(requestId))throw new Error('Não foi possível identificar o envio.');
        const calendar=await requestCalendar(requestId);
        if(!calendar?.ticket || !calendar.ticket.startsWith(requestId+'.'))
          throw new Error('Confirme o dia e a hora pelo app antes de enviar.');
        attempt={schema:1,requestId,fingerprint:digest};
        // A failed write stops BEFORE the POST. An uncertain POST always retains the same attempt.
        storage.setItem(key,JSON.stringify(attempt));
        let result;
        try {result=await post({image,caption:text,requestId,ticket:calendar.ticket,...(captionMode==='ia4tube'?{captionMode}:{})});}
        catch(error) {
          if(error.safeToEdit===true)storage.removeItem(key);
          throw error;
        }
        if(result?.ok!==true || result.requestId!==requestId || result.status!==successStatus ||
          typeof result.planningId!=='string' || typeof result.pedidoId!=='string')
          throw new Error('A confirmação ainda não chegou. Tente novamente com a mesma imagem e legenda.');
        storage.removeItem(key);
        return result;
      } finally {busy=false;}
    },
  });
}

export async function postImageCaption({image,caption='',requestId,ticket},fetchImpl=fetch) {
  const body=new FormData();body.set('ticket',ticket);body.set('requestId',requestId);body.set('guidance',caption);
  body.set('image',image,'imagem.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.type]||'png'));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),100000);
  try {
    const response=await fetchImpl(IMAGE_CAPTION_ENDPOINT,{method:'POST',headers:{Authorization:'EditTicket '+ticket},
      body,signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',redirect:'error'});
    const result=await response.json();
    if(!response.ok||result.ok!==true||result.requestId!==requestId||typeof result.caption!=='string'||!result.caption.trim()||result.caption.length>2200)
      throw Object.assign(new Error(result.error||'Não foi possível confirmar a legenda. Tente o mesmo envio.'),{code:result.code,safeToEdit:result.safeToEdit===true});
    return result.caption;
  } catch(error) {
    if(error.name==='AbortError'||error instanceof TypeError)throw new Error('A legenda ainda não foi confirmada. Tente o mesmo envio.');
    throw error;
  } finally {clearTimeout(timer);}
}

export async function postReadyImage({image,caption,requestId,ticket,captionMode='manual'}) {
  if(captionMode==='ia4tube')caption=await postImageCaption({image,caption,requestId,ticket});
  const body=new FormData();
  body.set('ticket',ticket);body.set('requestId',requestId);body.set('caption',caption);
  body.set('image',image,'imagem.'+({'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[image.type]||'png'));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),180000);
  try {
    const response=await fetch(READY_IMAGE_ENDPOINT,{method:'POST',headers:{Authorization:'EditTicket '+ticket},
      body,signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    let result;
    try {result=await response.json();}catch {throw new Error('A confirmação ainda não chegou. Tente novamente com a mesma imagem e legenda.');}
    if(!response.ok || result.ok!==true) {
      const error=new Error(result.error||'Não foi possível confirmar o envio. Tente novamente com a mesma imagem e legenda.');
      error.code=result.code;
      error.safeToEdit=result.safeToEdit===true;
      throw error;
    }
    return result;
  } catch(error) {
    if(error.name==='AbortError' || error instanceof TypeError)
      throw new Error('A conexão não confirmou o envio. Tente novamente: a mesma tentativa não desconta duas vezes.');
    throw error;
  } finally {clearTimeout(timer);}
}
