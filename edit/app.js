import { createOrderController } from './order.js?v=20261022-phrase';
import { createPlaybackAudio } from './playback-audio.js?v=20261021-native-sound';
import { releaseInfo, orderShowcase } from './availability.js?v=20261021-products-open';
import { createMediaWindow } from './media-window.js?v=20261022-light-media';

const paths = {
  home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  play:'<path d="m8 5 11 7-11 7z"/>',pause:'<path d="M8 5v14M16 5v14"/>',
  'chevron-up':'<path d="m6 14 6-6 6 6"/>','chevron-down':'<path d="m6 10 6 6 6-6"/>',
  'arrow-left':'<path d="m12 5-7 7 7 7M5 12h15"/>','arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',check:'<path d="m5 12 4 4 10-10"/>',
  sound:'<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
  muted:'<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6M16 15l6-6"/>',
  message:'<path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 21l1.9-5.3A8.5 8.5 0 1 1 21 11.5Z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':'<path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 4M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => Number.isSafeInteger(cents) ? (cents / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'Consulte';
const startingPrice = item => item.recipe === 'produtos' ? data.productsPrices?.['2'] : (item.prices?.['10'] ?? prices['10']);
const mediaPath = value => {
  try {const url = new URL(value,location.href);return url.origin === location.origin && !url.username && !url.password ? url.pathname + url.search : '';}
  catch {return '';}
};
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const feed = document.querySelector('#feed');
const personalize = document.querySelector('#personalize-dialog');
const about = document.querySelector('#about-dialog');
const progress = document.querySelector('#progress');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let catalog = [],daily = [],cards = [],videos = [],playlist = [];
let creator = {name:'iA4tube',avatar:'./assets/logo.png'},prices = {},data = null;
let activeIndex = 0,soundEnabled = true,userPaused = reduceMotion,routeIsProfile = false;
let progressFrame = 0,toastTimer,releaseTimer,playlistKey = '';
let videoOnly = false;
let posterPreviews = {};
const posterPath = item => {
  const preview = posterPreviews[item.poster];
  return mediaPath(typeof preview === 'string' && /^\.\/media\/previews-20261022\/[a-z0-9/_-]+\.webp$/i.test(preview) ? preview : item.poster);
};
const playbackAudio = createPlaybackAudio({onChange:syncSound});
const mediaWindow = createMediaWindow({cancel:video => playbackAudio.cancel(video)});
const order = createOrderController({dialog:personalize,money,toast,onBusy:playback,
  onSaved:detail => document.dispatchEvent(new CustomEvent('ia4tube:edit-order-saved',{detail:{...detail,videoTitle:catalog.find(item => item.id === detail.videoId)?.label}}))});

function activeCard() {return cards[activeIndex];}
function syncInterface() {
  document.body.classList.toggle('video-only',videoOnly);
  document.querySelectorAll('.interface-toggle').forEach(button => {
    const label = videoOnly ? 'Mostrar interface' : 'Ocultar interface';
    button.innerHTML = icon(videoOnly ? 'eye' : 'eye-off');
    button.setAttribute('aria-label',label);
    button.setAttribute('title',label);
    button.setAttribute('aria-pressed',String(videoOnly));
  });
}
function setVideoOnly(value) {
  videoOnly = Boolean(value);
  syncInterface();
}
addEventListener('keydown',event => {
  if (event.key === 'Escape' && videoOnly) setVideoOnly(false);
});
function canPlay() {return !routeIsProfile && !document.hidden && !personalize.open && !about.open && !userPaused;}
function syncPlayButton(card) {
  if (!card) return;
  const video = card.querySelector('video');
  const paused = video.paused;
  card.classList.toggle('is-paused',paused);
  video.setAttribute('aria-label',paused ? 'Reproduzir vídeo' : 'Pausar vídeo');
}
function syncReleases() {
  const now = Date.now();
  cards.forEach((card,index) => {
    const item = playlist[index];
    const release = releaseInfo(item,now);
    const notice = card.querySelector('.release-notice');
    const button = card.querySelector('.make-button');
    card.classList.toggle('is-scheduled',Boolean(release));
    notice.hidden = !release;
    if (release) notice.querySelector('strong').textContent = release.label;
    button.disabled = Boolean(release);
    button.innerHTML = (release ? 'Em breve' : item.orderEnabled ? 'Fazer meu pedido' : 'Ver detalhes') + ' ' + icon(release ? 'lock' : 'arrow-up-right');
    if (release) button.setAttribute('aria-describedby',notice.id);
    else button.removeAttribute('aria-describedby');
  });
  document.querySelector('#orderable-count').textContent = catalog.filter(item => item.orderEnabled && !releaseInfo(item,now)).length;
  document.querySelectorAll('.profile-card').forEach(card => {
    const release = releaseInfo({id:card.dataset.id},now);
    const badge = card.querySelector('.profile-release');
    badge.hidden = !release;
    if (release) badge.textContent = release.label;
  });
  clearTimeout(releaseTimer);
  const pending = catalog.map(item => releaseInfo(item,now)?.opensAt).filter(Number.isFinite);
  if (pending.length) releaseTimer = setTimeout(syncReleases,Math.min(Math.max(1,Math.min(...pending) - now + 50),2147483647));
}
function syncSound(state = playbackAudio.getState()) {
  soundEnabled = state.audible;
  videos.forEach(video => video.muted = !soundEnabled);
  document.querySelectorAll('.sound-toggle').forEach(button => {
    button.innerHTML = icon(soundEnabled ? 'sound' : 'muted') + (state.enabled && state.blocked ? '<span class="sound-hint">Toque para ouvir</span>' : '');
    button.setAttribute('aria-label',soundEnabled ? 'Desativar som' : 'Ativar som');
    button.setAttribute('aria-pressed',String(soundEnabled));
  });
}
function toggleSound() {
  playbackAudio.setEnabled(!playbackAudio.getState().audible);
  playback();
}
function tick() {
  cancelAnimationFrame(progressFrame);
  const video = videos[activeIndex];
  progress.style.transform = `scaleX(${video?.duration ? Math.min(video.currentTime / video.duration,1) : 0})`;
  if (video && !video.paused && canPlay()) progressFrame = requestAnimationFrame(tick);
}
function playback() {
  document.dispatchEvent(new Event('ia4tube:edit-before-media-change'));
  videos.forEach((video,index) => {if (index !== activeIndex || !canPlay()) {playbackAudio.cancel(video);video.pause();}});
  mediaWindow.sync(videos,activeIndex,{visible:!routeIsProfile && !document.hidden});
  const video = videos[activeIndex];
  if (video && canPlay()) playbackAudio.play(video,{
    isCurrent:() => videos[activeIndex] === video && canPlay(),
    onPlaying:tick,
    onError:() => syncPlayButton(activeCard()),
  });
  tick();
}
function togglePlay() {
  if (!videos[activeIndex]) return;
  userPaused = !videos[activeIndex].paused;playback();
}
function activateVideo(event) {
  const video = videos[activeIndex];
  if (!video || event.currentTarget !== video || routeIsProfile || document.hidden || personalize.open || about.open) return;
  const state = playbackAudio.getState();
  if (state.enabled && state.blocked) {
    // Use this first tap for sound, without also pausing the playing video.
    playbackAudio.setEnabled(true);
    userPaused = false;
    playback();
    return;
  }
  togglePlay();
}
function handleVideoKeydown(event) {
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    if (!event.repeat) activateVideo(event);
  }
}
function activate(index) {
  if (index < 0 || index >= cards.length) return;
  activeIndex = index;
  document.querySelector('#position').innerHTML = `${String(index + 1).padStart(2,'0')} <span>/ ${String(cards.length).padStart(2,'0')}</span>`;
  document.querySelector('#previous').disabled = index === 0;
  document.querySelector('#next').disabled = index === cards.length - 1;
  playback();
}
const observer = new IntersectionObserver(entries => {
  const winner = entries.filter(entry => entry.isIntersecting && entry.intersectionRatio >= .65).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (winner && !routeIsProfile) activate(cards.indexOf(winner.target));
},{root:feed,threshold:[.1,.65,.9]});

