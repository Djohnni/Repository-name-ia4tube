// Keep the visitor's choice separate from a browser's temporary autoplay block.
export function createPlaybackAudio({onChange = () => {}} = {}) {
  let enabled = true,blocked = false,sequence = 0,attempt = null,currentVideo = null;
  const getState = () => ({enabled,blocked,audible:enabled && !blocked});
  const notify = () => onChange(getState());

  function cancel(video) {
    if (video && currentVideo !== video) return;
    sequence++;
    attempt = null;
    currentVideo = null;
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    blocked = false;
    sequence++;
    attempt = null;
    if (currentVideo) currentVideo.muted = !enabled;
    notify();
  }

  function play(video,{isCurrent = () => true,onPlaying = () => {},onBlocked = () => {},onError = () => {}} = {}) {
    if (!video || !isCurrent()) return Promise.resolve('stale');
    const muted = !enabled || blocked;
    if (attempt?.video === video && attempt.muted === muted && attempt.valid() &&
        (!attempt.settled || (attempt.status === 'playing' && !video.paused))) return attempt.promise;

    const token = ++sequence;
    currentVideo = video;
    const entry = {video,muted,settled:false,status:null,promise:null,valid:() => sequence === token && currentVideo === video && isCurrent()};
    attempt = entry;
    video.muted = muted;

    // Do not defer this call: Safari needs play() in the click's call stack.
    const invoke = () => {
      try {return Promise.resolve(video.play());}
      catch (error) {return Promise.reject(error);}
    };
    const finish = status => {entry.settled = true;entry.status = status;return status;};
    const played = () => {
      if (!entry.valid()) return finish('stale');
      onPlaying();
      return finish('playing');
    };
    const failed = error => {
      if (!entry.valid()) return finish('stale');
      onError(error);
      return finish('error');
    };
    entry.promise = invoke().then(played,error => {
      if (!entry.valid()) return finish('stale');
      if (entry.muted || error?.name !== 'NotAllowedError') return failed(error);
      blocked = true;
      entry.muted = true;
      video.muted = true;
      notify();
      onBlocked();
      if (!entry.valid()) return finish('stale');
      // One muted fallback only; a later explicit tap can request sound again.
      return invoke().then(played,failed);
    });
    return entry.promise;
  }

  return {getState,setEnabled,play,cancel};
}
