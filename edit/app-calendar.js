// Existing app86 calendar protocol. A nonce is only a navigation/callback hint.
// Checkout admission is authorized by the receiver and Render, never by this page.
import {createAppAvailability} from './app-availability.js?v=20261030-availability-v1';
import {createAppCombosBridge} from './app-combos.js?v=20261030-combos-v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const TICKET = /^[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/;
const KEY = 'ia4tube:edit-app-calendar:v1';

export function createAppCalendarBridge({location, storage, navigate, setTimer = setTimeout, clearTimer = clearTimeout}) {
  const pending = new Map();
  let state = {nonce:null,tickets:{}};
  try {
    const saved = JSON.parse(storage.getItem(KEY));
    if (saved && NONCE.test(saved.nonce || '') && saved.tickets && typeof saved.tickets === 'object') state = saved;
  } catch { /* Public visitors do not need storage for this optional feature. */ }
  const supplied = location.hash?.match(/^#app-calendar=([A-Za-z0-9_-]{43})$/)?.[1];
  if (supplied && supplied !== state.nonce) state = {nonce:supplied,tickets:{}};
  const persist = () => { storage.setItem(KEY,JSON.stringify(state)); };
  let storageFailed = false;
  if (supplied) try { persist(); } catch { storageFailed = true; }
  return Object.freeze({
    enabled:Boolean(state.nonce),
    attemptScope:state.nonce,
    request(requestId) {
      if (!state.nonce) return Promise.resolve(null);
      if (storageFailed) return Promise.reject(new Error('Ative o armazenamento do app para preservar o pedido do calendário.'));
      if (!UUID.test(requestId || '')) return Promise.reject(new Error('Não foi possível identificar o pedido do calendário.'));
      const saved = state.tickets[requestId];
      if (TICKET.test(saved || '')) return Promise.resolve({ticket:saved});
      if (pending.has(requestId)) return pending.get(requestId).promise;
      let resolve, reject;
      const promise = new Promise((yes,no) => {resolve=yes;reject=no;});
      const timer = setTimer(() => {
        pending.delete(requestId);
        reject(new Error('O calendário não confirmou o horário. Tente novamente; seus dados continuam preenchidos.'));
      },180000);
      pending.set(requestId,{promise,resolve,reject,timer});
      try {
        navigate('https://ia4tube.com/edit/app-calendar/request?requestId=' + requestId + '&nonce=' + state.nonce);
      } catch {
        clearTimer(timer);pending.delete(requestId);
        reject(new Error('Não foi possível abrir o calendário no app. Tente novamente.'));
      }
      return promise;
    },
    receive(requestId,ticket,error) {
      const current = pending.get(requestId);
      if (!current) return;
      pending.delete(requestId);clearTimer(current.timer);
      if (error || !TICKET.test(ticket || '')) {
        current.reject(new Error(error === 'cancelled' || error === 'calendar_cancelled'
          ? 'Escolha a data e o horário para enviar este pedido pelo app.'
          : 'Não foi possível confirmar o calendário. Tente novamente; o pedido não foi enviado.'));
        return;
      }
      state.tickets[requestId] = ticket;
      try { persist();current.resolve({ticket}); }
      catch { current.reject(new Error('Não foi possível preservar o vínculo do calendário. Tente novamente.')); }
    },
  });
}

let appBridge = null;
let availabilityBridge = null;
let combosBridge = null;
if (typeof window !== 'undefined') {
  let storage;
  try { storage = window.sessionStorage; }
  catch { storage = {getItem:() => null,setItem:() => {throw new Error('storage_unavailable');}}; }
  appBridge = createAppCalendarBridge({location:window.location,storage,
    navigate:url => window.location.assign(url)});
  availabilityBridge=createAppAvailability({getNonce:()=>appBridge.attemptScope,navigate:url=>window.location.assign(url),
    canRefresh:()=>!window.document.hidden,onChange:()=>window.document.dispatchEvent(new Event('ia4tube:edit-availability-changed'))});
  combosBridge=createAppCombosBridge({getNonce:()=>appBridge.attemptScope,navigate:url=>window.location.assign(url),
    getDocumentUrl:()=>window.location.href,receiveAvailability:availabilityBridge.receive});
  Object.defineProperty(window,'iA4tubeAppCalendar',{value:Object.freeze({receive:appBridge.receive,
    receiveAvailability:combosBridge.receiveAvailability}),writable:false,configurable:false});
}
export const requestAppCalendar = requestId => appBridge ? appBridge.request(requestId) : Promise.resolve(null);
export const appCalendarAttemptScope = () => appBridge?.attemptScope || null;
export const appCreationAllowed = kind => availabilityBridge?.canCreate(kind) ?? null;
export const refreshAppAvailability = () => availabilityBridge?.refresh() || false;
export const openAppCombos = () => combosBridge?.open() || false;
