// Static, non-orderable announcements stay separate from the production catalog.
export const SATURDAY_PREVIEW_KIND = 'saturday-preview';
const IDS = new Set(['previa-sabado-burger','previa-sabado-combo','previa-sabado-pizza',
  'previa-sabado-mascote','previa-sabado-pizza-dupla']);
const LABEL = 'Sábado, novos vídeos';

export function normalizeSaturdayPreviews(value) {
  if (!value || !Array.isArray(value.items)) return [];
  const seen = new Set();
  return value.items.flatMap(item => {
    if (!item || !IDS.has(item.id) || seen.has(item.id) || typeof item.title !== 'string' ||
        !item.title.trim() || item.title.length > 100 ||
        typeof item.poster !== 'string' || !/^\.\/media\/sabado-20261024\/[a-z0-9-]+\.webp$/.test(item.poster)) return [];
    seen.add(item.id);
    return [{id:item.id,title:item.title.trim(),poster:item.poster,label:LABEL,
      kind:SATURDAY_PREVIEW_KIND,orderEnabled:false}];
  });
}

export async function loadSaturdayPreviews({fetchImpl = globalThis.fetch,
  setTimer = globalThis.setTimeout,clearTimer = globalThis.clearTimeout} = {}) {
  const controller = new AbortController();
  const timeout = setTimer(() => controller.abort(),2500);
  try {
    const response = await fetchImpl('./saturday-previews.json?v=20261022-saturday-previews',
      {signal:controller.signal,cache:'no-store'});
    return response.ok ? normalizeSaturdayPreviews(await response.json()) : [];
  } catch {return [];}
  finally {clearTimer(timeout);}
}

export function withSaturdayPreviews(items,previews) {
  return previews.length ? [...items,...previews] : items;
}

export function syncPreviewImages(cards,activeIndex,{visible = true} = {}) {
  cards.forEach((card,index) => {
    const image = card.querySelector('.preview-poster');
    if (!image) return;
    if (visible && Math.abs(index - activeIndex) <= 1) {
      if (image.getAttribute('src') !== image.dataset.src) image.setAttribute('src',image.dataset.src);
    } else if (image.getAttribute('src') !== null) image.removeAttribute('src');
  });
}
