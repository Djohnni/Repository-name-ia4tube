export const SUBMIT_ENDPOINT = 'https://marcagrande-pedidos-wshgj6ugza-uc.a.run.app/orders';
import { normalizeProductPrice } from './optional-price.js?v=20261019-price';
import { normalizeProductDescription } from './product-description.js?v=20261022-no-photo';
import { normalizeCustomPhrase } from './custom-phrase.js?v=20261022-phrase';
const UUID_V4 = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const ORDER_ID = /^[A-Za-z0-9_-]{1,100}$/;
const IMAGE_TYPES = new Set(['image/png','image/jpeg','image/webp']);
const WHATSAPP_RECIPIENT = '554791049079';

function uploadBlob(upload,maxBytes,label) {
  if (!upload || !IMAGE_TYPES.has(upload.mime) || typeof upload.name !== 'string' ||
      !upload.name || upload.name.length > 150 || /[\x00-\x1f\x7f/\\]/.test(upload.name) ||
      typeof upload.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(upload.data)) {
    throw new Error(label + ': selecione novamente a imagem PNG, JPG ou WebP.');
  }
  if (!upload.data || upload.data.length > Math.ceil(maxBytes / 3) * 4) throw new Error(label + ': o arquivo excede o limite permitido.');
  const decoded = atob(upload.data);
  if (!decoded.length || decoded.length > maxBytes) throw new Error(label + ': o arquivo excede o limite permitido.');
  const bytes = Uint8Array.from(decoded,character => character.charCodeAt(0));
  return new Blob([bytes],{type:upload.mime});
}

export function buildMultipartOrder(payload) {
  const company = typeof payload?.company === 'string' ? payload.company.trim() : '';
  const products = payload?.productsVideo;
  if ((products && company.length < 2) || (company && company.length < 2) || company.length > 100) throw new Error('Preencha o nome da empresa com 2 a 100 caracteres.');
  if (!UUID_V4.test(payload.videoId || '') || !Number.isSafeInteger(payload.videoVersion) || payload.videoVersion < 1) throw new Error('Escolha novamente um modelo disponível.');
  const productPrice = normalizeProductPrice(payload.productPrice);
  const productDescription = normalizeProductDescription(payload.productDescription);
  const customPhrase = normalizeCustomPhrase(payload.customPhrase);
  if (products && productPrice) throw new Error('Informe o preço dentro de cada produto do pacote.');
  if (products && productDescription) throw new Error('A descrição sem foto está disponível somente para modelos individuais.');
  if (products && customPhrase) throw new Error('A frase principal personalizada está disponível somente para modelos individuais.');
  if (!products && ![10,20].includes(payload.durationSeconds)) throw new Error('Escolha 10 ou 20 segundos.');
  if (payload.consent !== true) throw new Error('Confirme a autorização para usar as imagens.');
  const form = new FormData();
  let appCalendar;
  if (payload.appCalendar !== undefined) {
    if (!payload.appCalendar || Object.keys(payload.appCalendar).join(',') !== 'ticket' ||
        typeof payload.appCalendar.ticket !== 'string' || !/^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/.test(payload.appCalendar.ticket)) {
      throw new Error('Confira a data e o horário no calendário do app.');
    }
    appCalendar = {ticket:payload.appCalendar.ticket};
  }
  if (products) {
    if (![2,4,6,8].includes(products.packageCount) || !Array.isArray(products.items) || products.items.length !== products.packageCount || !Array.isArray(payload.photos) || payload.photos.length !== products.packageCount) throw new Error('Confira a quantidade de produtos do pacote escolhido.');
    form.append('data',JSON.stringify({schemaVersion:2,campaignId:'produtos-cardapio-v1',company,whatsapp:null,
      selections:[{id:'93',format:'video'}],productsVideo:products,showcase:{videoId:payload.videoId,videoVersion:payload.videoVersion},...(appCalendar ? {appCalendar} : {})}));
    form.append('logo',uploadBlob(payload.logo,5 * 1024 * 1024,'Logo'),payload.logo.name);
    let total = 0;
    payload.photos.forEach((photo,index) => {
      const blob = uploadBlob(photo,10 * 1024 * 1024,`Foto do produto ${index + 1}`);total += blob.size;
      form.append('photos',blob,photo.name);
    });
    if (total > 24 * 1024 * 1024) throw new Error('As fotos dos produtos juntas devem ter até 24 MB.');
    return form;
  }
  form.append('data',JSON.stringify({
    schemaVersion:2,
    campaignId:'sextou-classico-v1',
    company,
    whatsapp:null,
    selections:[{id:'93',format:'video'}],
    sextou:{businessType:'auto',date:null,copyId:'trabalho-sabor',durationSeconds:payload.durationSeconds},
    showcase:{videoId:payload.videoId,videoVersion:payload.videoVersion},
    ...(appCalendar ? {appCalendar} : {}),
    ...(productPrice ? {productPrice} : {}),
    ...(productDescription ? {productDescription} : {}),
    ...(customPhrase ? {customPhrase} : {}),
    ...(payload.animal ? {animal:payload.animal} : {}),
  }));
  form.append('logo',uploadBlob(payload.logo,5 * 1024 * 1024,'Logo'),payload.logo.name);
  if (!productDescription && payload.photo) form.append('photos',uploadBlob(payload.photo,10 * 1024 * 1024,'Foto do produto'),payload.photo.name);
  return form;
}

