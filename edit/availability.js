// One scheduled showcase release, not a rolling "tomorrow" deadline.
// Keep ordering identities, prices, media and historical receipts unchanged.
export const RELEASE_AT = '2026-10-22T00:00:00-03:00';
export const SCHEDULED_IDS = Object.freeze([
  '53b147d4-23c8-447b-9b03-aee70a57693d',
  '088347f6-b7c6-4ad4-bc01-3608edfc3277',
  'b260ffc1-953c-480f-ad89-e6ad9253636d',
  'a1a42dba-b196-43b6-82cb-816868721523',
  'd3fb329a-b67c-4554-8e94-74b715e6197b',
]);
// The owner released the narrated package and placed it third on 2026-10-21.
export const PRODUCT_PACKAGE_ID = '2830b796-2375-49e8-8e97-9a731c115252';
// Temporarily hidden from customers; keep the model and existing orders intact.
// Remove its ID here when the owner chooses to offer the package again.
export const HIDDEN_IDS = Object.freeze([PRODUCT_PACKAGE_ID]);
export const FUTURE_IDS = Object.freeze([]);
const ids = new Set(SCHEDULED_IDS);
const futureIds = new Set(FUTURE_IDS);
const hiddenIds = new Set(HIDDEN_IDS);
const opensAt = Date.parse(RELEASE_AT);
const day = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});

export function releaseInfo(item,now = Date.now()) {
  if (futureIds.has(item?.id)) return {opensAt:null,label:'Libera futuramente'};
  if (!ids.has(item?.id) || now >= opensAt) return null;
  const tomorrow = day.format(new Date(now + 86400000)) === day.format(new Date(opensAt));
  return {opensAt,label:tomorrow ? 'Desbloqueia amanhã' : 'Desbloqueia em 22/10'};
}

export function orderShowcase(items) {
  items = items.filter(item => !hiddenIds.has(item.id));
  const packageItem = items.find(item => item.id === PRODUCT_PACKAGE_ID);
  const otherItems = items.filter(item => item.id !== PRODUCT_PACKAGE_ID);
  const ordered = [...otherItems.filter(item => !futureIds.has(item.id)),...otherItems.filter(item => futureIds.has(item.id))];
  if (packageItem) ordered.splice(Math.min(2,ordered.length),0,packageItem);
  return ordered;
}
