import { createOrderController } from './order.js';

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
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':'<path d="m3 3 18 18M10.6 5.1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 4M6.2 6.2A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.8-1.8M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.info}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => Number.isSafeInteger(cents) ? (cents / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}) : 'Consulte';
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
let activeIndex = 0,soundEnabled = false,userPaused = reduceMotion,routeIsProfile = false;
let progressFrame = 0,toastTimer,playlistKey = '';
let videoOnly = false;
const order = createOrderController({dialog:personalize,money,toast,onBusy:playback});

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
  const paused = card.querySelector('video').paused;
  card.classList.toggle('is-paused',paused);
  const button = card.querySelector('.play-toggle');
  button.innerHTML = icon(paused ? 'play' : 'pause');
  button.setAttribute('aria-label',paused ? 'Reproduzir vídeo' : 'Pausar vídeo');
}
function syncSound() {
  videos.forEach(video => video.muted = !soundEnabled);
  document.querySelectorAll('.sound-toggle').forEach(button => {
    button.innerHTML = icon(soundEnabled ? 'sound' : 'muted');
    button.setAttribute('aria-label',soundEnabled ? 'Desativar som' : 'Ativar som');
    button.setAttribute('aria-pressed',String(soundEnabled));
  });
}
function tick() {
  cancelAnimationFrame(progressFrame);
  const video = videos[activeIndex];
  progress.style.transform = `scaleX(${video?.duration ? Math.min(video.currentTime / video.duration,1) : 0})`;
  if (video && !video.paused && canPlay()) progressFrame = requestAnimationFrame(tick);
}
function playback() {
  videos.forEach((video,index) => {if (index !== activeIndex || !canPlay()) video.pause();});
  const video = videos[activeIndex];
  if (video && canPlay()) video.play().then(tick).catch(() => syncPlayButton(activeCard()));
  tick();
}
function togglePlay() {if (!videos[activeIndex]) return;userPaused = !videos[activeIndex].paused;playback();}
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

