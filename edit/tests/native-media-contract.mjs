import assert from 'node:assert/strict';

// Only these three poster/video pairs were approved on 2026-10-21.
// Keep prior identities and source hashes explicit; production bindings stay unchanged.
export const NATIVE_MEDIA = [
  {
    id:'cc2ff272-4fbf-404c-b5a0-3a5ece29b15d',name:'fome-chamando',
    previous:{poster:'./media/3dbba064-3249-40c1-8e5c-0b0845fa168e.png',video:'./media/85862775-668b-47e0-a3cd-c1d48c3e9308.mp4'},
    sha256:{poster:'22a9d2eb896541648b7f551b8373289a458f79eaeaf369bbd2db6c79b913f44b',video:'a793cf20c2db3384d0951a09983d5bfb0d5deb9e10ad06cbb7328026921f8113'},
  },
  {
    id:'15e9b9a7-c367-4724-90b5-d3c202641def',name:'so-penso-nisso',
    previous:{poster:'./media/340ea385-9aad-4603-a6cf-e8dba2637a88.png',video:'./media/a0e8589e-9580-4ce8-b2ae-006f45925cc7.mp4'},
    sha256:{poster:'a0f82e6e402e7379632c7a270c097b7c65ddbe57eef4c43e94f48df2a092a0c9',video:'9fe8b6f5fa641f672211cdd4326249d2377fb1688836ef91850592e4c7dd163c'},
  },
  {
    id:'af9ba4d1-2fb3-43cd-90f2-2a4cb5c8a7e0',name:'hoje-eu-nao-cozinho',
    previous:{poster:'./media/5f77d9de-10db-4a0c-bb77-4859eb273786.png',video:'./media/991cf743-de03-42a2-82c9-2c3575a71bf0.mp4'},
    sha256:{poster:'5b44d883a9bc71f46a32c5f03d4054c5e0ef8ec1e9445edb1288ce8f3b1fd39e',video:'dd1759bcaacae9f6efd35776cd31abd2646fdb0e378d7ec6d7626e937520ae8c'},
  },
];

export const nativeMediaPath=(row,type)=>`./media/audio-api-20261021/${row.name}.${type==='poster'?'png':'mp4'}`;
export const PRE_NATIVE_CATALOG_SHA256='9384da986724d45e591e3670ea73e2f7144ad1f69964bca78bd7fd1bc67cfe2b';

// Reconstruct only the six explicitly approved historical fields, after verifying
// their exact replacement paths. All other values still reach the original hashes.
export function restorePriorMediaForHistory(items) {
  return items.map(item=>{
    const approved=NATIVE_MEDIA.find(row=>row.id===item.id);
    if(!approved)return structuredClone(item);
    for(const type of ['poster','video'])assert.equal(item[type],nativeMediaPath(approved,type));
    return {...structuredClone(item),...approved.previous};
  });
}
