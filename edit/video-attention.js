// Observation only: this module never starts, pauses, seeks or changes a video.
const VIEW_SECONDS = 2;
const HEARTBEAT_SECONDS = 10;
const MAX_SAMPLE_GAP_MS = 2500;
const installations = new WeakMap();
const rounded = value => Math.round(Math.max(0,value) * 1000) / 1000;
const finite = value => Number.isFinite(value) ? value : 0;

function identity(video) {
  return {
    videoId:String(video.videoId || '').slice(0,100),
    videoTitle:String(video.videoTitle || '').slice(0,100),
    recipe:String(video.recipe || '').slice(0,100),
    feedPosition:Math.max(1,Math.floor(finite(video.feedPosition))),
  };
}

function watchedSeconds(before,after,elapsed) {
  if (!before?.playing || !after || before.readyState < 3 || after.readyState < 3 ||
      before.seeking || after.seeking || before.playbackRate <= 0) return 0;
  const rate = before.playbackRate;
  if (rate !== after.playbackRate) return 0;
  let movement = after.position - before.position;
  const expected = elapsed * rate;
  if (movement < 0 && before.loop && before.duration > 0 &&
      before.position >= before.duration - expected - .25 && after.position <= expected + .25) {
    movement += before.duration;
  }
  // Large jumps are seeks, not watched time. Seeking events also reset the baseline.
  if (movement <= 0 || movement > expected + .25) return 0;
  return Math.min(elapsed,movement / rate);
}

/** Pure accounting core. `key` is an opaque identity, not an emitted parameter.
 * `previous` is the outgoing video's current media snapshot at a transition.
 * View/last events carry no duration totals; only time events are additive.
 */
export function createVideoAttentionTracker({send = () => {}} = {}) {
  let active = null,last = null,lastNow = null,terminalReported = false;
  const emit = (name,detail) => {try {send(name,detail);} catch { /* Measurement cannot affect browsing. */ }};
  const details = item => ({...item.identity,videoPositionSeconds:rounded(finite(item.snapshot.position))});

  function flush(reason) {
    if (!active || rounded(active.visible) <= 0) return;
    emit('edit_video_time',{
      ...details(active),visibleSeconds:rounded(active.visible),watchSeconds:rounded(active.watched),reason,
    });
    active.visible = 0;active.watched = 0;
  }

  function observe({now,video = null,previous = null,reason = 'not_visible'}) {
    if (!Number.isFinite(now)) return;
    const same = active && video?.key === active.key;
    if (active) {
      const endpoint = previous || (same ? video : null) || active.snapshot;
      const gap = now - lastNow;
      // A suspended/throttled callback must not turn a long absence into attention.
      const elapsed = gap > 0 && gap <= MAX_SAMPLE_GAP_MS ? gap / 1000 : 0;
      if (elapsed > 0) {
        active.visible += elapsed;
        active.totalVisible += elapsed;
        active.watched += watchedSeconds(active.snapshot,endpoint,elapsed);
        terminalReported = false;
      }
      active.snapshot = endpoint;
      if (!active.viewed && active.totalVisible >= VIEW_SECONDS) {
        active.viewed = true;
        emit('edit_video_view',details(active));
      }
      if (rounded(active.totalVisible) > 0) last = details(active);
      if (!same) {
        flush(video ? 'switch' : reason);
        active = null;
      } else if (active.visible >= HEARTBEAT_SECONDS) flush('heartbeat');
    }
    if (video) {
      if (!active) active = {
        key:video.key,identity:identity(video),snapshot:video,
        visible:0,watched:0,totalVisible:0,viewed:false,
      };
      else active.snapshot = video;
    }
    lastNow = now;
  }

  function suspend({now,previous = null,reason}) {
    observe({now,previous,reason});
    if (last && !terminalReported) {
      terminalReported = true;
      emit('edit_video_last',{...last,reason});
    }
  }

  function reset() {active = null;last = null;lastNow = null;terminalReported = false;}
  return {observe,suspend,reset};
}

/** Fraction of the card's area clipped by both the feed and the viewport. */
export function videoVisibilityRatio(card,feed,viewport) {
  if (!card || !feed || !viewport) return 0;
  const area = (card.right - card.left) * (card.bottom - card.top);
  if (!(area > 0)) return 0;
  const width = Math.max(0,Math.min(card.right,feed.right,viewport.right) - Math.max(card.left,feed.left,viewport.left));
  const height = Math.max(0,Math.min(card.bottom,feed.bottom,viewport.bottom) - Math.max(card.top,feed.top,viewport.top));
  return width * height / area;
}

