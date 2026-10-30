// Optional native navigation only. Never grants quota or authorizes an order.
const NONCE=/^[A-Za-z0-9_-]{43}$/;
export function createAppCombosBridge({getNonce,navigate,receiveAvailability,
  getDocumentUrl=()=>'https://ia4tube.com/edit/'}) {
  let supportedNonce=null;
  return Object.freeze({
    receiveAvailability(...args) {
      const accepted=receiveAvailability(...args.slice(0,7));
      if(accepted===true)supportedNonce=args[7]===true?args[0]:null;
      return accepted;
    },
    open() {
      const nonce=getNonce();
      if(!NONCE.test(nonce || '') || nonce!==supportedNonce)return false;
      // Keep navigation in the original click handler so Android sees its gesture.
      try{
        const current=new URL(getDocumentUrl());
        if(current.protocol!=='https:' || current.username || current.password || current.port ||
          !['ia4tube.com','www.ia4tube.com'].includes(current.hostname) || !['/edit','/edit/'].includes(current.pathname))return false;
        return navigate(current.origin+'/edit/app-combos/open?nonce='+nonce)!==false;
      }
      catch{return false;}
    },
  });
}
