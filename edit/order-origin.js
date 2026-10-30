// Navigation context only. It contains no ticket, authorization or uploaded file.
const ID=/^[A-Za-z0-9_-]{1,100}$/;
export function captureOrderOrigin({item,items,key,hash,categoryId='all',query=''}) {
  return {schemaVersion:1,modelId:item.id,modelVersion:item.version,
    mediaKind:item.mediaKind==='image'?'image':'video',playlistIds:items.map(value=>value.id),
    playlistKey:key,hash:hash==='#video/'+encodeURIComponent(item.id)?hash:'#hoje',categoryId,query};
}
export function resolveOrderOrigin(origin,available,{categoryIds=['all']}={}) {
  if(!origin || !ID.test(origin.modelId || ''))return null;
  const byId=new Map(available.map(item=>[item.id,item])),model=byId.get(origin.modelId);
  if(!model)return null;
  const ids=origin.schemaVersion===1 && Array.isArray(origin.playlistIds) && origin.playlistIds.length<=1000 &&
    origin.playlistIds.every(id=>typeof id==='string'&&ID.test(id)) && new Set(origin.playlistIds).size===origin.playlistIds.length &&
    origin.playlistIds.includes(model.id) ? origin.playlistIds : [model.id];
  const items=ids.map(id=>byId.get(id)).filter(Boolean);
  const mediaKind=model.mediaKind==='image'?'image':'video';
  const matching=items.filter(item=>(item.mediaKind==='image'?'image':'video')===mediaKind);
  const changed=Number.isSafeInteger(origin.modelVersion) && origin.modelVersion!==model.version;
  const playlistKey=typeof origin.playlistKey==='string' && origin.playlistKey.length<=500 && !/[\x00-\x1f\x7f]/.test(origin.playlistKey)
    ? origin.playlistKey : 'origin-'+model.id;
  return {items:matching,index:matching.findIndex(item=>item.id===model.id),mediaKind,changed,
    key:changed?playlistKey+'-version-'+model.version:playlistKey,
    hash:origin.hash==='#hoje'?'#hoje':'#video/'+encodeURIComponent(model.id),
    categoryId:categoryIds.includes(origin.categoryId)?origin.categoryId:'all',
    query:typeof origin.query==='string'&&origin.query.length<=200?origin.query:''};
}
