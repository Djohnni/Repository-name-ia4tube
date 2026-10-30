import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrderRecovery} from '../order-recovery.js';
const model='12345678-1234-4123-8123-123456789abc',request='22345678-1234-4123-8123-123456789abc',hash='a'.repeat(64);
function fixture(){const values=new Map(),pending=new Map();let scope='n'.repeat(43);
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const create=()=>createOrderRecovery({storage,scope:()=>scope,isPending:(key,id)=>pending.get(key)===id});
  return {values,pending,storage,create,setScope:value=>{scope=value;}};
}
test('reload recovers only the same native scope and still-pending request, without saving uploads or credentials',()=>{
  const f=fixture();f.pending.set(hash,request);
  f.create().record(hash,{modelId:model,modelVersion:1,requestId:request,ticket:'never-copy',company:'private',logo:'bytes'});
  assert.equal(f.create().hasModel(model),true);const raw=[...f.values.values()][0];
  assert.equal(/never-copy|private|bytes|ticket|logo/.test(raw),false);
  f.setScope('x'.repeat(43));assert.equal(f.create().hasModel(model),false);
  f.setScope('n'.repeat(43));f.pending.clear();assert.equal(f.create().hasModel(model),false);
});
test('silent storage failure prevents creating an unrecoverable POST marker',()=>{
  const f=fixture();f.storage.setItem=()=>{};
  assert.throws(()=>f.create().record(hash,{modelId:model,modelVersion:1,requestId:request}),/preservar/);
});
