import test from 'node:test';
import assert from 'node:assert/strict';
import {getOrCreateRequestId,confirmSavedAttempt} from '../order.js';

const fingerprint = 'a'.repeat(64);
const otherFingerprint = 'b'.repeat(64);
const attemptKey = 'ia4tube.edit.attempt.v1.' + fingerprint;
const pendingKey = 'ia4tube.edit.pending.v1.' + fingerprint;
const legacyId = '0c521fbc-a903-44b8-af74-37cbda3c1371';
const receipt = requestId => ({orderId:'18a1bdb1-0079-4ab3-8a35-ceafda305919',
  status:'awaiting_authorization',fingerprint,requestId});
function memoryStorage(initial = []) {
  const values = new Map(initial);
  return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),
    removeItem:key=>values.delete(key)};
}

test('success allows a new identical purchase immediately, without a button or timer',()=>{
  const global = memoryStorage(), tab = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tab);
  confirmSavedAttempt(receipt(first),global,tab);
  assert.equal(tab.getItem(pendingKey),null);
  const second = getOrCreateRequestId(fingerprint,global,tab);
  assert.notEqual(second,first);
  confirmSavedAttempt(receipt(second),global,tab);
  assert.notEqual(getOrCreateRequestId(fingerprint,global,tab),second);
});

test('an uncertain response retains the same request across retries and a reload',()=>{
  const global = memoryStorage(), tab = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tab);
  assert.equal(getOrCreateRequestId(fingerprint,global,tab),first);
  const reloadedTab = memoryStorage([[pendingKey,tab.getItem(pendingKey)]]);
  assert.equal(getOrCreateRequestId(fingerprint,global,reloadedTab),first);
});

test('simultaneous tabs share the pending request, not duplicate orders',()=>{
  const global = memoryStorage(), tabA = memoryStorage(), tabB = memoryStorage();
  assert.equal(getOrCreateRequestId(fingerprint,global,tabA),
               getOrCreateRequestId(fingerprint,global,tabB));
});

test('lost response in tab B retries the old request after tab A starts a new purchase',()=>{
  const global = memoryStorage(), tabA = memoryStorage(), tabB = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tabA);
  assert.equal(getOrCreateRequestId(fingerprint,global,tabB),first);
  confirmSavedAttempt(receipt(first),global,tabA);
  const second = getOrCreateRequestId(fingerprint,global,tabA);
  assert.notEqual(second,first);
  assert.equal(getOrCreateRequestId(fingerprint,global,tabB),first);
  confirmSavedAttempt(receipt(first),global,tabB);
  assert.equal(getOrCreateRequestId(fingerprint,global,tabA),second);
  assert.equal(global.getItem(attemptKey),second);
});

test('replaying an old receipt cannot clear a newer pending request in the same tab',()=>{
  const global = memoryStorage(), tab = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tab);
  confirmSavedAttempt(receipt(first),global,tab);
  const second = getOrCreateRequestId(fingerprint,global,tab);
  confirmSavedAttempt(receipt(first),global,tab);
  assert.equal(tab.getItem(pendingKey),second);
  assert.equal(getOrCreateRequestId(fingerprint,global,tab),second);
});

test('legacy UUID with a known Gastro receipt retires only that completed attempt',()=>{
  const global = memoryStorage([[attemptKey,legacyId],['unrelated-setting','preserve']]);
  const tab = memoryStorage();
  confirmSavedAttempt(receipt(legacyId),global,tab);
  assert.notEqual(getOrCreateRequestId(fingerprint,global,tab),legacyId);
  assert.equal(global.getItem('unrelated-setting'),'preserve');
});

test('legacy UUID without a confirmed receipt stays available for recovery',()=>{
  const global = memoryStorage([[attemptKey,legacyId]]), tab = memoryStorage();
  assert.equal(getOrCreateRequestId(fingerprint,global,tab),legacyId);
  assert.equal(tab.getItem(pendingKey),legacyId);
});

test('missing or invalid confirmation never retires a pending attempt',()=>{
  const global = memoryStorage(), tab = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tab);
  for (const change of [{orderId:''},{orderId:'invalid'}, {status:'processing'},
                        {fingerprint:'invalid'},{requestId:'invalid'}]) {
    assert.throws(()=>confirmSavedAttempt({...receipt(first),...change},global,tab));
    assert.equal(getOrCreateRequestId(fingerprint,global,tab),first);
  }
});

test('different payloads have separate pending attempts',()=>{
  const global = memoryStorage(), tab = memoryStorage();
  const first = getOrCreateRequestId(fingerprint,global,tab);
  assert.notEqual(getOrCreateRequestId(otherFingerprint,global,tab),first);
  assert.equal(getOrCreateRequestId(fingerprint,global,tab),first);
});

test('unavailable per-tab storage fails before a request can be issued',()=>{
  const global = memoryStorage();
  const failingTab = {getItem:()=>null,setItem:()=>{throw new Error('storage unavailable');}};
  assert.throws(()=>getOrCreateRequestId(fingerprint,global,failingTab),/storage unavailable/);
  const preserved = global.getItem(attemptKey);
  assert.match(preserved,/^[a-f0-9-]{36}$/);
  assert.equal(getOrCreateRequestId(fingerprint,global,memoryStorage()),preserved);
});

test('silent per-tab storage failure also prevents submission',()=>{
  assert.throws(()=>getOrCreateRequestId(fingerprint,memoryStorage(),
    {getItem:()=>null,setItem:()=>{}}),/preservar/);
});

test('a damaged pending record is not silently replaced with a duplicate request',()=>{
  assert.throws(()=>getOrCreateRequestId(fingerprint,memoryStorage(),
    memoryStorage([[pendingKey,'damaged']])));
});
