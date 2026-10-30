import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppAvailability} from '../app-availability.js';
import {createAppCombosBridge} from '../app-combos.js';

const NONCE='n'.repeat(43),REQUEST='12345678-1234-4123-8123-123456789abc';
const OTHER_REQUEST='22345678-1234-4123-8123-123456789abc';
function fixture(){
  let nonce=NONCE,documentUrl='https://ia4tube.com/edit/',navigationMode='ok',timer=0;
  const urls=[],availabilityUrls=[],calls=[],trace=[];
  const availability=createAppAvailability({getNonce:()=>nonce,navigate:url=>availabilityUrls.push(url),
    now:()=>0,requestId:()=>REQUEST,setTimer:()=>++timer,clearTimer:()=>{}});
  const bridge=createAppCombosBridge({getNonce:()=>nonce,getDocumentUrl:()=>documentUrl,
    receiveAvailability:(...args)=>{calls.push(args);return availability.receive(...args);},
    navigate:url=>{trace.push('navigate');if(navigationMode==='throw')throw Error('fixture');
      if(navigationMode==='false')return false;urls.push(url);}});
  const receive=(changes={})=>{
    const value={nonce,id:null,revision:1,image:false,video:false,validForMs:30000,loading:false,capability:true,...changes};
    return bridge.receiveAvailability(value.nonce,value.id,value.revision,value.image,value.video,
      value.validForMs,value.loading,value.capability);
  };
  return {bridge,availability,urls,availabilityUrls,calls,trace,receive,
    setNonce:value=>{nonce=value;},setDocument:value=>{documentUrl=value;},setNavigation:value=>{navigationMode=value;}};
}

test('native capability opens combos synchronously with only the current nonce',()=>{
  const f=fixture();assert.equal(f.receive(),true);
  f.trace.push('before');assert.equal(f.bridge.open(),true);f.trace.push('after');
  assert.deepEqual(f.trace,['before','navigate','after']);
  assert.deepEqual(f.urls,['https://ia4tube.com/edit/app-combos/open?nonce='+NONCE]);
  const url=new URL(f.urls[0]);assert.deepEqual([...url.searchParams.keys()],['nonce']);assert.equal(url.hash,'');
  assert.equal(f.calls[0].length,7,'capability is not an availability/authorization field');
  assert.equal(Object.isFrozen(f.bridge),true);
});

test('app87 seven-argument replies keep the existing hint without a combos navigation or 404',()=>{
  const f=fixture();assert.equal(f.bridge.receiveAvailability(NONCE,null,1,false,false,30000,false),true);
  assert.equal(f.availability.canCreate('image'),false);assert.equal(f.availability.canCreate('video'),false);
  assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
});

test('no reply never assumes native combos support',()=>{
  const f=fixture();assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
});

for(const [label,capability] of [['false',false],['null',null],['missing',undefined],['string','true'],
  ['number',1],['object',{}],['boxed boolean',new Boolean(true)]]){
  test('only literal true grants the optional capability: '+label,()=>{
    const f=fixture();assert.equal(f.receive({capability}),true);
    assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
  });
}

test('a later accepted false or seven-argument reply revokes prior support',()=>{
  for(const omitted of [false,true]){
    const f=fixture();assert.equal(f.receive(),true);
    const args=[NONCE,null,2,false,false,30000,false];if(!omitted)args.push(false);
    assert.equal(f.bridge.receiveAvailability(...args),true);
    assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
  }
});

test('loading and unknown hints can advertise navigation without granting quota',()=>{
  for(const loading of [true,false]){
    const f=fixture();assert.equal(f.receive({image:null,video:null,validForMs:0,loading}),true);
    assert.equal(f.availability.canCreate('image'),null);assert.equal(f.availability.canCreate('video'),null);
    assert.equal(f.bridge.open(),true);
  }
});

