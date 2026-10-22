// A one-time visual cue only: it never scrolls, changes media or sends events.
export function createSwipeGuide({
  feed,hint,getContext,motionQuery,
  doc = globalThis.document,win = globalThis.window,
  setTimer = setTimeout,clearTimer = clearTimeout,
} = {}) {
  const removers = [];
  let waiting = null,returning = null,finishing = null,pair = null,painted = null,baseline = 0;
  let done = false,destroyed = false;
  const position = () => Number.isFinite(feed?.scrollTop) ? feed.scrollTop : 0;
  const context = () => {try {return getContext?.();} catch {return null;}};
  const usable = card => card?.classList && card?.style && card.isConnected !== false;
  const eligible = value => !doc?.hidden && !motionQuery?.matches && value?.enabled === true &&
    feed && hint && Number.isFinite(feed.clientHeight) && feed.clientHeight > 0 &&
    usable(value.current) && usable(value.next) && value.current !== value.next;
  const same = value => eligible(value) && pair?.current === value.current && pair?.next === value.next;

  function listen(target,type,handler,options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type,handler,options);
    removers.push(() => target.removeEventListener?.(type,handler,options));
  }
  function detach() {removers.splice(0).forEach(remove => remove());}
  function clean() {
    if (waiting !== null) clearTimer(waiting);
    if (returning !== null) clearTimer(returning);
    if (finishing !== null) clearTimer(finishing);
    waiting = null;returning = null;finishing = null;
    if (painted) for (const card of [painted.current,painted.next]) {
      card.classList.remove('swipe-guide-card');
      card.classList.remove('is-returning');
      card.style.removeProperty('--swipe-guide-lift');
    }
    painted = null;pair = null;
    if (hint) {
      hint.hidden = true;hint.classList.remove('is-active');hint.classList.remove('is-returning');
      hint.style.removeProperty('--swipe-guide-lift');
    }
  }
  function cancel() {done = true;clean();detach();}

  function start() {
    waiting = null;
    if (destroyed || done || !same(context()) || Math.abs(position() - baseline) >= 2) {
      cancel();return;
    }
    done = true;painted = pair;
    const lift = `${Math.min(36,feed.clientHeight * .06)}px`;
    for (const card of [pair.current,pair.next]) {
      card.style.setProperty('--swipe-guide-lift',lift);
      card.classList.add('swipe-guide-card');
    }
    hint.style.setProperty('--swipe-guide-lift',lift);
    hint.hidden = false;
    // Establish the visible element's initial style before the CSS transition.
    void hint.offsetHeight;
    hint.classList.add('is-active');
    returning = setTimer(() => {
      returning = null;
      if (!painted) return;
      for (const card of [painted.current,painted.next]) card.classList.add('is-returning');
      hint.classList.add('is-returning');
    },1100);
    finishing = setTimer(() => {clean();detach();},1800);
  }

  function schedule() {
    if (destroyed) return;
    if (waiting !== null || painted) {
      if (!same(context())) cancel();
      return;
    }
    if (done) return;
    const value = context();
    if (!eligible(value)) return;
    pair = {current:value.current,next:value.next};baseline = position();
    waiting = setTimer(start,2000);
  }

  // Taps (including sound and pause) never cancel or postpone the cue.
  // Only actual scrolling or leaving the feed ends the invitation.
  listen(feed,'scroll',() => {
    // Initial scrollTo can dispatch asynchronously with an unchanged position.
    if (pair && Math.abs(position() - baseline) >= 2) cancel();
  },{passive:true});
  listen(doc,'visibilitychange',() => {if (doc.hidden) cancel();});
  for (const type of ['hashchange','pagehide','resize']) listen(win,type,cancel,{passive:true});
  if (motionQuery?.addEventListener) listen(motionQuery,'change',() => {if (motionQuery.matches) cancel();});
  else if (motionQuery?.addListener) {
    const changed = () => {if (motionQuery.matches) cancel();};
    motionQuery.addListener(changed);removers.push(() => motionQuery.removeListener?.(changed));
  }
  return {schedule,cancel,destroy() {destroyed = true;cancel();}};
}
