// Small navigation index for uncertain POSTs. No ticket, JWT, customer data or uploads.
const KEY='ia4tube.edit.recovery.v1';
const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function createOrderRecovery({storage,scope,isPending}) {
  function read(){
    try{const raw=storage.getItem(KEY);if(typeof raw!=='string'||raw.length>65536)return {};
      const value=JSON.parse(raw);
      if(value?.schemaVersion!==1 || value.scope!==scope() || !value.pending || typeof value.pending!=='object' || Array.isArray(value.pending))return {};
      if(Object.keys(value.pending).length>64)return {};
      return Object.fromEntries(Object.entries(value.pending).filter(([fingerprint,row])=>HASH.test(fingerprint)&&row&&
        UUID.test(row.requestId || '')&&UUID.test(row.modelId || '')&&Number.isSafeInteger(row.modelVersion)&&row.modelVersion>0&&
        isPending(fingerprint,row.requestId)));
    }catch{return {};}
  }
  function write(pending){
    const value=JSON.stringify({schemaVersion:1,scope:scope(),pending});storage.setItem(KEY,value);
    if(storage.getItem(KEY)!==value)throw new Error('Não foi possível preservar esta tentativa. Nenhum novo pedido foi enviado.');
  }
  return Object.freeze({
    hasModel:modelId=>Object.values(read()).some(row=>row.modelId===modelId),
    record(fingerprint,row){
      const pending=read();
      if(!HASH.test(fingerprint)||!UUID.test(row.requestId || '')||!UUID.test(row.modelId || '')||!Number.isSafeInteger(row.modelVersion)||row.modelVersion<1)
        throw new Error('Não foi possível preservar esta tentativa.');
      if(!pending[fingerprint]&&Object.keys(pending).length>=64)throw new Error('Confira seus pedidos pendentes antes de iniciar outro.');
      pending[fingerprint]={requestId:row.requestId,modelId:row.modelId,modelVersion:row.modelVersion};write(pending);
    },
    forget(fingerprint,requestId){const pending=read();if(pending[fingerprint]?.requestId===requestId){delete pending[fingerprint];write(pending);}},
  });
}