test('image gift and unavailable video retain separate hints while combos remain navigation only',()=>{
  const f=fixture();assert.equal(f.receive({image:true,video:false}),true);
  assert.equal(f.availability.canCreate('image'),true);assert.equal(f.availability.canCreate('video'),false);
  assert.equal(f.bridge.open(),true);
  assert.equal(f.availability.canCreate('image'),true);assert.equal(f.availability.canCreate('video'),false);
});

const invalid=[['different nonce',{nonce:'x'.repeat(43)}],['short nonce',{nonce:'n'.repeat(42)}],
  ['bad nonce characters',{nonce:'!'.repeat(43)}],['request ID',{id:'not-a-uuid'}],['negative revision',{revision:-1}],
  ['fractional revision',{revision:1.5}],['unsafe revision',{revision:Number.MAX_SAFE_INTEGER+1}],
  ['image flag',{image:'false'}],['video flag',{video:1}],['negative lifetime',{validForMs:-1}],
  ['long lifetime',{validForMs:30001}],['loading flag',{loading:'true'}]];
for(const [label,changes] of invalid){
  test('rejected availability cannot enable native navigation: '+label,()=>{
    const f=fixture();assert.equal(f.receive(changes),false);
    assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
  });
}

test('an older revision cannot turn support on or revoke a newer accepted capability',()=>{
  const f=fixture();assert.equal(f.receive({revision:5,capability:false}),true);
  assert.equal(f.receive({revision:4}),false);assert.equal(f.bridge.open(),false);
  assert.equal(f.receive({revision:6}),true);
  assert.equal(f.receive({revision:5,capability:false}),false);assert.equal(f.bridge.open(),true);
});

test('pending request correlation is validated before accepting the capability',()=>{
  const f=fixture();f.receive({capability:false});assert.equal(f.availability.refresh(),true);
  assert.equal(f.receive({id:OTHER_REQUEST,revision:2}),false);assert.equal(f.bridge.open(),false);
  assert.equal(f.receive({id:REQUEST,revision:2,image:null,video:null,validForMs:0,loading:true}),true);
  assert.equal(f.bridge.open(),true);
  assert.equal(f.receive({id:null,revision:3,capability:false}),false);
});

test('changing the native nonce cannot reuse the previous document capability',()=>{
  const f=fixture();f.receive();f.setNonce('x'.repeat(43));
  assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
});

test('same-host www document uses its own trusted origin and drops page query/fragment',()=>{
  const f=fixture();f.setDocument('https://www.ia4tube.com/edit/?app_version=88#app-calendar='+NONCE);f.receive();
  assert.equal(f.bridge.open(),true);
  assert.deepEqual(f.urls,['https://www.ia4tube.com/edit/app-combos/open?nonce='+NONCE]);
});

test('the trusted edit document without trailing slash matches the native document policy',()=>{
  const f=fixture();f.setDocument('https://ia4tube.com/edit?app_version=88');f.receive();
  assert.equal(f.bridge.open(),true);
  assert.deepEqual(f.urls,['https://ia4tube.com/edit/app-combos/open?nonce='+NONCE]);
});

for(const documentUrl of ['https://other.example/edit/','https://ia4tube.com.evil.example/edit/',
  'http://ia4tube.com/edit/','https://user@ia4tube.com/edit/','https://ia4tube.com:444/edit/',
  'https://ia4tube.com/','https://ia4tube.com/edit/other','not-a-url']){
  test('invalid source document cannot navigate: '+documentUrl,()=>{
    const f=fixture();f.setDocument(documentUrl);f.receive();assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);
  });
}

test('navigation errors and explicit false remain a synchronous unsuccessful action',()=>{
  for(const mode of ['throw','false']){
    const f=fixture();f.receive();f.setNavigation(mode);
    assert.equal(f.bridge.open(),false);assert.deepEqual(f.urls,[]);assert.deepEqual(f.trace,['navigate']);
  }
});
