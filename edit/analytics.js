import {createEditMeasurement,isPublicEdit,pageContext,readConsent,saveConsent} from './analytics-core.js?v=20261022-video-attention';
import {installVideoAttention} from './video-attention.js?v=20261022-video-attention';

// Dedicated GA4 property: iA4tube Edit. No connection to the app/mascot property.
export const MEASUREMENT_ID = 'G-SXXCEQ97J5';
const DENIED = {analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'};

export function installAnalytics(win = window,doc = document) {
  const allowed = isPublicEdit(win.location.href);
  if (!allowed && !['localhost','127.0.0.1'].includes(win.location.hostname)) return;
  if (doc.querySelector('#edit-stats-choice')) return;
  let storage;
  try {storage = win.localStorage;} catch { /* Measurement can run without local storage. */ }
  const context = pageContext(win.location.href,doc.referrer);
  const privacySignal = win.navigator.globalPrivacyControl === true || win.navigator.doNotTrack === '1';
  let started = false,choice = privacySignal ? 'denied' : readConsent(storage);
  const disableKey = 'ga-disable-' + MEASUREMENT_ID;
  win[disableKey] = true;
  function tag() {win.dataLayer.push(arguments);}
  function startGoogle() {
    if (!allowed || started) return;
    win.dataLayer = win.dataLayer || [];
    tag('consent','default',DENIED);
    tag('consent','update',{...DENIED,analytics_storage:'granted'});
    tag('set','ads_data_redaction',true);
    tag('set','url_passthrough',false);
    tag('js',new Date());
    tag('config',MEASUREMENT_ID,{...context,send_page_view:false,allow_google_signals:false,
      allow_ad_personalization_signals:false,cookie_prefix:'ia4tube_edit',cookie_path:'/edit',cookie_expires:15552000});
    const script = doc.createElement('script');
    script.id = 'edit-google-analytics';script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + MEASUREMENT_ID;
    script.onerror = () => {doc.documentElement.dataset.editAnalytics = 'blocked';};
    doc.head.append(script);started = true;
  }
  const measurement = createEditMeasurement({allowed,storage,context,
    send:(name,params) => tag('event',name,{...params,send_to:MEASUREMENT_ID})});
  let attention;
  try {attention = installVideoAttention({win,doc,send:(name,detail) => measurement.video(name,detail)});} catch { /* Optional observer cannot affect existing measurement. */ }
  const banner = doc.createElement('section');
  banner.id = 'edit-stats-choice';banner.className = 'edit-stats-choice';banner.hidden = true;
  banner.setAttribute('aria-label','Privacidade das estatísticas');
  banner.innerHTML = '<p><strong>Podemos medir as visitas?</strong>Usamos cookies do Google Analytics para medir acessos, origens, vídeos vistos e pedidos salvos. Sua escolha não interfere no pedido. <a href="https://ia4tube.com/politica-de-privacidade/" target="_blank" rel="noopener noreferrer">Privacidade</a></p><div class="edit-stats-actions"><button type="button" data-choice="denied">Recusar</button><button type="button" data-choice="granted">Permitir</button></div>';
  doc.body.append(banner);
  const settings = doc.createElement('button');
  settings.type = 'button';settings.className = 'edit-stats-settings';settings.textContent = 'Privacidade das estatísticas';
  const status = doc.createElement('p');status.className = 'edit-stats-status';status.setAttribute('role','status');
  const explanation = doc.createElement('p');explanation.className = 'edit-stats-status';
  explanation.innerHTML = 'Com sua permissão, medimos visitas, origem, vídeos vistos, tempo de permanência e pedidos salvos pelo Google Analytics. Não enviamos nomes de clientes, contatos, textos do pedido ou imagens para essa medição. Você pode mudar sua escolha aqui. <a href="https://policies.google.com/technologies/partner-sites?hl=pt-BR" target="_blank" rel="noopener noreferrer">Como o Google usa esses dados</a>.';
  doc.querySelector('#about-dialog')?.append(settings,status,explanation);
  function clearCookies() {
    try {
      for (const cookie of doc.cookie.split(';')) {
        const name = cookie.split('=')[0].trim();
        if (!/^ia4tube_edit_ga(?:_|$)/.test(name)) continue;
        for (const domain of ['',`; domain=${win.location.hostname}`,`; domain=.${win.location.hostname}`,'; domain=.ia4tube.com']) {
          doc.cookie = `${name}=; Max-Age=0; path=/edit${domain}; SameSite=Lax; Secure`;
        }
      }
    } catch {}
  }
  function applyChoice(next,persist = false) {
    choice = privacySignal ? 'denied' : next;
    if (persist) saveConsent(storage,choice);
    win[disableKey] = choice !== 'granted';
    if (choice !== 'granted') {
      measurement.setConsent('denied');
      try {attention?.setConsent('denied');} catch {}
    }
    if (choice === 'granted') {
      if (started) tag('consent','update',{...DENIED,analytics_storage:'granted'});
      else startGoogle();
    } else {
      try {if (started) tag('consent','update',DENIED);} catch {}
      finally {clearCookies();}
    }
    measurement.setConsent(choice);
    try {attention?.setConsent(allowed ? choice : 'denied');} catch {}
    banner.hidden = choice !== null;
    status.textContent = privacySignal ? 'Estatísticas desativadas pela preferência do seu navegador.' : choice === 'granted' ? 'Estatísticas permitidas neste navegador.' : choice === 'denied' ? 'Estatísticas recusadas neste navegador.' : 'Estatísticas ainda não permitidas.';
    doc.documentElement.dataset.editAnalytics = choice === 'granted' ? (allowed ? 'enabled' : 'local-preview') : choice === 'denied' ? 'disabled' : 'consent-required';
  }
  banner.querySelectorAll('[data-choice]').forEach(button => button.addEventListener('click',() => {
    try {applyChoice(button.dataset.choice,true);} catch {banner.hidden = true;}
  }));
  settings.addEventListener('click',() => {
    if (privacySignal) return;
    doc.querySelector('#about-dialog')?.close();banner.hidden = false;banner.querySelector('button')?.focus();
  });
  doc.addEventListener('ia4tube:edit-order-open',event => {try {measurement.open(event.detail);} catch {}});
  doc.addEventListener('ia4tube:edit-order-saved',event => {try {measurement.saved(event.detail);} catch {}});
  win.addEventListener('storage',event => {if (event.key === null || event.key === 'ia4tube.edit.analytics-consent.v1') {try {applyChoice(readConsent(storage));} catch {}}});
  applyChoice(choice);
}

// A separate script entry keeps even a module/network error out of the storefront.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {installAnalytics();} catch { /* Browsing and checkout remain available. */ }
}
