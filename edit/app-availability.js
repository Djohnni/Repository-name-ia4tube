// Optional native hint only. Financial admission remains on the server.
const NONCE=/^[A-Za-z0-9_-]{43}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const flag=value=>value===null || typeof value==='boolean';
export function createAppAvailability({getNonce,navigate,onChange=()=>{},now=()=>performance.now(),
  canRefresh=()=>true,requestId=()=>crypto.randomUUID(),setTimer=setTimeout,clearTimer=clearTimeout}) {
  let supported=false,revision=-1,pending=null,until=0,image=null,video=null;
  let refreshTimer=null,expiryTimer=null,requestTimer=null;
  const clear=()=>{clearTimer(refreshTimer);clearTimer(expiryTimer);refreshTimer=expiryTimer=null;};
  const current=()=>({supported,canImage:now()<until?image:null,canVideo:now()<until?video:null});
  function refresh(){
    const nonce=getNonce();
    if(!supported || !NONCE.test(nonce || '') || !canRefresh())return false;
    const id=requestId();if(!UUID.test(id || ''))return false;
    clear();clearTimer(requestTimer);pending=id;until=0;image=video=null;onChange(current());
    requestTimer=setTimer(()=>{if(pending===id){pending=null;until=0;image=video=null;onChange(current());}},30000);
    try{navigate('https://ia4tube.com/edit/app-availability/request?requestId='+id+'&nonce='+nonce);return true;}
    catch{clearTimer(requestTimer);pending=null;onChange(current());return false;}
  }
  function receive(nonce,id,version,canImage,canVideo,validForMs,loading=false){
    if(nonce!==getNonce() || !NONCE.test(nonce || '') || !Number.isSafeInteger(version) || version<0 || version<revision ||
      !(id===null || UUID.test(id || '')) || pending!==null && id!==pending ||
      !flag(canImage) || !flag(canVideo) || typeof loading!=='boolean' || !Number.isSafeInteger(validForMs) || validForMs<0 || validForMs>30000)return false;
    supported=true;revision=version;clear();
    // The native owner may emit unknown while its matching read is still running.
    if(!loading){pending=null;clearTimer(requestTimer);}
    image=validForMs>0?canImage:null;video=validForMs>0?canVideo:null;until=now()+validForMs;
    if(validForMs>0){
      refreshTimer=setTimer(()=>{if(canRefresh())refresh();},Math.max(1,validForMs-1000));
      expiryTimer=setTimer(()=>onChange(current()),validForMs);
    }
    onChange(current());return true;
  }
  return Object.freeze({receive,refresh,current,canCreate:kind=>kind==='image'?current().canImage:current().canVideo});
}
