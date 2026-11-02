import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../edit/my-images.js',import.meta.url),'utf8');
let number=0;
class Element {
  listeners=new Map();children=[];queries=new Map();dataset={};hidden=false;disabled=false;readOnly=false;value='';textContent='';files=[];
  addEventListener(type,fn){this.listeners.set(type,[...(this.listeners.get(type)||[]),fn]);}
  async emit(type){const event={prevented:false,preventDefault(){this.prevented=true;}};for(const fn of this.listeners.get(type)||[])await fn(event);return event;}
  querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,new Element());return this.queries.get(selector);}
  querySelectorAll(){return this.closes||[];}
  append(node){node.parent=this;this.children.push(node);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(x=>x!==this);}
  setAttribute(name,value){this[name]=value;}
  showModal(){this.open=true;}close(){this.open=false;this.emit('close');}
}
function row(id,status='draft'){return {id,file:null,fileName:'image.png',caption:'Legenda '+id,date:null,time:null,status,needsFile:false,recoveryEditable:false};}
async function fixture({available=true,rows=[]}={}){
  const dialog=new Element(),form=dialog.querySelector('form'),input=dialog.querySelector('[data-my-images-add]'),list=dialog.querySelector('[data-my-images-list]'),send=dialog.querySelector('[data-my-images-send]');
  const close=new Element();dialog.closes=[close];form.reportValidity=()=>true;
  const calls={schedule:[],send:0,combos:0,caption:[]};let onChange,entries=rows,busy=false;
  const queue={items:()=>entries,isBusy:()=>busy,remaining:()=>null,
    add(files){entries.push(...files.map((file,i)=>({...row('new-'+i),file})));onChange();},
    setCaption(id,text){entries.find(x=>x.id===id).caption=text;calls.caption.push(id);onChange();},
    remove(id){entries=entries.filter(x=>x.id!==id);onChange();},replaceFile(id,file){entries.find(x=>x.id===id).file=file;onChange();},
    async schedule(id){calls.schedule.push(id);Object.assign(entries.find(x=>x.id===id),{date:'2026-11-04',time:'18:21'});onChange();},
    async sendAll(){calls.send++;},};
  globalThis.window={sessionStorage:{}};globalThis.document={activeElement:null,createElement:()=>new Element(),addEventListener(){}};
  globalThis.__myImagesUI={appCalendarAttemptScope:()=> 'fixture-nonce',appCreationAllowed:()=>available,refreshAppAvailability(){},openAppCombos(){calls.combos++;},createImageQueue(options){onChange=options.onChange;return queue;}};
  const rewritten='const {appCalendarAttemptScope,appCreationAllowed,refreshAppAvailability,openAppCombos,createImageQueue}=globalThis.__myImagesUI;\n'+source.replace(/^import .*;\r?\n/gm,'')+'\n// fixture '+(++number);
  const {createMyImages}=await import('data:text/javascript;base64,'+Buffer.from(rewritten).toString('base64'));
  const controller=createMyImages({dialog});controller.open();
  return {dialog,form,input,list,send,close,calls,queue,entries,render:()=>onChange(),setBusy(value){busy=value;onChange();}};
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