function renderFeed(items,key,initialIndex = 0) {
  if (playlistKey === key) return;
  document.dispatchEvent(new Event('ia4tube:edit-before-media-change'));
  observer.disconnect();videos.forEach(video => {playbackAudio.cancel(video);video.pause();});cancelAnimationFrame(progressFrame);
  mediaWindow.clear();
  playlist = items;playlistKey = key;activeIndex = Math.max(0,Math.min(initialIndex,items.length - 1));feed.replaceChildren();
  for (const item of items) {
    const article = document.createElement('article');
    article.className = 'video-card';article.dataset.id = item.id;article.dataset.title = item.label;article.dataset.recipe = item.recipe;
    article.setAttribute('aria-label',`${item.label}: ${item.title}`);
    article.innerHTML = `<video data-src="${esc(mediaPath(item.video))}" data-poster="${esc(posterPath(item))}" muted loop playsinline preload="none" role="button" tabindex="0" aria-label="Vídeo ${esc(item.label)}"></video><div class="video-shade"></div><div class="center-pause">${icon('play')}</div><div class="release-notice" id="release-${esc(item.id)}" role="status" hidden>${icon('lock')}<strong></strong></div><div class="video-actions"><button class="creator-action" aria-label="Ver perfil da iA4tube"><img src="${esc(mediaPath(creator.avatar))}" alt=""><span>${icon('arrow-up-right')}</span></button><button class="circle sound-toggle" aria-label="Ativar som">${icon('muted')}</button><button class="circle interface-toggle" aria-label="Ocultar interface" title="Ocultar interface" aria-pressed="false">${icon('eye-off')}</button></div><div class="video-info"><div class="offer-row"><div class="offer-price"><small>${item.orderEnabled ? 'a partir de' : 'referência visual'}</small><strong>${item.orderEnabled ? money(startingPrice(item)) : 'Em breve'}</strong></div><button class="make-button">${item.orderEnabled ? 'Fazer meu pedido' : 'Ver detalhes'} ${icon('arrow-up-right')}</button></div></div>`;
    article.querySelector('.creator-action').addEventListener('click',() => location.hash = 'perfil');
    article.querySelector('.sound-toggle').addEventListener('click',toggleSound);
    article.querySelector('.interface-toggle').addEventListener('click',() => setVideoOnly(!videoOnly));
    article.querySelector('video').addEventListener('click',activateVideo);
    article.querySelector('.make-button').addEventListener('click',() => openPersonalize(item));
    const video = article.querySelector('video');
    video.addEventListener('keydown',handleVideoKeydown);
    video.addEventListener('play',() => syncPlayButton(article));
    video.addEventListener('pause',() => syncPlayButton(article));
    video.addEventListener('error',() => {if (activeCard() === article && video.getAttribute('src')) toast('Não foi possível carregar este vídeo. Tente o próximo.');});
    feed.append(article);
  }
  cards = [...feed.querySelectorAll('.video-card')];videos = cards.map(card => card.querySelector('video'));
  document.querySelector('#previous').disabled = true;document.querySelector('#next').disabled = cards.length < 2;
  if (!cards.length) {
    document.querySelector('#position').innerHTML = '00 <span>/ 00</span>';
    feed.innerHTML = '<div class="empty-feed"><span class="eyebrow">SEM VÍDEOS EM DESTAQUE</span><h2>A próxima inspiração<br>está chegando.</h2><p>Os modelos anteriores continuam no perfil.</p><a class="primary-action" href="#perfil">Ver perfil da iA4tube</a></div>';
  }
  feed.scrollTo({top:activeIndex * feed.clientHeight,behavior:'instant'});
  cards.forEach(card => observer.observe(card));syncSound();syncInterface();syncReleases();activate(activeIndex);tick();
}
function goTo(index) {
  if (index < 0 || index >= cards.length) return;
  cards[index].scrollIntoView({block:'start',behavior:reduceMotion ? 'instant' : 'smooth'});
}
document.querySelector('#previous').addEventListener('click',() => goTo(activeIndex - 1));
document.querySelector('#next').addEventListener('click',() => goTo(activeIndex + 1));
feed.addEventListener('keydown',event => {
  if (event.target !== feed) return;
  if (event.key === 'ArrowDown') {event.preventDefault();goTo(activeIndex + 1);}
  if (event.key === 'ArrowUp') {event.preventDefault();goTo(activeIndex - 1);}
  if (event.key === ' ') {event.preventDefault();togglePlay();}
});

