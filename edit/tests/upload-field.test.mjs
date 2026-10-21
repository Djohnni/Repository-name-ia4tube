import test from 'node:test';
import assert from 'node:assert/strict';
import {createUploadField} from '../upload-field.js';

const MAX = 5 * 1024 * 1024;
const file = (name='logo.png', overrides={}) => ({name,type:'image/png',size:100,lastModified:123,...overrides});
const encoded = (selected, text='image bytes') => ({name:selected.name,mime:selected.type,data:Buffer.alloc(selected.size).fill(text).toString('base64')});
const flush = async () => {for(let i=0;i<10;i++)await Promise.resolve();};

class Element {
  constructor(tag='input') {
    this.tag=tag;this.files=[];this.value='';this.textContent='';this.className='';
    this.hidden=false;this.disabled=false;this.dataset={};this.attributes=new Map();this.listeners=new Map();
    this.classList={add(){},remove(){},toggle(){}};
  }
  addEventListener(type, handler) {const rows=this.listeners.get(type)||[];rows.push(handler);this.listeners.set(type,rows);}
  removeEventListener(type, handler) {this.listeners.set(type,(this.listeners.get(type)||[]).filter(value=>value!==handler));}
  emit(type) {
    const event={type,target:this,currentTarget:this,preventDefault(){}};
    this['on'+type]?.(event);
    for(const listener of this.listeners.get(type)||[])listener(event);
  }
  after(element) {this.status=element;}
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  removeAttribute(name) {this.attributes.delete(name);}
  setCustomValidity(message) {this.validationMessage=message;}
}

