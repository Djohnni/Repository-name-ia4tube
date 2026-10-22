// Keep media resources bounded independently of playback and audio preferences.
export function createMediaWindow({
  cancel = () => {},
  source = video => video.dataset?.src,
  poster = video => video.dataset?.poster,
} = {}) {
  const states = new WeakMap();
  let managed = new Set();
  const safely = callback => {try {return callback();} catch {return undefined;}};
  const attribute = (video,name) => safely(() => video.getAttribute(name)) ?? null;
  const usable = video => video && typeof video === 'object' && typeof video.getAttribute === 'function' &&
    typeof video.setAttribute === 'function' && typeof video.removeAttribute === 'function' && typeof video.load === 'function';
  const value = callback => {const result = safely(callback);return typeof result === 'string' ? result.trim() : '';};

  function stateFor(video) {
    if (!states.has(video)) states.set(video,{resident:false,source:'',position:0,positionSource:'',generation:0,restore:null});
    return states.get(video);
  }

  function preload(video,next) {
    if (video.preload !== next) safely(() => {video.preload = next;});
  }

  function setAttribute(video,name,next) {
    if (next) {
      if (attribute(video,name) !== next) safely(() => video.setAttribute(name,next));
    } else if (attribute(video,name) !== null) safely(() => video.removeAttribute(name));
  }

  function forgetRestore(video,state) {
    state.generation++;
    if (state.restore) safely(() => video.removeEventListener('loadedmetadata',state.restore));
    state.restore = null;
  }

  function remember(video,state) {
    // An unload before metadata must retain the pending restore, not its temporary zero.
    if (state.restore) return;
    const current = safely(() => video.currentTime);
    if (Number.isFinite(current) && current >= 0) {
      state.position = current;
      state.positionSource = attribute(video,'src') || state.source || '';
    }
  }

  function stop(video) {
    safely(() => cancel(video));
    safely(() => video.pause());
  }

  function unload(video) {
    const state = stateFor(video);
    const heldSource = state.resident || attribute(video,'src') !== null;
    if (heldSource) remember(video,state);
    forgetRestore(video,state);
    if (heldSource) stop(video);
    setAttribute(video,'src','');setAttribute(video,'poster','');preload(video,'none');
    state.resident = false;
    if (heldSource) safely(() => video.load());
  }

  function load(video,nextSource,nextPoster,nextPreload) {
    const state = stateFor(video),currentSource = attribute(video,'src');
    if (state.resident && state.source === nextSource && currentSource === nextSource) {
      preload(video,nextPreload);setAttribute(video,'poster',nextPoster);
      if (state.restore && video.readyState >= 1) state.restore();
      return;
    }
    if (state.resident || currentSource !== null) {remember(video,state);stop(video);}
    forgetRestore(video,state);
    const restorePosition = state.positionSource === nextSource ? state.position : 0;
    state.source = nextSource;state.resident = true;
    state.position = restorePosition;state.positionSource = nextSource;
    const generation = state.generation;
    if (restorePosition > 0) {
      const restore = () => {
        if (state.generation !== generation || !state.resident || state.restore !== restore ||
            attribute(video,'src') !== nextSource || video.readyState < 1) return;
        const duration = video.duration;
        const position = Number.isFinite(duration) && duration >= 0 ? Math.min(restorePosition,duration) : restorePosition;
        try {video.currentTime = position;} catch {return;}
        state.position = position;
        safely(() => video.removeEventListener('loadedmetadata',restore));
        state.restore = null;
      };
      state.restore = restore;
      safely(() => video.addEventListener('loadedmetadata',restore));
    }
    preload(video,nextPreload);setAttribute(video,'poster',nextPoster);setAttribute(video,'src',nextSource);
    try {video.load();} catch {state.resident = false;forgetRestore(video,state);}
  }

  function sync(videos,activeIndex,{visible = true} = {}) {
    let list;
    try {list = Array.from(videos || []);} catch {list = [];}
    const next = new Set(list.filter(usable));
    const active = visible && Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < list.length && usable(list[activeIndex]);
    const wanted = new Map();
    if (active) {
      for (let index = Math.max(0,activeIndex - 1); index <= Math.min(list.length - 1,activeIndex + 1); index++) {
        const video = list[index];
        if (usable(video)) wanted.set(video,index === activeIndex ? 'auto' : (wanted.get(video) || 'metadata'));
      }
    }
    // Release outgoing resources before acquiring new ones, including large jumps.
    for (const video of new Set([...managed,...next])) if (!wanted.has(video)) unload(video);
    for (const [video,mode] of wanted) {
      const nextSource = value(() => source(video));
      if (!nextSource) unload(video);
      else load(video,nextSource,value(() => poster(video)),mode);
    }
    managed = next;
  }

  function clear() {
    for (const video of managed) unload(video);
    managed.clear();
  }

  return {sync,clear};
}
