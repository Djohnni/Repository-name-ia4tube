import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../edit/my-images-api.js',import.meta.url),'utf8');
globalThis.__preparedUpload=async()=>({data:Buffer.from('original bytes').toString('base64'),mime:'image/png'});
const moduleSource='const prepareUpload=(...args)=>globalThis.__preparedUpload(...args);\n'+source.replace(/^import .*;\r?\n/gm,'');
const {readReadyImageContext,prepareReadyImage}=await import('data:text/javascript;base64,'+Buffer.from(moduleSource).toString('base64'));
const id='b774fc09-60f9-4d55-9a9e-6063d056da9d',ticket=id+'.'+'A'.repeat(43);
const value={ok:true,requestId:id,date:'2026-11-05',time:'17:55',remainingImages:10};
test('context is a credential-scoped GET with no body, account or scheduling inputs',async()=>{
  const original=globalThis.fetch;let request;
  globalThis.fetch=async(url,options)=>{request={url,options};return {ok:true,json:async()=>value};};
  try {assert.deepEqual(await readReadyImageContext(ticket),value);assert(request.url.endsWith('/ready-images/context'));
    assert.deepEqual(request.options.headers,{Authorization:'EditTicket '+ticket});assert.equal(request.options.body,undefined);assert.equal(request.options.credentials,'omit');assert.equal(request.options.cache,'no-store');}
  finally{globalThis.fetch=original;}
});
test('unknown balance stays null and zero stays zero',async()=>{
  const original=globalThis.fetch;
  try {for(const remainingImages of [null,0]){globalThis.fetch=async()=>({ok:true,json:async()=>({...value,remainingImages})});assert.equal((await readReadyImageContext(ticket)).remainingImages,remainingImages);}}
  finally{globalThis.fetch=original;}
});
test('a mismatching ticket, invalid time or invalid balance cannot populate the schedule',async()=>{
  const original=globalThis.fetch;
  try {for(const changes of [{requestId:'another'},{time:'24:15'},{remainingImages:-1}]){globalThis.fetch=async()=>({ok:true,json:async()=>({...value,...changes})});await assert.rejects(readReadyImageContext(ticket));}}
  finally{globalThis.fetch=original;}
});
test('a missing app ticket is rejected before any HTTP call',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw Error('unexpected request');};
  try{await assert.rejects(readReadyImageContext(''),/pelo app/);}finally{globalThis.fetch=original;}
});
test('image preparation reuses the file reader and preserves source bytes and type',async()=>{
  let args;globalThis.__preparedUpload=async(...values)=>{args=values;return {data:Buffer.from('original bytes').toString('base64'),mime:'image/png'};};
  const input=new Blob(['source'],{type:'image/png'}),result=await prepareReadyImage(input);
  assert.equal(args[0],input);assert.equal(args[1],10*1024*1024);assert.equal(result.type,'image/png');assert.equal(await result.text(),'original bytes');
});
