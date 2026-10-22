// Measurement is optional and never reads the order form or its files.
export const CONSENT_KEY = 'ia4tube.edit.analytics-consent.v1';
export const COUNTED_KEY = 'ia4tube.edit.analytics-orders.v1';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const CANONICAL = 'https://ia4tube.com/edit/';

export function isPublicEdit(href) {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ['ia4tube.com','www.ia4tube.com'].includes(url.hostname) && /^\/edit(?:\/|\/index\.html)?$/.test(url.pathname);
  } catch {return false;}
}
function campaignToken(value) {
  const text = String(value || '').trim();
  return /^[a-zA-Z0-9_. -]{1,80}$/.test(text) && !/\d{10,}/.test(text) ? text : '';
}
export function pageContext(href,referrer = '') {
  const result = {page_location:CANONICAL,page_title:'iA4tube Edit',page_referrer:''};
  try {
    const url = new URL(href);
    for (const [query,field] of [['utm_source','campaign_source'],['utm_medium','campaign_medium'],['utm_campaign','campaign_name'],['utm_content','campaign_content']]) {
      const value = campaignToken(url.searchParams.get(query));
      if (value) result[field] = value;
    }
  } catch { /* No unvalidated URL is ever sent. */ }
  try {
    const url = new URL(referrer);
    if (['http:','https:'].includes(url.protocol) && !url.username && !url.password && !['ia4tube.com','www.ia4tube.com'].includes(url.hostname)) result.page_referrer = url.origin + '/';
  } catch { /* Direct navigation has no referrer. */ }
  return result;
}
export function readConsent(storage,now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(CONSENT_KEY));
    return saved && ['granted','denied'].includes(saved.choice) && Number.isFinite(saved.expiresAt) && saved.expiresAt > now ? saved.choice : null;
  } catch {return null;}
}
export function saveConsent(storage,choice,now = Date.now()) {
  if (!['granted','denied'].includes(choice)) return false;
  try {storage.setItem(CONSENT_KEY,JSON.stringify({choice,expiresAt:now + 180 * 86400000}));return true;} catch {return false;}
}
function publicModel(detail) {
  if (!detail || !UUID.test(detail.videoId || '')) return null;
  const params = {video_id:detail.videoId};
  if (['sextou','sabadou','produtos'].includes(detail.recipe)) params.model_type = detail.recipe;
  if ([10,20].includes(detail.durationSeconds)) params.duration_seconds = detail.durationSeconds;
  if ([1,2,4,6,8].includes(detail.productCount)) params.product_count = detail.productCount;
  return params;
}
export function createEditMeasurement({send,storage,context = {},allowed = false}) {
  let granted = false,visited = false;
  const counted = new Set();
  try {
    const saved = JSON.parse(storage?.getItem(COUNTED_KEY) || '[]');
    if (Array.isArray(saved)) saved.filter(id => typeof id === 'string' && UUID.test(id)).slice(-200).forEach(id => counted.add(id.toLowerCase()));
  } catch { /* Storage failure does not affect checkout. */ }
  function emit(name,params = {}) {
    if (!allowed || !granted) return false;
    try {send(name,{...context,...params});return true;} catch {return false;}
  }
  return {
    setConsent(value) {
      granted = value === 'granted';
      if (granted && !visited) visited = emit('page_view');
    },
    open(detail) {
      const params = publicModel(detail);
      return params ? emit('edit_order_open',params) : false;
    },
    saved(detail) {
      const params = publicModel(detail);
      if (!params || !UUID.test(detail.orderId || '') || counted.has(detail.orderId.toLowerCase())) return false;
      if (!emit('edit_order_saved',params)) return false;
      // Order IDs are kept locally for deduplication, never sent to Google.
      counted.add(detail.orderId.toLowerCase());
      try {storage?.setItem(COUNTED_KEY,JSON.stringify([...counted].slice(-200)));} catch {}
      return true;
    },
  };
}
