// Recognize the user's swipe without scrolling, changing media or blocking input.
export function createSwipeSound({
  feed,onSwipe,canAttempt = () => true,
  doc = globalThis.document,win = globalThis.window,
} = {}) {
  const removers = [];
  let touch = null,pointer = null,pendingClick = null,destroyed = false;
  const trusted = event => event?.isTrusted === true;
  const position = point => Number.isFinite(point?.clientX) && Number.isFinite(point?.clientY);
  const allowed = () => {
    if (destroyed || doc?.hidden) return false;
    try {return canAttempt() === true;} catch {return false;}
  };
  const inside = target => !!target && !!feed?.contains?.(target);
  function origin(event) {
    const target = event.target?.nodeType === 3 ? event.target.parentElement : event.target;
    if (!inside(target) || target.isContentEditable || target.closest?.('button,a,input,select,textarea,[contenteditable]:not([contenteditable="false"])')) return null;
    return target;
  }
  function listen(target,type,handler) {
    if (!target?.addEventListener) return;
    const options = {passive:true};
    target.addEventListener(type,handler,options);
    removers.push(() => target.removeEventListener?.(type,handler,options));
  }
  function cancel() {touch = null;pointer = null;pendingClick = null;}
  function begin(point,target,id) {
    return {id,target,startX:point.clientX,startY:point.clientY,x:point.clientX,y:point.clientY};
  }
  function update(track,point) {
    if (!position(point)) return false;
    track.x = point.clientX;track.y = point.clientY;return true;
  }
  function finish(track,event,point) {
    if (!track || !trusted(event) || !update(track,point) || !allowed()) return;
    const dx = Math.abs(track.x - track.startX),dy = Math.abs(track.y - track.startY);
    if (dy < 12 || dy < dx) return;
    pendingClick = Number.isFinite(event.timeStamp) ? {target:track.target,at:event.timeStamp} : null;
    // Keep this callback in the trusted input handler's stack for audio activation.
    onSwipe?.(event);
  }
  function findTouch(list,id) {return Array.from(list || []).find(point => point.identifier === id);}

  listen(feed,'touchstart',event => {
    pendingClick = null;touch = null;pointer = null;
    if (!trusted(event) || event.touches?.length !== 1 || !allowed()) return;
    const point = event.touches[0],target = origin(event);
    if (target && position(point)) touch = begin(point,target,point.identifier);
  });
  // Another finger can begin outside the feed: discard the whole gesture.
  listen(win,'touchstart',event => {if (trusted(event) && event.touches?.length !== 1) cancel();});
  listen(win,'touchmove',event => {
    if (!touch || !trusted(event)) return;
    const point = findTouch(event.touches,touch.id);
    if (event.touches?.length !== 1 || !point || !update(touch,point)) cancel();
  });
  listen(win,'touchend',event => {
    const track = touch;touch = null;
    if (!track || event.touches?.length !== 0) return;
    const point = findTouch(event.changedTouches,track.id);
    if (point) finish(track,event,point);
  });
  listen(win,'touchcancel',cancel);

  listen(feed,'pointerdown',event => {
    if (event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    pendingClick = null;pointer = null;
    if (!trusted(event) || event.isPrimary === false || event.button !== 0 || touch || !allowed()) return;
    const target = origin(event);
    if (target && position(event)) pointer = begin(event,target,event.pointerId);
  });
  listen(win,'pointermove',event => {
    if (!pointer || !trusted(event) || event.pointerType === 'touch') return;
    if (event.pointerId === pointer.id && !update(pointer,event)) pointer = null;
  });
  listen(win,'pointerup',event => {
    if (!pointer || event.pointerType === 'touch' || event.pointerId !== pointer.id) return;
    const track = pointer;pointer = null;finish(track,event,event);
  });
  // Native touch scrolling cancels its pointer stream, not its touch stream.
  listen(win,'pointercancel',event => {
    if (pointer && event.pointerType !== 'touch' && event.pointerId === pointer.id) {pointer = null;pendingClick = null;}
  });
  listen(doc,'visibilitychange',() => {if (doc.hidden) cancel();});
  listen(win,'pagehide',cancel);

  function consumeClick(event) {
    if (event?.type !== 'click') return false;
    const pending = pendingClick;pendingClick = null;
    if (!pending || !trusted(event) || !Number.isFinite(event.timeStamp)) return false;
    const age = event.timeStamp - pending.at,target = event.target;
    if (age < 0 || age > 500 || !inside(target)) return false;
    return target === pending.target || !!pending.target.contains?.(target) || !!target.contains?.(pending.target);
  }
  return {consumeClick,destroy() {destroyed = true;cancel();removers.splice(0).forEach(remove => remove());}};
}
