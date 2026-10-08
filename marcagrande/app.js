(() => {
  'use strict';

  const config = window.MARCA_GRANDE_CONFIG;
  if (!config || !Array.isArray(config.posts)) return;
  const $ = (id) => document.getElementById(id);
  const storageKey = `ia4tube:marca-grande:${config.campaignId}:draft:v1`;
  const maxFiles = 12;
  const maxFileBytes = 10 * 1024 * 1024;
  const maxTotalBytes = 24 * 1024 * 1024;
  const state = new Map(config.posts.map((post) => [post.id, { selected: false, format: 'image' }]));
  const cards = new Map();
  const photos = [];
  const gallery = $('gallery');
  let toastTimer;
  let busy = false;
  let completed = false;
  let submissionKey = null;
  let lastPreviewFocus = null;
  let scrollFrame = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(path) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.setAttribute('d', path);
    svg.append(line);
    return svg;
  }

  function readDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(storageKey));
      if (!draft || typeof draft !== 'object') return;
      if (typeof draft.company === 'string') $('company').value = draft.company.slice(0, 100);
      if (typeof draft.whatsapp === 'string') $('whatsapp').value = draft.whatsapp.slice(0, 24);
      if (Array.isArray(draft.selections)) {
        draft.selections.forEach((item) => {
          if (item && state.has(item.id) && ['image', 'video'].includes(item.format)) {
            state.set(item.id, { selected: true, format: item.format });
          }
        });
      }
    } catch { /* The page also works with browser storage disabled. */ }
  }

  function selections() {
    return [...state].filter(([, item]) => item.selected).map(([id, item]) => ({ id, format: item.format }));
  }

  function saveDraft() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        company: $('company').value,
        whatsapp: $('whatsapp').value,
        selections: selections()
      }));
    } catch { /* Storage is optional. */ }
  }

  function totalCents() {
    const selected = selections();
    let total = 0;
    for (const item of selected) {
      const value = config.prices?.[`${item.format}Cents`];
      if (!Number.isSafeInteger(value) || value < 0) return null;
      total += value;
    }
    return Number.isSafeInteger(total) ? total : null;
  }

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3300);
  }

  function clearCompletion() {
    submissionKey = null;
    if (!completed) return;
    completed = false;
    $('success-message').hidden = true;
    $('send-button').disabled = false;
    $('send-button').querySelector('span').textContent = 'Enviar';
  }

  function renderSummary() {
    const selected = selections();
    const images = selected.filter((item) => item.format === 'image').length;
    const videos = selected.length - images;
    const parts = [];
    if (images) parts.push(`${images} ${images === 1 ? 'imagem' : 'imagens'}`);
    if (videos) parts.push(`${videos} ${videos === 1 ? 'vídeo' : 'vídeos'}`);
    $('selection-summary').textContent = parts.join(' + ') || 'Escolha suas postagens';
    const total = totalCents();
    $('price').textContent = total === null ? 'A combinar' : new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency: 'BRL'
    }).format(total / 100);
  }

  function updateCard(id) {
    const item = state.get(id);
    const card = cards.get(id);
    card.article.classList.toggle('is-selected', item.selected);
    card.checkbox.checked = item.selected;
    card.buttons.forEach((button) => {
      const checked = button.dataset.format === item.format;
      button.setAttribute('aria-checked', String(checked));
      button.tabIndex = checked ? 0 : -1;
    });
    card.play.hidden = item.format !== 'video' || !card.post.video;
    card.preview.setAttribute('aria-label', `Ver ${item.format === 'video' && card.post.video ? 'vídeo' : 'imagem'}: ${card.post.title}, ${card.post.date}`);
    if (card.video && (item.format !== 'video' || !item.selected)) {
      card.video.pause();
      card.video.hidden = true;
      card.preview.hidden = false;
    }
  }

  function changeSelection(id, selected, format) {
    if (busy) return;
    clearCompletion();
    const item = state.get(id);
    item.selected = selected;
    if (format) item.format = format;
    updateCard(id);
    renderSummary();
    saveDraft();
    $('form-message').hidden = true;
  }

  function pauseVideos(except) {
    cards.forEach((card) => {
      if (card.video && card.video !== except) card.video.pause();
    });
  }

  function openPreview(post, source) {
    const format = state.get(post.id).format;
    const card = cards.get(post.id);
    if (format === 'video' && card.video) {
      pauseVideos(card.video);
      if (!card.video.getAttribute('src')) card.video.src = post.video;
      card.preview.hidden = true;
      card.video.hidden = false;
      card.video.focus({ preventScroll: true });
      card.video.play().catch(() => {
        // Native controls remain available if automatic playback is blocked.
      });
      return;
    }
    pauseVideos();
    const content = $('preview-content');
    content.replaceChildren();
    const media = element('img');
    media.src = post.image;
    media.alt = `${post.title} — ${post.date}`;
    content.append(media);
    lastPreviewFocus = source;
    $('preview-dialog').showModal();
    if (format === 'video') {
      const notice = element('span', 'preview-notice', 'Prévia em imagem');
      notice.setAttribute('role', 'status');
      content.append(notice);
    }
  }

  function buildGallery() {
    const fragment = document.createDocumentFragment();
    config.posts.forEach((post, index) => {
      const article = element('article', 'post-card');
      article.setAttribute('aria-label', `${post.date}: ${post.title}`);
      const top = element('div', 'card-top');
      const date = element('span', 'post-date', post.date);
      const label = element('label', 'select-label');
      const checkbox = element('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Selecionar ${post.title}, ${post.date}`);
      const mark = element('span', 'selection-mark');
      mark.setAttribute('aria-hidden', 'true');
      mark.append(icon('m5 12 4 4L19 6'));
      label.append(checkbox, mark);
      top.append(date, label);
      const previewMedia = element('div', 'preview-media');
      const preview = element('button', 'preview-button');
      preview.type = 'button';
      const image = element('img');
      image.src = post.image;
      image.alt = `${post.title} — ${post.date}`;
      image.width = 941;
      image.height = 1672;
      image.loading = index < 4 ? 'eager' : 'lazy';
      image.decoding = 'async';
      const play = element('span', 'play-mark');
      play.setAttribute('aria-hidden', 'true');
      play.append(icon('M6 3v18l16-9Z'));
      preview.append(image, play);
      previewMedia.append(preview);
      let video = null;
      if (post.video) {
        video = element('video', 'card-video');
        video.poster = post.image;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'none';
        video.hidden = true;
        video.tabIndex = 0;
        video.disablePictureInPicture = true;
        video.disableRemotePlayback = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('controlslist', 'nofullscreen nodownload noremoteplayback');
        video.setAttribute('aria-label', `Vídeo: ${post.title}, ${post.date}`);
        video.addEventListener('play', () => pauseVideos(video));
        video.addEventListener('error', () => {
          video.pause();
          video.hidden = true;
          preview.hidden = false;
          video.removeAttribute('src');
          video.load();
          toast('Não foi possível carregar o vídeo. Toque para tentar novamente.');
        });
        previewMedia.append(video);
      }
      const switcher = element('div', 'format-switch');
      switcher.setAttribute('role', 'radiogroup');
      switcher.setAttribute('aria-label', `Formato de ${post.title}`);
      const buttons = ['image', 'video'].map((format) => {
        const button = element('button', '', format === 'image' ? 'Imagem' : 'Vídeo');
        button.type = 'button';
        button.dataset.format = format;
        button.setAttribute('role', 'radio');
        button.addEventListener('click', () => changeSelection(post.id, true, format));
        switcher.append(button);
        return button;
      });
      switcher.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        if (busy) return;
        let format;
        if (event.key === 'Home') format = 'image';
        else if (event.key === 'End') format = 'video';
        else format = state.get(post.id).format === 'image' ? 'video' : 'image';
        changeSelection(post.id, true, format);
        buttons.find((button) => button.dataset.format === format).focus();
      });
      checkbox.addEventListener('change', () => changeSelection(post.id, checkbox.checked));
      preview.addEventListener('click', () => openPreview(post, preview));
      article.append(top, previewMedia, switcher);
      cards.set(post.id, { article, post, checkbox, preview, play, buttons, video });
      fragment.append(article);
      updateCard(post.id);
    });
    gallery.append(fragment);
  }

  function galleryMetrics() {
    const columns = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--columns'), 10) || 1;
    const gap = Number.parseFloat(getComputedStyle(gallery).columnGap) || 0;
    const step = gallery.clientWidth + gap;
    const pages = Math.max(1, Math.ceil(config.posts.length / columns));
    const page = Math.min(pages - 1, Math.round(gallery.scrollLeft / step));
    return { columns, step, pages, page };
  }

  function renderPagination() {
    const { pages, page } = galleryMetrics();
    $('page-number').textContent = `${page + 1} / ${pages}`;
    $('previous').disabled = page === 0;
    $('next').disabled = page === pages - 1;
  }

  function navigate(direction) {
    pauseVideos();
    const { step, page, pages } = galleryMetrics();
    gallery.scrollTo({ left: Math.max(0, Math.min(pages - 1, page + direction)) * step, behavior: 'smooth' });
  }

  function setPhotoError(message) {
    $('photos-error').textContent = message;
    $('photos-error').hidden = !message;
  }

  function renderPhotos() {
    $('photo-list').querySelectorAll('.photo-thumb').forEach((node) => node.remove());
    photos.forEach((photo) => {
      const figure = element('figure', 'photo-thumb');
      const image = element('img');
      image.src = photo.url;
      image.alt = photo.file.name;
      const remove = element('button', 'remove-photo', '×');
      remove.type = 'button';
      remove.disabled = busy;
      remove.setAttribute('aria-label', `Remover ${photo.file.name}`);
      remove.addEventListener('click', () => {
        if (busy) return;
        URL.revokeObjectURL(photo.url);
        photos.splice(photos.indexOf(photo), 1);
        clearCompletion();
        renderPhotos();
        setPhotoError('');
        $('add-photos').focus();
      });
      figure.append(image, remove);
      $('photo-list').append(figure);
    });
    $('add-photos').disabled = busy || photos.length >= maxFiles;
    $('add-photos').setAttribute('aria-label', photos.length >= maxFiles ? 'Limite de 12 fotos atingido' : 'Adicionar fotos da sua empresa');
  }

  function addPhotos(files) {
    const errors = [];
    for (const originalFile of files) {
      let file = originalFile;
      if (photos.some((photo) => photo.file.name === file.name && photo.file.size === file.size && photo.file.lastModified === file.lastModified)) continue;
      const allowedType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
      const allowedExtension = /\.(jpe?g|png|webp)$/i.test(file.name);
      if ((!allowedType && file.type !== '') || !allowedExtension) { errors.push('Use fotos JPG, PNG ou WebP.'); continue; }
      if (!file.type) {
        const extension = file.name.split('.').pop().toLowerCase();
        const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
        file = new File([file], file.name, { type, lastModified: file.lastModified });
      }
      if (!file.size || file.size > maxFileBytes) { errors.push('Cada foto pode ter até 10 MB.'); continue; }
      if (photos.length >= maxFiles) { errors.push('Você pode enviar até 12 fotos.'); break; }
      if (photos.reduce((total, photo) => total + photo.file.size, 0) + file.size > maxTotalBytes) { errors.push('As fotos juntas podem ter até 24 MB.'); continue; }
      photos.push({ file, url: URL.createObjectURL(file) });
    }
    clearCompletion();
    renderPhotos();
    setPhotoError([...new Set(errors)].join(' '));
    $('photos').value = '';
  }

  function phoneDigits() {
    const digits = $('whatsapp').value.replace(/\D/g, '');
    return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  }

  function setFieldError(id, message) {
    $(`${id}-error`).textContent = message;
    $(`${id}-error`).hidden = !message;
    $(id).setAttribute('aria-invalid', String(Boolean(message)));
  }

  function formError(message) {
    $('form-message').textContent = message;
    $('form-message').hidden = false;
    $('form-message').focus({ preventScroll: true });
    $('form-message').scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function validate() {
    let valid = true;
    const company = $('company').value.trim();
    const rawPhone = $('whatsapp').value.trim();
    const phone = phoneDigits();
    const companyError = company.length < 2 ? 'Informe o nome da empresa.' : '';
    const phoneError = phone.length < 12 || phone.length > 15 || !/^[+\d\s().-]+$/.test(rawPhone) ? 'Informe um WhatsApp válido, com DDD.' : '';
    setFieldError('company', companyError);
    setFieldError('whatsapp', phoneError);
    if (!selections().length) {
      formError('Escolha pelo menos uma postagem.');
      cards.values().next().value?.checkbox.focus();
      valid = false;
    } else if (companyError || phoneError) {
      $(companyError ? 'company' : 'whatsapp').focus();
      valid = false;
    }
    return valid;
  }

  function setBusy(value) {
    busy = value;
    $('order-form').setAttribute('aria-busy', String(value));
    $('send-button').disabled = value || completed;
    $('send-button').querySelector('span').textContent = value ? 'Enviando…' : completed ? 'Pronto' : 'Enviar';
    ['company', 'whatsapp', 'photos'].forEach((id) => { $(id).disabled = value; });
    cards.forEach((card) => {
      card.checkbox.disabled = value;
      card.buttons.forEach((button) => { button.disabled = value; });
    });
    renderPhotos();
  }

  function safeRemoteUrl(raw, whatsappOnly = false) {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return null;
      if (whatsappOnly && !['wa.me', 'api.whatsapp.com', 'web.whatsapp.com'].includes(url.hostname)) return null;
      return url.href;
    } catch { return null; }
  }

  async function sendOrder(event) {
    event.preventDefault();
    if (busy || completed) return;
    $('form-message').hidden = true;
    if (!validate()) return;
    if (!config.submitEndpoint) {
      formError('O envio ainda não está disponível. Suas escolhas estão salvas neste navegador.');
      return;
    }
    const data = {
      campaignId: config.campaignId,
      company: $('company').value.trim(),
      whatsapp: phoneDigits(),
      selections: selections(),
      totalCents: totalCents()
    };
    const body = new FormData();
    body.append('data', JSON.stringify(data));
    body.append('website', $('website').value);
    photos.forEach((photo) => body.append('photos', photo.file, photo.file.name));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    if (!submissionKey) {
      submissionKey = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
    }
    setBusy(true);
    try {
      const response = await fetch(config.submitEndpoint, {
        method: 'POST', body, headers: { 'Idempotency-Key': submissionKey },
        signal: controller.signal, credentials: 'omit', cache: 'no-store'
      });
      let result;
      try { result = await response.json(); } catch { result = null; }
      if (!response.ok) {
        const message = response.status === 413 ? 'As fotos excedem o limite do envio. Remova uma foto e tente novamente.'
          : response.status === 429 ? 'Muitos envios em pouco tempo. Aguarde alguns minutos e tente novamente.'
          : 'Não foi possível enviar agora. Suas escolhas e fotos continuam aqui; tente novamente.';
        throw new Error(message);
      }
      if (!result || typeof result.orderId !== 'string' || !result.orderId.trim()) {
        throw new Error('Não foi possível confirmar o recebimento. Tente novamente em alguns instantes.');
      }
      completed = true;
      $('success-message').hidden = false;
      $('order-reference').textContent = photos.length ? 'Fotos salvas. Envie a mensagem no WhatsApp.' : 'Envie a mensagem no WhatsApp.';
      const whatsappUrl = safeRemoteUrl(result.whatsappUrl, true);
      $('success-whatsapp').hidden = !whatsappUrl;
      if (whatsappUrl) $('success-whatsapp').href = whatsappUrl;
      let emailUrl = null;
      try { const url = new URL(result.emailUrl); if (url.protocol === 'mailto:') emailUrl = url.href; } catch { /* No email destination. */ }
      $('success-email').hidden = !emailUrl;
      if (emailUrl) $('success-email').href = emailUrl;
      const receiptUrl = safeRemoteUrl(result.receiptUrl);
      $('receipt-link').hidden = !receiptUrl;
      if (receiptUrl) $('receipt-link').href = receiptUrl;
      try { localStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
      $('success-message').focus({ preventScroll: true });
      $('success-message').scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (error) {
      formError(error.name === 'AbortError'
        ? 'O envio demorou mais que o esperado e não pudemos confirmar o recebimento. Tente novamente em alguns instantes.'
        : error instanceof TypeError ? 'Sem conexão com o envio. Confira sua internet e tente novamente.'
        : error.message || 'Não foi possível enviar. Tente novamente.');
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  }

  $('month').textContent = config.month;
  readDraft();
  buildGallery();
  renderSummary();
  renderPagination();
  $('previous').addEventListener('click', () => navigate(-1));
  $('next').addEventListener('click', () => navigate(1));
  gallery.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(renderPagination);
  }, { passive: true });
  gallery.addEventListener('keydown', (event) => {
    if (event.target !== gallery || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    navigate(event.key === 'ArrowLeft' ? -1 : 1);
  });
  new ResizeObserver(renderPagination).observe(gallery);
  const visiblePreviews = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.intersectionRatio < 0.25) entry.target.pause();
    });
  }, { root: gallery, threshold: 0.25 });
  cards.forEach((card) => { if (card.video) visiblePreviews.observe(card.video); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pauseVideos();
  });
  $('add-photos').addEventListener('click', () => $('photos').click());
  $('photos').addEventListener('change', () => addPhotos([...$('photos').files]));
  $('upload-details').setAttribute('aria-expanded', 'false');
  $('upload-details').setAttribute('aria-controls', 'upload-limits');
  $('upload-details').addEventListener('click', () => {
    $('upload-limits').hidden = !$('upload-limits').hidden;
    $('upload-details').setAttribute('aria-expanded', String(!$('upload-limits').hidden));
  });
  ['company', 'whatsapp'].forEach((id) => $(id).addEventListener('input', () => {
    clearCompletion();
    setFieldError(id, '');
    $('form-message').hidden = true;
    saveDraft();
  }));
  $('order-form').addEventListener('submit', sendOrder);
  $('close-preview').addEventListener('click', () => $('preview-dialog').close());
  $('preview-dialog').addEventListener('close', () => {
    $('preview-content').replaceChildren();
    lastPreviewFocus?.focus({ preventScroll: true });
  });
  $('open-privacy').addEventListener('click', () => $('privacy-dialog').showModal());
  $('close-privacy').addEventListener('click', () => $('privacy-dialog').close());
  [$('preview-dialog'), $('privacy-dialog')].forEach((dialog) => dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  }));
  $('clear-draft').addEventListener('click', () => {
    if (busy) return;
    try { localStorage.removeItem(storageKey); } catch { /* Optional storage. */ }
    state.forEach((item, id) => { item.selected = false; item.format = 'image'; updateCard(id); });
    $('company').value = '';
    $('whatsapp').value = '';
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    photos.length = 0;
    renderPhotos();
    renderSummary();
    clearCompletion();
    setFieldError('company', '');
    setFieldError('whatsapp', '');
    setPhotoError('');
    $('form-message').hidden = true;
    $('privacy-dialog').close();
    toast('Rascunho apagado');
  });
  window.addEventListener('beforeunload', () => photos.forEach((photo) => URL.revokeObjectURL(photo.url)));
})();