function fixture(t) {
  const names=['document','FileReader','setTimeout','clearTimeout','fetch'];
  const original=new Map(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const install=(name,value)=>Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  let now=0,id=0;
  const timers=new Map(),readers=[];
  class Reader extends Element {
    static EMPTY=0;static LOADING=1;static DONE=2;
    constructor(){super('FileReader');this.readyState=0;this.result=null;this.error=null;this.abortCalls=0;readers.push(this);}
    readAsDataURL(selected){this.file=selected;this.readyState=1;}
    succeed(text='image bytes') {this.result=`data:${this.file.type};base64,${encoded(this.file,text).data}`;this.readyState=2;this.emit('load');this.emit('loadend');}
    fail(name='NotReadableError') {this.error=Object.assign(new Error('Local file unavailable'),{name});this.readyState=2;this.emit('error');this.emit('loadend');}
    abort() {this.abortCalls++;this.readyState=2;this.error=Object.assign(new Error('Read aborted'),{name:'AbortError'});this.emit('abort');this.emit('loadend');}
  }
  install('document',{createElement:tag=>new Element(tag)});
  install('FileReader',Reader);
  install('fetch',()=>{throw Error('Network forbidden in upload field tests');});
  install('setTimeout',(callback,delay=0,...args)=>{const handle=++id;timers.set(handle,{at:now+Number(delay),callback:()=>callback(...args)});return handle;});
  install('clearTimeout',handle=>timers.delete(handle));
  t.after(()=>{for(const [name,descriptor]of original){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  const advance=async milliseconds=>{
    await flush();
    const end=now+milliseconds;
    for(let safety=0;safety<100;safety++) {
      const next=[...timers.entries()].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];
      if(!next){now=end;await flush();return;}
      const [handle,timer]=next;now=timer.at;timers.delete(handle);timer.callback();await flush();
    }
    throw Error('Runaway timer in upload field');
  };
  const input=new Element();
  const field=createUploadField(input,{maxBytes:MAX,label:'Logo'});
  const choose=async selected=>{input.files=selected?[selected]:[];input.emit('change');await flush();};
  return {input,field,readers,timers,advance,choose,Element};
}

test('change starts reading eagerly and creates inline status before submit',async t=>{
  const f=fixture(t),selected=file();
  assert.equal(f.input.status?.tag,'small');
  await f.choose(selected);
  assert.equal(f.readers.length,1);
  assert.equal(f.readers[0].file,selected);
  assert.match(f.input.status.textContent,/\S/);
  const pending=f.field.read();f.readers[0].succeed();
  assert.deepEqual(await pending,encoded(selected));
});

test('read waits for in-flight selection and concurrent reads share cached bytes',async t=>{
  const f=fixture(t),selected=file();await f.choose(selected);
  let settled=false;
  const first=f.field.read().then(value=>{settled=true;return value;});
  const second=f.field.read();await flush();
  assert.equal(settled,false);assert.equal(f.readers.length,1);
  f.readers[0].succeed('original logo');
  assert.deepEqual(await first,encoded(selected,'original logo'));
  assert.deepEqual(await second,encoded(selected,'original logo'));
  assert.deepEqual(await f.field.read(),encoded(selected,'original logo'));
  assert.equal(f.readers.length,1);
  assert.equal(f.timers.size,0);
});

test('read also handles a file selected without a change event',async t=>{
  const f=fixture(t),selected=file();f.input.files=[selected];
  const pending=f.field.read();await flush();
  assert.equal(f.readers.length,1);f.readers[0].succeed();
  assert.deepEqual(await pending,encoded(selected));
});

test('empty selection returns null without constructing a FileReader',async t=>{
  const f=fixture(t);assert.equal(await f.field.read(),null);
  await f.choose(null);assert.equal(await f.field.read(),null);
  assert.equal(f.readers.length,0);assert.equal(f.timers.size,0);
});

test('replacement cannot resolve submission with stale bytes even when metadata matches',async t=>{
  const f=fixture(t),old=file(),fresh=file();await f.choose(old);
  const obsolete=f.field.read().then(value=>({value}),error=>({error}));
  await f.choose(fresh);assert.equal(f.readers.length,2);
  const current=f.field.read();f.readers[1].succeed('new logo');
  assert.deepEqual(await current,encoded(fresh,'new logo'));
  f.readers[0].succeed('old logo');await flush();
  const outcome=await obsolete;
  assert.notDeepEqual(outcome.value,encoded(old,'old logo'));
  assert.deepEqual(await f.field.read(),encoded(fresh,'new logo'));
  assert.equal(f.readers.length,2);
});

test('reset invalidates in-flight results and a later order reads its own file',async t=>{
  const f=fixture(t),old=file('old.png');await f.choose(old);
  const obsolete=f.field.read().then(value=>({value}),error=>({error}));
  f.input.files=[];f.field.reset();await flush();
  f.readers[0].succeed('old private logo');
  assert.equal(await f.field.read(),null);
  const outcome=await obsolete;assert.notDeepEqual(outcome.value,encoded(old,'old private logo'));
  const next=file('next.png');await f.choose(next);const pending=f.field.read();
  f.readers[1].succeed('next logo');assert.deepEqual(await pending,encoded(next,'next logo'));
  assert.equal(f.readers.length,2);assert.equal(f.timers.size,0);
});

test('reset discards cached success and never leaks one field into another',async t=>{
  const f=fixture(t),selected=file();await f.choose(selected);f.readers[0].succeed('first logo');
  assert.deepEqual(await f.field.read(),encoded(selected,'first logo'));
  f.input.files=[];f.field.reset();assert.equal(await f.field.read(),null);
  const otherInput=new f.Element();const other=createUploadField(otherInput,{maxBytes:MAX,label:'Foto'});
  assert.equal(await other.read(),null);
  await f.choose(selected);const pending=f.field.read();assert.equal(f.readers.length,2);
  f.readers[1].succeed('selected again');assert.deepEqual(await pending,encoded(selected,'selected again'));
  assert.equal(await other.read(),null);
});

test('invalid MIME and zero or oversized files fail before any reader starts',async t=>{
  const f=fixture(t);
  for(const selected of [file('bad.gif',{type:'image/gif'}),file('bad.svg',{type:'image/svg+xml'}),file('empty.png',{size:0}),file('huge.png',{size:MAX+1})]) {
    await f.choose(selected);await assert.rejects(f.field.read(),/Logo/i);
  }
  assert.equal(f.readers.length,0);assert.equal(f.timers.size,0);
});

test('PNG JPEG and WebP at the inclusive size limit keep original metadata',async t=>{
  const f=fixture(t);
  for(const [index,mime]of ['image/png','image/jpeg','image/webp'].entries()) {
    const selected=file('original name',{type:mime,size:MAX});await f.choose(selected);
    const pending=f.field.read();f.readers[index].succeed(mime);
    assert.deepEqual(await pending,encoded(selected,mime));
  }
});

for(const retryable of ['NotReadableError','NotFoundError']) {
  test(`${retryable} gets one delayed retry and shares its result`,async t=>{
    const f=fixture(t),selected=file();await f.choose(selected);
    const pending=f.field.read();f.readers[0].fail(retryable);await flush();
    assert.equal(f.readers.length,1);await f.advance(249);assert.equal(f.readers.length,1);
    await f.advance(1);assert.equal(f.readers.length,2);assert.equal(f.readers[1].file,selected);
    f.readers[1].succeed('retried');assert.deepEqual(await pending,encoded(selected,'retried'));
    assert.deepEqual(await f.field.read(),encoded(selected,'retried'));assert.equal(f.readers.length,2);
    assert.equal(f.timers.size,0);
  });
}

test('a second transient failure stops until a new explicit read starts another attempt',async t=>{
  const f=fixture(t);await f.choose(file());
  const rejection=assert.rejects(f.field.read(),/Logo|logo|imagem|arquivo/i);
  f.readers[0].fail('NotReadableError');await f.advance(250);
  assert.equal(f.readers.length,2);f.readers[1].fail('NotReadableError');await rejection;
  await f.advance(60000);assert.equal(f.readers.length,2);assert.equal(f.timers.size,0);
  const explicit=f.field.read();await flush();assert.equal(f.readers.length,3);
  f.readers[2].succeed('explicit retry');await explicit;assert.equal(f.readers.length,3);
});

for(const permanent of ['SecurityError','NotAllowedError','EncodingError']) {
  test(`${permanent} never retries and blocks the caller from submitting`,async t=>{
    const f=fixture(t);await f.choose(file());let submits=0;
    const pending=f.field.read().then(()=>{submits++;},error=>error);
    f.readers[0].fail(permanent);const error=await pending;
    assert.ok(error instanceof Error);assert.match(error.message,/\S/);
    await f.advance(60000);assert.equal(submits,0);assert.equal(f.readers.length,1);
    assert.equal(f.timers.size,0);
  });
}

test('selection replacement cancels a scheduled retry of the old file',async t=>{
  const f=fixture(t);await f.choose(file('old.png'));
  const obsolete=f.field.read().catch(error=>error);f.readers[0].fail('NotFoundError');await flush();
  await f.choose(file('new.png'));const pending=f.field.read();assert.equal(f.readers.length,2);
  f.readers[1].succeed('new');await pending;await obsolete;await f.advance(60000);
  assert.equal(f.readers.length,2);assert.equal(f.timers.size,0);
});

test('20 second timeout aborts reading, rejects and never submits late bytes',async t=>{
  const f=fixture(t);await f.choose(file());let submits=0,settled=false;
  const pending=f.field.read().then(()=>{submits++;settled=true;},error=>{settled=true;return error;});
  await f.advance(19999);assert.equal(settled,false);
  await f.advance(1);const error=await pending;
  assert.ok(error instanceof Error);assert.match(error.message,/\S/);assert.ok(f.readers[0].abortCalls>=1);
  f.readers[0].succeed('late');await f.advance(60000);
  assert.equal(submits,0);assert.equal(f.readers.length,1);assert.equal(f.timers.size,0);
});

test('FileReader abort rejects without retry or successful caller submission',async t=>{
  const f=fixture(t);await f.choose(file());let submits=0;
  const pending=f.field.read().then(()=>{submits++;},error=>error);
  f.readers[0].abort();assert.ok(await pending instanceof Error);await f.advance(60000);
  assert.equal(submits,0);assert.equal(f.readers.length,1);assert.equal(f.timers.size,0);
});

test('truncated data URL bytes are retried once and never escape as a valid upload',async t=>{
  const f=fixture(t),selected=file();await f.choose(selected);
  const pending=f.field.read();let settled=false;pending.then(()=>{settled=true;});
  f.readers[0].result='data:image/png;base64,YQ==';f.readers[0].readyState=2;f.readers[0].emit('load');
  await flush();assert.equal(settled,false);await f.advance(250);assert.equal(f.readers.length,2);
  f.readers[1].succeed('complete');assert.deepEqual(await pending,encoded(selected,'complete'));
});

test('invalid data URL remains an error after the single retry and prevents submit',async t=>{
  const f=fixture(t);await f.choose(file());let submits=0;
  const pending=f.field.read().then(()=>{submits++;},error=>error);
  f.readers[0].result='not-a-data-url';f.readers[0].readyState=2;f.readers[0].emit('load');
  await f.advance(250);assert.equal(f.readers.length,2);
  f.readers[1].result='data:image/png,not-base64';f.readers[1].readyState=2;f.readers[1].emit('load');
  assert.ok(await pending instanceof Error);await f.advance(60000);
  assert.equal(submits,0);assert.equal(f.readers.length,2);assert.equal(f.timers.size,0);
});