function openPersonalize(item) {
  if (!data) return;
  const release = releaseInfo(item);
  if (release) {syncReleases();toast(release.label);return;}
  document.querySelector('#chosen-poster').src = posterPath(item);
  document.querySelector('#chosen-poster').alt = `Modelo ${item.label}`;
  document.querySelector('#chosen-title').textContent = item.title;
  document.querySelector('#chosen-kicker').textContent = item.label;
  const phrase = item.phrase || (item.recipe === 'sextou' ? 'SEXTOU' : item.recipe === 'sabadou' ? item.copyLabel || item.label : 'Referência visual');
  document.querySelector('#chosen-phrase').textContent = item.recipe === 'produtos' ? phrase : `Frase do modelo: ${phrase}`;
  document.querySelector('#model-note').textContent = item.note || (item.orderEnabled ? 'O vídeo será personalizado com o modelo de produção vinculado a esta referência.' : 'Somente referência visual; não disponível para pedidos.');
  if (order.open(item,data) === false) return;
  personalize.showModal();playback();
  try {if (item.orderEnabled && !document.querySelector('#order-form').hidden) document.dispatchEvent(new CustomEvent('ia4tube:edit-order-open',{detail:{videoId:item.id,videoTitle:item.label,recipe:item.recipe}}));}
  catch { /* Optional measurement is independent from the form. */ }
}
document.querySelector('#preview-info').addEventListener('click',() => {about.showModal();playback();});
for (const dialog of [personalize,about]) {
  dialog.querySelector('.close-dialog').addEventListener('click',() => {if (!order.isBusy() || dialog !== personalize) dialog.close();});
  dialog.addEventListener('cancel',event => {if (dialog === personalize && order.isBusy()) event.preventDefault();});
  dialog.addEventListener('close',playback);
  dialog.addEventListener('click',event => {
    if (event.target !== dialog || (dialog === personalize && order.isBusy())) return;
    const r = dialog.getBoundingClientRect();if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
}
document.querySelector('.close-about').addEventListener('click',() => about.close());
document.querySelector('#back-feed').addEventListener('click',() => location.hash = 'hoje');

function renderProfile() {
  document.querySelector('#catalog-count').textContent = catalog.length;
  document.querySelector('#orderable-count').textContent = catalog.filter(item => item.orderEnabled).length;
  const grid = document.querySelector('#profile-grid');grid.replaceChildren();
  for (const item of catalog) {
    const button = document.createElement('button');button.className = 'profile-card';button.dataset.id = item.id;
    if (item.creativeTemplate) button.classList.add('profile-card--creative');
    button.setAttribute('aria-label',`Assistir ${item.label}: ${item.title}`);
    button.innerHTML = `<div class="profile-thumbnail"><img data-src="${esc(posterPath(item))}" alt="${esc(item.title)}" width="720" height="1280" loading="lazy" decoding="async"><span>${icon('play')}${esc(item.duration)}s</span><span class="profile-release" hidden></span></div><div class="profile-card-copy"><span>${esc(item.label)}</span><h3>${esc(item.title)}</h3></div>`;
    button.addEventListener('click',() => location.hash = `video/${encodeURIComponent(item.id)}`);grid.append(button);
  }
  if (!catalog.length) grid.innerHTML = '<p class="empty-profile">Nenhum vídeo disponível ainda. </p>';
  syncReleases();
}
function route() {
  routeIsProfile = location.hash === '#perfil';
  if (routeIsProfile) setVideoOnly(false);
  document.querySelector('#feed-view').hidden = routeIsProfile;
  document.querySelector('#profile-view').hidden = !routeIsProfile;
  if (routeIsProfile) document.querySelectorAll('#profile-grid img[data-src]').forEach(image => {
    if (!image.getAttribute('src')) image.src = image.dataset.src;
  });
  document.querySelectorAll('[data-nav]').forEach(link => {if (link.dataset.nav === (routeIsProfile ? 'profile' : 'feed')) link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title = routeIsProfile ? 'Perfil · iA4tube' : 'Em destaque · iA4tube';
  if (!routeIsProfile && data) {
    let requestedId = '';
    if (location.hash.startsWith('#video/')) {try {requestedId = decodeURIComponent(location.hash.slice(7));} catch {}}
    const fromProfile = requestedId && catalog.some(item => item.id === requestedId);
    const initialIndex = fromProfile ? catalog.findIndex(item => item.id === requestedId) : 0;
    renderFeed(fromProfile ? catalog : daily,fromProfile ? 'profile' : 'daily',initialIndex);
    document.querySelector('.feed-tab').textContent = fromProfile ? 'Do perfil' : 'Em destaque';
    if (fromProfile) {
      const index = playlist.findIndex(item => item.id === requestedId);
      feed.scrollTo({top:index * feed.clientHeight,behavior:'instant'});activate(index);
    } else if (requestedId) toast('Esse vídeo não está disponível. Veja os vídeos em destaque.');
  }
  playback();
}
addEventListener('hashchange',route);
addEventListener('resize',() => {if (!routeIsProfile) feed.scrollTo({top:activeIndex * feed.clientHeight,behavior:'instant'});});
document.addEventListener('visibilitychange',() => {syncReleases();playback();});
addEventListener('pageshow',syncReleases);
addEventListener('focus',syncReleases);
function toast(message) {
  const element = document.querySelector('#toast');element.textContent = message;element.classList.add('visible');
  clearTimeout(toastTimer);toastTimer = setTimeout(() => element.classList.remove('visible'),3200);
}
async function load() {
  feed.innerHTML = '<div class="empty-feed"><p role="status">Carregando os vídeos…</p></div>';
  try {
    const [response,previews] = await Promise.all([fetch('./catalog.json',{cache:'no-store'}),loadPosterPreviews()]);
    posterPreviews = previews;
    if (!response.ok) throw new Error('Não foi possível carregar o catálogo.');
    data = await response.json();
    if (!Array.isArray(data.catalog) || !Array.isArray(data.dailySelection?.videoIds)) throw new Error('O catálogo não está disponível.');
    creator = {...creator,...data.creator};prices = data.prices || {};
    catalog = orderShowcase(data.catalog.filter(item => item.status === 'published'));
    const byId = new Map(catalog.map(item => [item.id,item]));
    daily = orderShowcase([...new Set(data.dailySelection.videoIds)].map(id => byId.get(id)).filter(Boolean));
    renderProfile();route();
    const receipt = order.restore();
    if (receipt) {personalize.showModal();playback();}
  } catch(error) {
    data = null;feed.innerHTML = '<div class="empty-feed"><span class="eyebrow">CATÁLOGO INDISPONÍVEL</span><h2>Não conseguimos<br>abrir os vídeos.</h2><p id="catalog-error"></p><button id="retry-catalog" class="primary-action">Tentar novamente</button></div>';
    document.querySelector('#catalog-error').textContent = error.message || 'Confira sua conexão e tente novamente.';
    document.querySelector('#retry-catalog').addEventListener('click',load);
  }
}
async function loadPosterPreviews() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),2500);
  try {
    const response = await fetch('./poster-previews.json?v=20261022-light-media',{signal:controller.signal});
    if (!response.ok) return {};
    const value = await response.json();
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {return {};}
  finally {clearTimeout(timeout);}
}
route();load();
