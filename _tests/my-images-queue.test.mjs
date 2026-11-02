import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const directory=new URL('../edit/',import.meta.url);
const submitSource=await readFile(new URL('my-images-submit.js',directory),'utf8');
const {createImageSubmission}=await import('data:text/javascript;base64,'+Buffer.from(submitSource).toString('base64'));
globalThis.__queueTestSubmission=createImageSubmission;
const queueSource=await readFile(new URL('my-images-queue.js',directory),'utf8');
const noExternal='const createImageSubmission=globalThis.__queueTestSubmission;const noExternal=()=>{throw Error("No real API/native/file helper in queue tests");};const requestAppCalendar=noExternal,postReadyImage=noExternal,readReadyImageContext=noExternal,prepareReadyImage=noExternal;\n';
const {createImageQueue}=await import('data:text/javascript;base64,'+Buffer.from(noExternal+queueSource.replace(/^import .*;\r?\n/gm,'')).toString('base64'));
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ticket=requestId=>requestId+'.'+'A'.repeat(43);
function photo(name,bytes=name){return Object.assign(new Blob([bytes],{type:'image/png'}),{name});}
const first=photo('first.png'),second=photo('second.png'),third=photo('third.png');
const wait=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({balance=3,storage:providedStorage,scope='synthetic-nonce'}={}) {
  const values=new Map(),storage=providedStorage||{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const calls={calendar:[],read:[],posts:[],images:[],changes:0,maxActive:0},contexts=new Map(),receipts=new Map();
  let sequence=0,active=0;
  const faults={loseNext:false,readFailures:0,failReadAfterPost:false};
  const ports={scope,storage,uuid:()=>id(++sequence),onChange:()=>{calls.changes++;},
    requestCalendar:async requestId=>{calls.calendar.push(requestId);if(!contexts.has(requestId))contexts.set(requestId,{date:'2030-01-02',time:'18:30'});return {ticket:ticket(requestId)};},
    readContext:async value=>{
      const requestId=value.split('.')[0];calls.read.push(requestId);
      if(faults.readFailures>0){faults.readFailures--;throw Error('context_read_failed');}
      if(faults.failReadAfterPost&&calls.posts.length>0){faults.failReadAfterPost=false;throw Error('context_read_failed');}
      return {ok:true,requestId,...contexts.get(requestId),remainingImages:balance};
    },
    readImage:async file=>{calls.images.push(file);return file;},
    submitImage:async value=>{
      calls.posts.push(value);active++;calls.maxActive=Math.max(calls.maxActive,active);
      try {
        await wait();
        if(receipts.has(value.requestId))return receipts.get(value.requestId);
        if(balance<=0)throw Object.assign(Error('billing_required'),{code:'billing_required'});
        balance--;
        const result={ok:true,requestId:value.requestId,planningId:'pm_'+value.requestId,pedidoId:'order_'+value.requestId,status:'ready'};
        receipts.set(value.requestId,result);
        if(faults.loseNext){faults.loseNext=false;throw Error('uncertain_post');}
        return result;
      }finally{active--;}
    }};
  const queue=createImageQueue(ports);
  return {queue,ports,calls,faults,storage,values,contexts,receipts,get balance(){return balance;},set balance(value){balance=value;}};
}
async function prepared(f,files=[first,second]) {
  const rows=f.queue.add(files);
  for(const [index,row] of rows.entries()){f.queue.setCaption(row.id,'Legenda '+index);await f.queue.schedule(row.id);}
  return f.queue.items();
}

test('each photo keeps one caption, individual context and sequential one-unit delivery',async()=>{
  const f=fixture(),rows=await prepared(f);
  assert.notEqual(rows[0].requestId,rows[1].requestId);
  await f.queue.sendAll();
  assert.equal(f.calls.maxActive,1);assert.equal(f.calls.posts.length,2);assert.equal(f.balance,1);
  assert.deepEqual(f.calls.posts.map(value=>value.caption),['Legenda 0','Legenda 1']);
  assert(f.queue.items().every(row=>row.status==='saved'));
  await f.queue.sendAll();assert.equal(f.calls.posts.length,2,'saved rows never send again');
  assert.equal(f.queue.remaining(),1);assert.equal(f.queue.isBusy(),false);
});

test('all captions and dates are validated before the first POST',async()=>{
  const f=fixture(),rows=f.queue.add([first,second]);
  f.queue.setCaption(rows[0].id,'First');await f.queue.schedule(rows[0].id);
  await assert.rejects(f.queue.sendAll(),{code:'ready_image_caption_required'});
  assert.equal(f.calls.posts.length,0);
  f.queue.setCaption(rows[1].id,'Second');
  await assert.rejects(f.queue.sendAll(),{code:'ready_image_schedule_required'});
  assert.equal(f.calls.posts.length,0);assert.equal(f.queue.items().length,2);
});

test('schedule retries only a failed context read, but a later deliberate reschedule gets a new UUID',async()=>{
  const f=fixture(),[row]=f.queue.add([first]);f.queue.setCaption(row.id,'Caption');f.faults.readFailures=1;
  await assert.rejects(f.queue.schedule(row.id),/context_read_failed/);
  const requestId=f.queue.items()[0].requestId;
  assert.equal(f.calls.calendar.length,1);assert.equal(f.queue.items()[0].date,null);
  await f.queue.schedule(row.id);
  assert.equal(f.calls.calendar.length,1);assert.equal(f.queue.items()[0].requestId,requestId);
  assert.equal(f.queue.items()[0].date,'2030-01-02');assert.equal(f.calls.posts.length,0);
  await f.queue.schedule(row.id);
  assert.equal(f.calls.calendar.length,2);assert.notEqual(f.queue.items()[0].requestId,requestId);
});

test('known insufficient balance pauses the complete draft list before a POST',async()=>{
  const f=fixture({balance:2});await prepared(f,[first,second,third]);
  await assert.rejects(f.queue.sendAll(),{code:'billing_required'});
  assert.equal(f.calls.posts.length,0);assert.equal(f.balance,2);assert.equal(f.queue.items().length,3);
  assert(f.queue.items().every(row=>row.status==='draft'));
  f.balance=3;await f.queue.sendAll();assert.equal(f.balance,0);assert.equal(f.calls.posts.length,3);
});

test('adding above an already known balance rejects the selection without changing the list',async()=>{
  const f=fixture({balance:1});await prepared(f,[first]);
  const before=f.queue.items();assert.equal(f.queue.remaining(),1);
  assert.throws(()=>f.queue.add([second,third]),{code:'billing_required'});
  assert.deepEqual(f.queue.items(),before);assert.equal(f.calls.posts.length,0);assert.equal(f.balance,1);
});

test('uncertain upload freezes its snapshot, resumes once and leaves later photos untouched',async()=>{
  const f=fixture({balance:2});const rows=await prepared(f);f.faults.loseNext=true;
  await assert.rejects(f.queue.sendAll(),/uncertain_post/);
  assert.deepEqual(f.queue.items().map(row=>row.status),['pending','draft']);
  assert.throws(()=>f.queue.setCaption(rows[0].id,'Changed'),{code:'ready_image_row_locked'});
  assert.throws(()=>f.queue.remove(rows[0].id),{code:'ready_image_row_locked'});
  assert.equal(f.balance,1);await f.queue.sendAll();
  assert.equal(f.calls.posts.length,3);assert.equal(f.receipts.size,2);assert.equal(f.balance,0);
  assert.equal(f.calls.posts[0].requestId,f.calls.posts[1].requestId);
  assert.equal(f.calls.images.length,2,'the uncertain snapshot is reused without another read');
});

test('pending recovery still confirms with zero available units',async()=>{
  const f=fixture({balance:1});await prepared(f,[first]);f.faults.loseNext=true;
  await assert.rejects(f.queue.sendAll());assert.equal(f.balance,0);
  await f.queue.sendAll();assert.equal(f.balance,0);assert.equal(f.receipts.size,1);assert.equal(f.queue.items()[0].status,'saved');
});

test('reload reconciles one paid pending image before requiring the unrelated draft files again',async()=>{
  const f=fixture({balance:2});const rows=await prepared(f);f.faults.loseNext=true;
  await assert.rejects(f.queue.sendAll());
  const restored=createImageQueue(f.ports);
  assert(restored.items().every(row=>row.file===null));
  restored.replaceFile(rows[0].id,first);
  await assert.rejects(restored.sendAll(),{code:'ready_image_file_required',rowId:rows[1].id});
  assert.deepEqual(restored.items().map(row=>row.status),['saved','draft']);
  assert.equal(f.receipts.size,1);assert.equal(f.calls.posts.length,2);assert.equal(f.balance,1);
  restored.replaceFile(rows[1].id,second);await restored.sendAll();
  assert.equal(f.receipts.size,2);assert.equal(f.calls.posts.length,3);assert.equal(f.balance,0);
});

test('restore contains no file bytes and mismatch remains editable for the original image/caption',async()=>{
  const f=fixture({balance:1});const [original]=await prepared(f,[first]);f.faults.loseNext=true;await assert.rejects(f.queue.sendAll());
  const manifest=[...f.values.entries()].find(([key])=>key.startsWith('ia4tube:my-images-queue:v1:'))[1];
  assert(!manifest.includes('fixture bytes'));assert(!manifest.includes('"file":'));assert(!manifest.includes('"ticket":'));
  const restored=createImageQueue(f.ports),[row]=restored.items();
  assert.equal(row.file,null);assert.equal(row.needsFile,true);assert.equal(row.recoveryEditable,true);
  restored.replaceFile(row.id,photo('wrong.png'));restored.setCaption(row.id,'Wrong');
  await assert.rejects(restored.sendAll(),{code:'ready_image_pending_mismatch'});
  assert.equal(restored.items()[0].recoveryEditable,true);assert.equal(f.calls.posts.length,1);
  restored.replaceFile(row.id,first);restored.setCaption(row.id,original.caption);await restored.sendAll();
  assert.equal(restored.items()[0].requestId,original.requestId);assert.equal(restored.items()[0].status,'saved');assert.equal(f.balance,0);
});

test('legacy single pending key migrates to one recovery row without another debit',async()=>{
  const f=fixture({balance:1});const oldId=id(900);
  const old=createImageSubmission({scope:f.ports.scope,storage:f.storage,uuid:()=>oldId,
    requestCalendar:f.ports.requestCalendar,post:f.ports.submitImage});f.faults.loseNext=true;
  await assert.rejects(old.send({image:first,caption:'Legacy caption'}));
  const before=f.storage.getItem('ia4tube:my-images:v1:'+f.ports.scope),queue=createImageQueue(f.ports);
  assert.equal(queue.items().length,1);assert.equal(queue.items()[0].status,'pending');
  assert.equal(f.storage.getItem('ia4tube:my-images:v1:'+f.ports.scope),before,'legacy receipt is not rewritten during migration');
  const [row]=queue.items();queue.replaceFile(row.id,first);queue.setCaption(row.id,'Legacy caption');await queue.sendAll();
  assert.equal(f.balance,0);assert.equal(f.receipts.size,1);assert.equal(queue.items()[0].status,'saved');
  assert.equal(f.storage.getItem('ia4tube:my-images:v1:'+f.ports.scope),null);
});

test('another account nonce cannot observe a restored list or pending receipt',async()=>{
  const f=fixture();await prepared(f,[first]);
  const other=createImageQueue({...f.ports,scope:'another-nonce'});
  assert.deepEqual(other.items(),[]);assert.equal(other.remaining(),null);
  assert.equal(createImageQueue(f.ports).items().length,1);
});

test('a confirmed row stays saved when the following balance read fails',async()=>{
  const f=fixture();await prepared(f,[first,second]);f.faults.failReadAfterPost=true;
  await assert.rejects(f.queue.sendAll(),/context_read_failed/);
  assert.deepEqual(f.queue.items().map(row=>row.status),['saved','draft']);
  await f.queue.sendAll();assert.equal(f.calls.posts.length,2);assert.equal(f.balance,1);
});

test('busy queue rejects overlapping sends and editing while a POST is in progress',async()=>{
  const f=fixture();const [row]=await prepared(f,[first]);let release;
  const originalPost=f.ports.submitImage;const delayed=createImageQueue({...f.ports,submitImage:async value=>{
    await new Promise(resolve=>{release=resolve;});return originalPost(value);
  }});
  delayed.replaceFile(row.id,first);const sending=delayed.sendAll();
  for(let i=0;i<20&&!release;i++)await wait();
  assert.equal(delayed.isBusy(),true);assert.throws(()=>delayed.setCaption(row.id,'No'),{code:'ready_image_queue_busy'});
  await assert.rejects(delayed.sendAll(),{code:'ready_image_queue_busy'});release();await sending;
  assert.equal(f.calls.posts.length,1);
});
