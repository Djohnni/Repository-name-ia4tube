import {canChooseModel,isReadyPost} from './ready-posts.js?v=20261030-media-quota-v1';

export function quotaCombosLabel(kind,canCreate) {
  if(canCreate('image')===false && canCreate('video')===false)return 'Suas artes acabaram · Ver combos';
  return kind==='image'?'Ver combos para criar imagens':'Ver combos para criar vídeos';
}

export function orderCallToAction(item,{inApp=false,recovering=false,canCreate=()=>null,release=null}={}) {
  if(release)return {kind:'release',label:'Em breve',disabled:true};
  if(!item?.orderEnabled)return {kind:'details',label:'Ver detalhes',disabled:false};
  if(!inApp)return {kind:'app',label:'Peça pelo app',disabled:false};
  if(recovering)return {kind:'recovery',label:'Conferir pedido',disabled:false};
  if(!canChooseModel(item,canCreate))return {kind:'combos',
    label:quotaCombosLabel(item.mediaKind || 'video',canCreate),disabled:false};
  return {kind:'order',label:'Fazer meu pedido',disabled:false};
}

export function alternateOrderCallToAction(item,options={}) {
  if(!isReadyPost(item) || orderCallToAction(item,options).kind!=='combos')return null;
  const kind=(item.mediaKind || 'video')==='image'?'video':'image';
  if(options.canCreate?.(kind)!==true)return null;
  return {kind,label:kind==='video'?'Fazer vídeo':'Fazer imagem'};
}