function renderFeed(items,key) {
  if (playlistKey === key) return;
  observer.disconnect();videos.forEach(video => video.pause());cancelAnimationFrame(progressFrame);
  playlist = items;playlistKey = key;activeIndex = 0;feed.replaceChildren();
  for (const item of items) {
    const article = document.createElement('article');
    article.className = 'video-card';article.dataset.id = item.id;
    article.setAttribute('aria-label',`${item.label}: ${item.title}`);
    article.innerHTML = `<video src="${esc(mediaPath(item.video))}" poster="${esc(mediaPath(item.poster))}" muted loop playsinline preload="metadata" aria-label="Vídeo ${esc(item.label)}"></video><div class="video-shade"></div><div class="center-pause">${icon('play')}</div><div class="video-actions"><button class="creator-action" aria-label="Ver perfil da iA4tube"><img src="${esc(mediaPath(creator.avatar))}" alt=""><span>${icon('arrow-up-right')}</span></button><button class="circle sound-toggle" aria-label="Ativar som">${icon('muted')}</button><button class="circle play-toggle" aria-label="Pausar vídeo">${icon('pause')}</button><button class="circle model-info" aria-label="Detalhes deste modelo">${icon('info')}</button><button class="circle interface-toggle" aria-label="Ocultar interface" title="Ocultar interface" aria-pressed="false">${icon('eye-off')}</button></div><div class="video-info"><div class="offer-row"><div class="offer-price"><small>${item.orderEnabled ? 'a partir de' : 'referência visual'}</small><strong>${item.orderEnabled ? money(prices['10']) : 'Em breve'}</strong></div><button class="make-button">${item.orderEnabled ? 'Fazer meu pedido' : 'Ver detalhes'} ${icon('arrow-up-right')}</button></div></div>`;
    article.querySelector('.creator-action').addEventListener('click',() => location.hash = 'perfil');
    article.querySelector('.sound-toggle').addEventListener('click',() => {soundEnabled = !soundEnabled;syncSound();toast(soundEnabled ? 'Som ativado' : 'Som desativado');});
    article.querySelector('.play-toggle').addEventListener('click',togglePlay);
    article.querySelector('.interface-toggle').addEventListener('click',() => setVideoOnly(!videoOnly));
    article.querySelector('video').addEventListener('click',togglePlay);
    article.querySelector('.make-button').addEventListener('click',() => openPersonalize(item));
    article.querySelector('.model-info').addEventListener('click',() => openPersonalize(item));
    const video = article.querySelector('video');
    video.addEventListener('play',() => syncPlayButton(article));
    video.addEventListener('pause',() => syncPlayButton(article));
    video.addEventListener('error',() => {if (activeCard() === article) toast('Não foi possível carregar este vídeo. Tente o próximo.');});
    feed.append(article);
  }
  cards = [...feed.querySelectorAll('.video-card')];videos = cards.map(card => card.querySelector('video'));
  document.querySelector('#previous').disabled = true;document.querySelector('#next').disabled = cards.length < 2;
  if (!cards.length) {
    document.querySelector('#position').innerHTML = '00 <span>/ 00</span>';
    feed.innerHTML = '<div class="empty-feed"><span class="eyebrow">SEM VÍDEOS EM DESTAQUE</span><h2>A próxima inspiração<br>está chegando.</h2><p>Os modelos anteriores continuam no perfil.</p><a class="primary-action" href="#perfil">Ver perfil da iA4tube</a></div>';
  }
  feed.scrollTo({top:0,behavior:'instant'});
  cards.forEach(card => observer.observe(card));syncSound();syncInterface();activate(0);tick();
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
  document.querySelector('#chosen-poster').src = mediaPath(item.poster);
  document.querySelector('#chosen-poster').alt = `Modelo ${item.label}`;
  document.querySelector('#chosen-title').textContent = item.title;
  document.querySelector('#chosen-kicker').textContent = item.label;
  const phrase = item.phrase || (item.recipe === 'sextou' ? 'SEXTOU' : item.recipe === 'sabadou' ? item.copyLabel || item.label : 'Referência visual');
  document.querySelector('#chosen-phrase').textContent = `Frase do modelo: ${phrase}`;
  document.querySelector('#model-note').textContent = item.note || (item.orderEnabled ? 'O vídeo será personalizado com o modelo de produção vinculado a esta referência.' : 'Somente referência visual; não disponível para pedidos.');
  order.open(item,data);personalize.showModal();playback();
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
    const button = document.createElement('button');button.className = 'profile-card';
    if (item.creativeTemplate) button.classList.add('profile-card--creative');
    button.setAttribute('aria-label',`Assistir ${item.label}: ${item.title}`);
    button.innerHTML = `<div class="profile-thumbnail"><img src="${esc(mediaPath(item.poster))}" alt="${esc(item.title)}" loading="lazy"><span>${icon('play')}${esc(item.duration)}s</span></div><div class="profile-card-copy"><span>${esc(item.label)}</span><h3>${esc(item.title)}</h3></div>`;
    button.addEventListener('click',() => location.hash = `video/${encodeURIComponent(item.id)}`);grid.append(button);
  }
  if (!catalog.length) grid.innerHTML = '<p class="empty-profile">Nenhum vídeo disponível ainda. </p>';
}
function route() {
  routeIsProfile = location.hash === '#perfil';
  if (routeIsProfile) setVideoOnly(false);
  document.querySelector('#feed-view').hidden = routeIsProfile;
  document.querySelector('#profile-view').hidden = !routeIsProfile;
  document.querySelectorAll('[data-nav]').forEach(link => {if (link.dataset.nav === (routeIsProfile ? 'profile' : 'feed')) link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  document.title = routeIsProfile ? 'Perfil · iA4tube' : 'Em destaque · iA4tube';
  if (!routeIsProfile && data) {
    let requestedId = '';
    if (location.hash.startsWith('#video/')) {try {requestedId = decodeURIComponent(location.hash.slice(7));} catch {}}
    const fromProfile = requestedId && catalog.some(item => item.id === requestedId);
    renderFeed(fromProfile ? catalog : daily,fromProfile ? 'profile' : 'daily');
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
document.addEventListener('visibilitychange',playback);
function toast(message) {
  const element = document.querySelector('#toast');element.textContent = message;element.classList.add('visible');
  clearTimeout(toastTimer);toastTimer = setTimeout(() => element.classList.remove('visible'),3200);
}
async function load() {
  feed.innerHTML = '<div class="empty-feed"><p role="status">Carregando os vídeos…</p></div>';
  try {
    const response = await fetch('./catalog.json',{cache:'no-store'});
    if (!response.ok) throw new Error('Não foi possível carregar o catálogo.');
    data = await response.json();
    if (!Array.isArray(data.catalog) || !Array.isArray(data.dailySelection?.videoIds)) throw new Error('O catálogo não está disponível.');
    creator = {...creator,...data.creator};prices = data.prices || {};
    catalog = data.catalog.filter(item => item.status === 'published');
    const byId = new Map(catalog.map(item => [item.id,item]));
    daily = [...new Set(data.dailySelection.videoIds)].map(id => byId.get(id)).filter(Boolean);
    renderProfile();route();
    const receipt = order.restore();
    if (receipt) {personalize.showModal();playback();}
  } catch(error) {
    data = null;feed.innerHTML = '<div class="empty-feed"><span class="eyebrow">CATÁLOGO INDISPONÍVEL</span><h2>Não conseguimos<br>abrir os vídeos.</h2><p id="catalog-error"></p><button id="retry-catalog" class="primary-action">Tentar novamente</button></div>';
    document.querySelector('#catalog-error').textContent = error.message || 'Confira sua conexão e tente novamente.';
    document.querySelector('#retry-catalog').addEventListener('click',load);
  }
}
route();load();