export async function idempotencyKey(requestId) {
  if (!UUID_V4.test(requestId || '')) throw new Error('Não foi possível identificar esta tentativa.');
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(requestId));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

export function safeWhatsAppUrl(value,message,orderId) {
  if (!ORDER_ID.test(orderId || '') || typeof message !== 'string' || !message.includes(orderId) || message.length > 6000) throw new Error('O pedido foi salvo. Copie a mensagem para continuar pelo WhatsApp.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.host !== 'wa.me' || url.username || url.password || url.hash ||
      url.pathname !== '/' + WHATSAPP_RECIPIENT || url.searchParams.getAll('text').length !== 1 ||
      [...url.searchParams.keys()].some(key => key !== 'text') || url.searchParams.get('text') !== message) {
    throw new Error('O pedido foi salvo. Copie a mensagem para continuar pelo WhatsApp.');
  }
  return url.href;
}

export function normalizeReceipt(result,payload) {
  if (!result || !ORDER_ID.test(result.orderId || '') || result.status !== 'awaiting_authorization' ||
      !Number.isSafeInteger(result.totalCents) || result.totalCents < 0) {
    throw new Error('A resposta não confirmou o pedido. Tente novamente para consultar a mesma tentativa, sem criar outra.');
  }
  const suppliedMessage = [result.whatsappMessage,result.message].find(value => typeof value === 'string' && value.length <= 6000 && value.includes(result.orderId));
  const message = suppliedMessage || [
    'Olá! Enviei esse pedido pelo site da iA4tube Empresas.',
    '',
    'Pedido: ' + result.orderId,
    'Produto: ' + (payload.productsVideo ? `Vídeo de produtos · ${payload.productsVideo.packageCount} imagens` : 'Vídeo personalizado · ' + payload.durationSeconds + ' segundos'),
    ...(typeof payload.company === 'string' && payload.company.trim() ? ['Estabelecimento: ' + payload.company.trim()] : []),
    ...(payload.productDescription ? ['Descrição do produto: ' + normalizeProductDescription(payload.productDescription)] : []),
    ...(payload.customPhrase ? ['Frase principal: ' + normalizeCustomPhrase(payload.customPhrase)] : []),
    ...(payload.productPrice ? ['Preço do produto na arte: ' + normalizeProductPrice(payload.productPrice)] : []),
    '',
    'Gostaria de confirmar o recebimento e combinar os próximos passos.',
  ].join('\n');
  let whatsappUrl = '';
  try {whatsappUrl = safeWhatsAppUrl(result.whatsappUrl,message,result.orderId);} catch {}
  return {orderId:result.orderId,status:result.status,totalCents:result.totalCents,message,whatsappUrl};
}
