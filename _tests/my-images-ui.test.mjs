import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SEGMENTS,normalizeImageSegment,createSegmentMemory} from '../edit/my-images-segment.js';
const source=await readFile(new URL('../edit/my-images.js',import.meta.url),'utf8');
let number=0;
class Element {
  listeners=new Map();children=[];queries=new Map();dataset={};hidden=false;disabled=false;readOnly=false;value='';textContent='';files=[];
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  async emit(type){const event={prevented:false,preventDefault(){this.prevented=true;}};for(const fn of this.listeners.get(type)||[])await fn(event);return event;}
  querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Element());return this.queries.get(selector);}
  querySelectorAll(){return this.closes||[];}
  append(node){node.parent=this;this.children.push(node);}
  prepend(node){node.parent=this;this.children.unshift(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  setAttribute(name,value){this[name]=value;}
  showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
}
function row(id,status='draft'){return {id,file:null,fileName:'image.png',caption:'Legenda '+id,date:null,time:null,status,needsFile:false,recoveryEditable:false};}
async function fixture({available=true,rows=[],scheduleWait=null,sendWait=null,legacyMarkup=false}={}){
  const dialog=new Element(),form=dialog.querySelector('form'),input=dialog.querySelector('[data-my-images-add]'),list=dialog.querySelector('[data-my-images-list]'),send=dialog.querySelector('[data-my-images-send]');
  const close=new Element();dialog.closes=[close];form.reportValidity=()=>true;
  if(legacyMarkup)dialog.queries.set('[data-my-images-progress]',null);
  const calls={schedule:[],send:0,combos:0,caption:[]};let onChange,entries=rows,busy=false;
  const queue={items:()=>entries,isBusy:()=>busy,remaining:()=>null,
    add(files){entries.push(...files.map((file,i)=>({...row('new-'+i),file})));onChange();},
    setCaption(id,text){entries.find(x=>x.id===id).caption=text;calls.caption.push(id);onChange();},
    setCaptionMode(id,mode){entries.find(x=>x.id===id).captionMode=mode;onChange();},
    remove(id){entries=entries.filter(x=>x.id!==id);onChange();},replaceFile(id,file){entries.find(x=>x.id===id).file=file;onChange();},
    async schedule(id){calls.schedule.push(id);busy=true;onChange();try{await scheduleWait;Object.assign(entries.find(x=>x.id===id),{date:'2026-11-04',time:'18:21'});}finally{busy=false;onChange();}},
    async sendAll(){calls.send++;busy=true;onChange();try{await sendWait;}finally{busy=false;onChange();}},};
  globalThis.window={sessionStorage:{}};globalThis.document={activeElement:null,createElement:()=>new Element(),addEventListener(){}};
  globalThis.__myImagesUI={SEGMENTS,normalizeImageSegment,createSegmentMemory,appCalendarAttemptScope:()=> 'fixture-nonce',appCreationAllowed:()=>available,refreshAppAvailability(){},openAppCombos(){calls.combos++;},createImageQueue(options){onChange=options.onChange;return queue;}};
  const rewritten='const {SEGMENTS,normalizeImageSegment,createSegmentMemory,appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos,createImageQueue}=globalThis.__myImagesUI;\n'+source.replace(/^import .*;\r?\n/gm,'')+'\n// fixture '+(++number);
  const {createMyImages}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
  const controller=createMyImages({dialog});controller.open();
  return {dialog,form,input,list,send,close,calls,queue,entries,progress:dialog.querySelector('[data-my-images-progress]')||form.children.find(node=>node.className==='my-images-progress'),render:()=>onChange(),setBusy(value){busy=value;onChange();}};
}

test('multiple selections create independent rows with day and hour below each caption',async()=>{
  const f=await fixture();f.input.files=[new Blob(['one'],{type:'image/png'}),new Blob(['two'],{type:'image/jpeg'})];await f.input.emit('change');
  assert.equal(f.list.children.length,2);assert.equal(f.entries.length,2);
  for(const node of f.list.children){assert(node.innerHTML.indexOf('<textarea')<node.innerHTML.indexOf('my-image-schedule'));assert.equal(node.querySelector('.my-image-day').querySelector('span').textContent,'Escolher dia');}
  assert.notEqual(f.list.children[0].querySelector('textarea'),f.list.children[1].querySelector('textarea'));
});
test('editing a caption preserves that input node and cursor ownership',async()=>{
  const f=await fixture({rows:[row('a'),row('b')]});const caption=f.list.children[0].querySelector('textarea');
  document.activeElement=caption;caption.value='Minha legenda nova';await caption.emit('input');
  assert.equal(f.list.children[0].querySelector('textarea'),caption);assert.equal(caption.value,'Minha legenda nova');assert.deepEqual(f.calls.caption,['a']);assert.equal(f.entries[1].caption,'Legenda b');
});

test('caption option is available on each photo in both modes, stays off by default and switches guidance/required state',async()=>{
  const f=await fixture({rows:[row('a'),{...row('b'),mode:'ia4tube'}]});
  for(const article of f.list.children){
    const toggle=article.querySelector('[data-caption-ai]'),caption=article.querySelector('textarea');
    assert.equal(toggle.checked,false);assert.equal(caption.required,true);
    toggle.checked=true;await toggle.emit('change');
    assert.equal(caption.required,false);assert.match(caption.placeholder,/#minhamarca/);
    assert.equal(article.querySelector('[data-caption-label]').textContent,'Oriente a legenda');
  }
  assert.ok(f.entries.every(entry=>entry.captionMode==='ia4tube'));
  f.entries[0].status='saved';f.render();assert.equal(f.list.children[0].querySelector('[data-caption-ai]').disabled,true);
});
test('selecting time changes only its own image and formats the confirmed date',async()=>{
  const f=await fixture({rows:[row('a'),row('b')]});await f.list.children[1].querySelector('.my-image-time').emit('click');
  assert.deepEqual(f.calls.schedule,['b']);assert.equal(f.list.children[1].querySelector('.my-image-day').querySelector('span').textContent,'04/11/2026');
  assert.equal(f.list.children[1].querySelector('.my-image-time').querySelector('span').textContent,'18:21');assert.equal(f.entries[0].time,null);
});
test('pending recovery remains confirmable with no new quota and cannot change its time',async()=>{
  const f=await fixture({available:false,rows:[{...row('a','pending'),needsFile:true,recoveryEditable:true}]});
  f.form.reportValidity=()=>false;
  assert.equal(f.form.noValidate,true,'native validation must not block confirmation of a reserved image');
  const node=f.list.children[0];assert.equal(node.querySelector('.my-image-time').disabled,true);assert.equal(node.querySelector('textarea').readOnly,false);
  assert.equal(node.querySelector('input[type=file]').required,true);await f.form.emit('submit');assert.equal(f.calls.send,1);assert.equal(f.calls.combos,0);
});
test('busy state blocks modal dismissal and empty exhausted quota opens combos',async()=>{
  const f=await fixture({available:false});assert.equal(f.send.formNoValidate,true);await f.form.emit('submit');assert.equal(f.calls.combos,1);
  f.setBusy(true);assert.equal(f.close.disabled,true);assert.equal((await f.dialog.emit('cancel')).prevented,true);await f.close.emit('click');assert.equal(f.dialog.open,true);
});

test('waiting for the confirmed schedule shows immediate progress beside the affected image',async()=>{
  let finish;const wait=new Promise(resolve=>{finish=resolve;});
  const f=await fixture({rows:[row('a'),row('b')],scheduleWait:wait});
  const node=f.list.children[1],pending=node.querySelector('.my-image-time').emit('click');
  assert.equal(f.progress.hidden,false);assert.equal(f.progress.textContent,'Confirmando horário…');
  assert.equal(node.querySelector('[role=status]').dataset.busy,'true');
  assert.equal(f.send.disabled,true);assert.equal(f.close.disabled,true);
  assert.equal(f.list.children[0].querySelector('[role=status]').dataset.busy,'false');
  finish();await pending;
  assert.equal(f.progress.hidden,true);assert.equal(node.querySelector('.my-image-time').querySelector('span').textContent,'18:21');
  assert.equal(f.send.disabled,false);
});

test('sending a list shows the current image and keeps repeated taps from sending again',async()=>{
  let finish;const wait=new Promise(resolve=>{finish=resolve;});
  const f=await fixture({rows:[row('a'),row('b')],sendWait:wait}),pending=f.form.emit('submit');
  assert.equal(f.progress.hidden,false);assert.equal(f.progress.textContent,'Enviando imagem 1 de 2…');
  assert.equal(f.send.dataset.busy,'true');assert.equal(f.list.children[0].querySelector('[role=status]').dataset.busy,'true');
  await f.form.emit('submit');assert.equal(f.calls.send,1);
  f.entries[0].status='saved';f.render();
  assert.equal(f.progress.textContent,'Enviando imagem 2 de 2…');
  assert.equal(f.list.children[0].querySelector('[role=status]').textContent,'✓ Enviada ao Calendário');
  assert.equal(f.list.children[1].querySelector('[role=status]').dataset.busy,'true');
  f.entries[1].status='saved';f.render();assert.equal(f.progress.textContent,'Confirmando envio…');
  finish();await pending;assert.equal(f.progress.hidden,true);assert.equal(f.send.dataset.busy,'false');
});

test('a failed send removes progress and preserves the error and earlier confirmed image',async()=>{
  let fail;const wait=new Promise((resolve,reject)=>{fail=reject;});
  const f=await fixture({rows:[row('done','saved'),row('a')],sendWait:wait}),pending=f.form.emit('submit');
  assert.equal(f.progress.textContent,'Enviando imagem 1 de 1…');
  fail(new Error('Não foi possível confirmar. Tente o mesmo envio.'));await pending;
  assert.equal(f.progress.hidden,true);assert.equal(f.send.disabled,false);
  assert.equal(f.dialog.querySelector('[role=alert]').textContent,'Não foi possível confirmar. Tente o mesmo envio.');
  assert.equal(f.entries[0].status,'saved');assert.equal(f.calls.send,1);
});

test('an older cached page without the new progress markup still opens and reports loading',async()=>{
  const f=await fixture({rows:[row('a')],legacyMarkup:true});
  assert.equal(f.dialog.open,true);assert.equal(f.form.children[0],f.progress);
  f.setBusy(true);assert.equal(f.progress.hidden,false);assert.equal(f.progress.textContent,'Aguarde…');
  f.setBusy(false);assert.equal(f.progress.hidden,true);
});
