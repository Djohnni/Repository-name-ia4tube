import {prepareUpload} from './upload-field.js?v=20261101-my-images-list-v1';
const ENDPOINT='https://ia4tube-api.onrender.com/empresa/edit/ready-images/context';
const TICKET=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.[A-Za-z0-9_-]{43}$/;

// Reuse the existing file reader. Decode only the image being sent.
export async function prepareReadyImage(file) {
  const value=await prepareUpload(file,10*1024*1024,'Imagem',new AbortController().signal);
  return new Blob([Uint8Array.from(atob(value.data),char=>char.charCodeAt(0))],{type:value.mime});
}
export async function readReadyImageContext(ticket) {
  if(!TICKET.test(ticket||''))throw new Error('Confirme o dia e a hora pelo app.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(ENDPOINT,{headers:{Authorization:'EditTicket '+ticket},
      signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
    const value=await response.json();
    if(!response.ok || value.ok!==true) {
      const error=new Error(value.error||'Não foi possível conferir a programação. Tente novamente.');
      error.code=value.code;throw error;
    }
    if(value.requestId!==ticket.slice(0,36) || !/^\d{4}-\d{2}-\d{2}$/.test(value.date||'') ||
      !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value.time||'') ||
      !(value.remainingImages===null || Number.isSafeInteger(value.remainingImages)&&value.remainingImages>=0))
      throw new Error('A programação ainda não foi confirmada. Tente novamente.');
    return value;
  } catch(error) {
    if(error.name==='AbortError' || error instanceof TypeError)
      throw new Error('A conexão não confirmou o horário. Tente novamente; sua lista continua aqui.');
    throw error;
  } finally {clearTimeout(timer);}
}
