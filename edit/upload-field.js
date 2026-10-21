const ACCEPTED_TYPES = new Set(['image/png','image/jpeg','image/webp']);
const TRANSIENT_ERRORS = new Set(['NotReadableError','NotFoundError']);
const READ_TIMEOUT_MS = 20000;
const RETRY_DELAY_MS = 250;

function cancelled() {return new DOMException('Leitura cancelada.','AbortError');}

function readOnce(file,signal) {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    let settled = false,timer;
    function finish(action,value) {
      if (settled) return;
      settled = true;clearTimeout(timer);
      signal.removeEventListener('abort',cancel);
      reader.onload = reader.onerror = reader.onabort = null;
      action(value);
    }
    function stop(error) {
      finish(reject,error);
      try {reader.abort();} catch { /* The reader may already have finished. */ }
    }
    function cancel() {stop(cancelled());}
    reader.onload = () => {
      const result = String(reader.result || ''),comma = result.indexOf(',');
      const data = result.slice(comma + 1);
      const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
      if (comma < 0 || !result.slice(0,comma).endsWith(';base64') || !data || data.length % 4 || data.length / 4 * 3 - padding !== file.size) {
        finish(reject,new DOMException('A leitura da imagem ficou incompleta.','NotReadableError'));
      } else finish(resolve,{name:file.name,mime:file.type,data});
    };
    reader.onerror = () => finish(reject,reader.error || new DOMException('Falha na leitura.','UnknownError'));
    reader.onabort = () => finish(reject,cancelled());
    if (signal.aborted) {cancel();return;}
    signal.addEventListener('abort',cancel,{once:true});
    timer = setTimeout(() => stop(new DOMException('A leitura da imagem demorou demais.','TimeoutError')),READ_TIMEOUT_MS);
    try {reader.readAsDataURL(file);} catch(error) {finish(reject,error);}
  });
}

function waitForRetry(signal) {
  return new Promise((resolve,reject) => {
    if (signal.aborted) {reject(cancelled());return;}
    const timer = setTimeout(() => {signal.removeEventListener('abort',cancel);resolve();},RETRY_DELAY_MS);
    function cancel() {clearTimeout(timer);reject(cancelled());}
    signal.addEventListener('abort',cancel,{once:true});
  });
}

async function prepareUpload(file,maxBytes,label,signal) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error(`${label}: escolha uma imagem PNG, JPG ou WebP.`);
  if (!file.size || file.size > maxBytes) throw new Error(`${label}: o limite é ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  try {
    for (let attempt = 0; ; attempt++) {
      try {return await readOnce(file,signal);}
      catch(error) {
        if (signal.aborted || attempt >= 1 || !TRANSIENT_ERRORS.has(error.name)) throw error;
        // Only the local file read is retried. No order/API request is made here.
        await waitForRetry(signal);
      }
    }
  } catch(cause) {
    const error = new Error(`Não foi possível preparar ${label.toLowerCase()}. Escolha a imagem salva neste aparelho novamente.`,{cause});
    // Do not misreport a local read cancellation as an uncertain POST timeout.
    error.name = 'UploadReadError';
    throw error;
  }
}

// Keep only this field's latest selection in memory, never in browser storage.
export function createUploadField(input,{maxBytes,label}) {
  const status = document.createElement('small');
  status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  status.hidden = true;input.after(status);
  let entry = null;
  const selected = () => input.files?.[0] || null;
  function show(text) {status.textContent = text;status.hidden = !text;}
  function reset() {
    const previous = entry;entry = null;show('');
    previous?.controller.abort();
  }
  function start(file) {
    reset();
    if (!file) return null;
    const current = {file,controller:new AbortController(),state:'preparing',promise:null};
    entry = current;show('Preparando imagem…');
    current.promise = prepareUpload(file,maxBytes,label,current.controller.signal).then(value => {
      current.state = 'ready';
      if (entry === current && selected() === file) show('Imagem pronta.');
      return value;
    },error => {
      current.state = 'error';
      if (entry === current && selected() === file) show(error.message);
      throw error;
    });
    // Selection starts a background read; its error is visible and consumed here.
    // A later explicit submission can try again without an unhandled rejection.
    current.promise.catch(() => {});
    return current;
  }
  input.addEventListener('change',() => {start(selected());});
  async function read() {
    const file = selected();
    if (!file) {reset();return null;}
    const current = entry?.file === file && entry.state !== 'error' ? entry : start(file);
    const value = await current.promise;
    if (entry !== current || selected() !== file) throw new Error(`${label}: a imagem foi alterada. Confira a seleção e tente enviar novamente.`);
    return value;
  }
  return {read,reset};
}