export function installVideoAttention({win = globalThis.window,doc = globalThis.document,send = () => {}} = {}) {
  if (!win || !doc) return {setConsent() {}};
  if (installations.has(doc)) return installations.get(doc);
  const tracker = createVideoAttentionTracker({send});
  let enabled = false,exited = false,timer = null,observer = null,intersection = null,lastCard = null;
  let playback = new WeakMap();
  const removers = [];
  let observed = new WeakSet();
  const now = () => win.performance?.now?.() ?? Date.now();
  const query = selector => doc.querySelector(selector);
  const safely = callback => (...args) => {if (enabled) {try {callback(...args);} catch { /* Never interrupt the storefront. */ }}};

  function listen(target,type,handler,options) {
    if (!target?.addEventListener) return;
    const safe = safely(handler);
    target.addEventListener(type,safe,options);
    removers.push(() => target.removeEventListener?.(type,safe,options));
  }

  function snapshot(card,position) {
    if (!card) return null;
    const video = card.querySelector('video');
    if (!video) return null;
    return {
      key:card,videoId:card.dataset.id,videoTitle:card.dataset.title,recipe:card.dataset.recipe,
      feedPosition:position,position:finite(video.currentTime),duration:finite(video.duration),
      playbackRate:Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
      loop:video.loop === true,readyState:finite(video.readyState),seeking:video.seeking === true,
      playing:!video.paused && !video.ended && playback.get(video) !== false,
    };
  }

  function displayed(element) {
    if (!element || element.hidden) return false;
    const style = win.getComputedStyle?.(element);
    return !style || (style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.opacity !== '0');
  }

  function sample(terminalReason) {
    const at = now();
    const previous = snapshot(lastCard);
    if (terminalReason || doc.hidden || exited) {
      tracker.suspend({now:at,previous,reason:terminalReason || (exited ? 'page_exit' : 'page_hidden')});
      lastCard = null;
      return;
    }
    const view = query('#feed-view'),feed = query('#feed');
    let chosen = null,reason = 'not_visible';
    if (!displayed(view)) reason = 'profile';
    else if (query('#personalize-dialog')?.open || query('#about-dialog')?.open) reason = 'modal';
    else if (displayed(feed)) {
      const viewport = win.visualViewport;
      const left = finite(viewport?.offsetLeft),top = finite(viewport?.offsetTop);
      const bounds = {left,top,right:left + (viewport?.width || win.innerWidth || doc.documentElement.clientWidth),
        bottom:top + (viewport?.height || win.innerHeight || doc.documentElement.clientHeight)};
      const feedRect = feed.getBoundingClientRect(),viewRect = view.getBoundingClientRect();
      const clip = {left:Math.max(feedRect.left,viewRect.left),right:Math.min(feedRect.right,viewRect.right),
        top:Math.max(feedRect.top,viewRect.top),bottom:Math.min(feedRect.bottom,viewRect.bottom)};
      let highest = .65;
      const cards = [...feed.querySelectorAll('.video-card')];
      cards.forEach((card,index) => {
        if (intersection && !observed.has(card)) {intersection.observe(card);observed.add(card);}
        if (!displayed(card) || !displayed(card.querySelector('video'))) return;
        const ratio = videoVisibilityRatio(card.getBoundingClientRect(),clip,bounds);
        if (ratio >= highest) {
          const candidate = snapshot(card,index + 1);
          if (candidate?.videoId) {chosen = candidate;highest = ratio;}
        }
      });
    }
    tracker.observe({now:at,video:chosen,previous,reason});
    lastCard = chosen?.key || null;
  }

  function setConsent(choice) {
    if (choice !== 'granted') {
      // Revocation discards unsent measurements without a final flush or replay.
      enabled = false;
      if (timer !== null) win.clearInterval?.(timer);
      timer = null;observer?.disconnect();intersection?.disconnect();observer = null;intersection = null;
      removers.splice(0).forEach(remove => remove());
      tracker.reset();playback = new WeakMap();observed = new WeakSet();lastCard = null;exited = false;
      return;
    }
    if (enabled) return;
    enabled = true;
    // Snapshot the outgoing timeline before lazy media release resets currentTime.
    listen(doc,'ia4tube:edit-before-media-change',() => sample());
    listen(doc,'visibilitychange',() => sample(doc.hidden ? 'page_hidden' : undefined));
    listen(win,'pagehide',() => {sample('page_exit');exited = true;});
    listen(win,'pageshow',() => {exited = false;sample();});
    listen(doc,'scroll',() => sample(),{capture:true,passive:true});
    listen(win,'resize',() => sample(),{passive:true});
    listen(win.visualViewport,'resize',() => sample(),{passive:true});
    listen(win.visualViewport,'scroll',() => sample(),{passive:true});
    for (const type of ['playing','pause','waiting','stalled','seeking','seeked','ended','ratechange']) {
      listen(doc,type,event => {
        const video = event.target;
        if (video?.tagName !== 'VIDEO' || !video.closest?.('#feed .video-card')) return;
        sample();
        if (type === 'playing') playback.set(video,true);
        else if (type === 'seeked') playback.delete(video);
        else if (type !== 'ratechange') playback.set(video,false);
        // Reset the watch baseline after media state changes, without adding time.
        sample();
      },true);
    }
    if (win.IntersectionObserver) intersection = new win.IntersectionObserver(safely(() => sample()),{threshold:[0,.65,1]});
    if (win.MutationObserver && doc.documentElement) {
      observer = new win.MutationObserver(safely(records => {
        // Ignore order fields and the playback progress bar, updated every frame.
        if (records.some(({target}) => target === doc.documentElement || target === doc.body ||
          ['feed','feed-view','personalize-dialog','about-dialog'].includes(target.id) ||
          target.matches?.('.video-card, .video-card video'))) sample();
      }));
      observer.observe(doc.documentElement,{subtree:true,childList:true,attributes:true,
        attributeFilter:['hidden','open','class','style','data-id','data-title','data-recipe']});
    }
    if (win.setInterval) timer = win.setInterval(safely(() => sample()),1000);
    safely(() => sample())();
  }

  const controller = {setConsent};
  installations.set(doc,controller);
  return controller;
}
