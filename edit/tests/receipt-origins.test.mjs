import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {normalizeReceipt,SUBMIT_ENDPOINT} from '../order-adapter.js';

const ticket='12345678-1234-4123-8123-123456789abc.'+'A'.repeat(43);
const context=ticket.split('.')[0].replaceAll('-','');
const contextHash=createHash('sha256').update(ticket).digest('hex');
const orderId='d70c9c97-8743-47c4-bbae-e218ac8d919f';
const configuredOrigin='https://marcagrande-pedidos-505450944454.us-central1.run.app';
const secret='B'.repeat(43);
const payload={mediaKind:'video',durationSeconds:10,appCalendar:{ticket}};
const receipt=(receiptUrl,state='reserved')=>({orderId,receiptUrl,status:'awaiting_authorization',totalCents:2300,
  admission:{schemaVersion:1,admissionId:'22345678-1234-4123-8123-123456789abc',editOrderId:orderId,
    requestHash:'a'.repeat(64),contextHash,mediaKind:'video',quantity:1,state,reservedAt:1793331000000,
    planningId:'pm_edit_'+context,pedidoId:'edit_'+context}});
const normalize=value=>normalizeReceipt(value,payload,{requireAdmission:true,contextHash});

for(const origin of [new URL(SUBMIT_ENDPOINT).origin,configuredOrigin])for(const state of ['reserved','bound'])
  test('keeps the exact official receipt URL for '+origin+' and '+state,()=>{
    const receiptUrl=origin+'/r/'+orderId+'#'+secret;
    const result=normalize(receipt(receiptUrl,state));
    assert.equal(result.receiptUrl,receiptUrl);assert.equal(result.admission.state,state);
    assert.equal(result.orderId,orderId);assert.equal(result.totalCents,2300);
  });

const invalid={
  'HTTP alias':'http://marcagrande-pedidos-505450944454.us-central1.run.app/r/'+orderId+'#'+secret,
  'other port':configuredOrigin+':444/r/'+orderId+'#'+secret,
  'numeric hostname suffix':configuredOrigin+'.attacker.test/r/'+orderId+'#'+secret,
  'historical hostname suffix':new URL(SUBMIT_ENDPOINT).origin+'.attacker.test/r/'+orderId+'#'+secret,
  'another Cloud Run service':'https://other-505450944454.us-central1.run.app/r/'+orderId+'#'+secret,
  'username':'https://user@marcagrande-pedidos-505450944454.us-central1.run.app/r/'+orderId+'#'+secret,
  'password':'https://user:pass@marcagrande-pedidos-505450944454.us-central1.run.app/r/'+orderId+'#'+secret,
  'query':configuredOrigin+'/r/'+orderId+'?download=1#'+secret,
  'different order path':configuredOrigin+'/r/22345678-1234-4123-8123-123456789abc#'+secret,
  'trailing path slash':configuredOrigin+'/r/'+orderId+'/#'+secret,
  'missing fragment':configuredOrigin+'/r/'+orderId,
  'short fragment':configuredOrigin+'/r/'+orderId+'#'+secret.slice(1),
  'long fragment':configuredOrigin+'/r/'+orderId+'#'+secret+'B',
  'encoded fragment':configuredOrigin+'/r/'+orderId+'#%42'+secret.slice(1),
  'relative URL':'/r/'+orderId+'#'+secret,
  'missing URL':undefined,
};
for(const [label,receiptUrl] of Object.entries(invalid))test('rejects '+label+' without weakening receipt checks',()=>{
  assert.throws(()=>normalize(receipt(receiptUrl)),/A confirmação não preservou o comprovante/);
});

test('official alias never bypasses admission identity or cancelled-state validation',()=>{
  const value=receipt(configuredOrigin+'/r/'+orderId+'#'+secret);
  for(const change of [{contextHash:'f'.repeat(64)},{editOrderId:'22345678-1234-4123-8123-123456789abc'},
    {mediaKind:'image'},{state:'cancelled'}])
    assert.throws(()=>normalize({...value,admission:{...value.admission,...change}}),/não confirmou a reserva/);
});

test('entry and every changed module edge load the receipt fix with a new cache version',async()=>{
  for(const [file,target,version] of [['index.html','app.js','20261030-media-quota-v1'],
    ['app.js','order.js','20261030-media-quota-v1'],['order.js','order-adapter.js','20261030-receipt-alias-v1']]) {
    const source=await readFile(new URL('../'+file,import.meta.url),'utf8');
    assert.ok(source.includes('./'+target+'?v='+version),file+' must version '+target);
  }
});
