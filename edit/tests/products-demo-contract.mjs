import assert from 'node:assert/strict';

// Authorized demo-only replacement on 2026-10-22. The production contract stays v1.
export const PRODUCTS_DEMO_ID='2830b796-2375-49e8-8e97-9a731c115252';
export const PRE_PRODUCTS_DEMO_CATALOG_SHA256='91e08bd3e0c867e82dd322a116db0aafd7f029e563b675fc97dc6029e7318df3';
export const PRODUCTS_DEMO_VIDEO_SHA256='48f794412c7f3e9c9df77b6489f3c27d18870dc4c89f912cb68b07c966d51efd';
export const PRODUCTS_DEMO_PREVIOUS={
  note:'Escolha 2, 4, 6 ou 8 fotos. Abertura, narração, música e encerramento incluídos. O exemplo mostra 5 produtos.',
  duration:31,poster:'./media/produtos-cardapio.png',video:'./media/produtos-cardapio.mp4',
};
export const PRODUCTS_DEMO_CURRENT={
  note:'Escolha 2, 4, 6 ou 8 fotos. Abertura, narração, música e encerramento incluídos. O exemplo mostra 4 produtos.',
  duration:25,poster:'./media/produtos-oburgao-20261022.png',video:'./media/produtos-oburgao-20261022.mp4',
};

// Reconstruct only these four explicitly approved fields, validating each new
// value first. Unrelated fields and every other item reach the original hashes.
export function restorePriorProductDemoForHistory(items) {
  return items.map(item=>{
    if(item.id!==PRODUCTS_DEMO_ID)return structuredClone(item);
    for(const[key,value]of Object.entries(PRODUCTS_DEMO_CURRENT))assert.equal(item[key],value,`product demo ${key}`);
    return {...structuredClone(item),...PRODUCTS_DEMO_PREVIOUS};
  });
}
