'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RedXStore,Conflict,empty}=require('./store.cjs');
const key='scoped-fixture-credential-only';
const response=(status,body,capable=true)=>({status,ok:status>=200&&status<300,headers:new Headers(capable?{'x-redx-record-cas':'1'}:{}),json:async()=>structuredClone(body)});
const fixture=(request)=>new RedXStore({base:'http://127.0.0.1:17790',key,database:'bridge_platform_v1',request});

test('RedX requires an explicit reserved Bridge namespace before any request',()=>{
 let requests=0;const request=async()=>{requests++;throw Error('Unexpected request');};
 for(const database of [undefined,null,'','redx_accounts','redxai_accounts','default','bridge','bridge_platform_','bridge_platform_live-1','bridge_platform_v1\n','bridge_platform_'+ 'a'.repeat(49),{},['bridge_platform_v1']]){
  assert.throws(()=>new RedXStore({base:'http://127.0.0.1:17790',key,database,request}),/explicit isolated Bridge database/);
 }
 for(const database of ['bridge_platform','bridge_platform_v1','bridge_platform_sandbox_v1'])assert.equal(new RedXStore({base:'http://127.0.0.1:17790',key,database,request}).base,'http://127.0.0.1:17790/v1/db/'+database);
 assert.equal(requests,0);
});

test('RedX preserves the typed persisted envelope across initial insert and update',async()=>{
 let persisted=null,sequence=0;const calls=[];
 const store=fixture(async(url,options)=>{
  calls.push({url,options});
  assert.match(decodeURIComponent(new URL(url).pathname),/^\/v1\/db\/bridge_platform_v1\/record-cas\/rxa-bridge-platform\.red-xai\.db:Record\[ID=\d+\]$/);
  if(options.method!=='POST')return persisted?response(200,{record:persisted}):response(404,{code:'record_not_found'});
  const body=JSON.parse(options.body);
  if(body.expected_revision!==(persisted?.revision??0))return response(409,{code:'record_conflict'});
  persisted=body.record;sequence++;return response(200,{ok:true,revision:persisted.revision,seq:sequence,local_seq:sequence,sequence_scope:'native-file'});
 });
 const initial=await store.load();assert.deepEqual(initial,empty());
 await store.save({...initial,revision:1,members:{alice:{tier:'gold'}}},0);
 const first=await store.load();assert.equal(first.key,store.recordKey);assert.equal(first.members.alice.tier,'gold');
 await store.save({...first,revision:2,members:{alice:{tier:'silver'}}},1);
 assert.equal((await store.load()).members.alice.tier,'silver');
 await assert.rejects(()=>store.save({...first,revision:2},1),Conflict);
 assert.equal((await store.load()).revision,2);
 assert.ok(calls.every(({options})=>options.redirect==='error'&&options.headers.authorization==='Bearer '+key));
});

test('RedX rejects collisions, mismatched revisions and untyped legacy Box responses',async()=>{
 const good={key:'bridge-platform-v1',revision:3,payload:JSON.stringify({schema:1,key:'bridge-platform-v1',revision:3})};
 for(const body of [
  {record:{...good,key:'other-platform'}},
  {record:{...good,revision:4}},
  {record:{...good,revision:0}},
  {record:{...good,revision:1.5}},
  {record:{...good,payload:JSON.stringify({schema:2,key:good.key,revision:3})}},
  {record:{...good,payload:JSON.stringify({schema:1,key:'different-namespace',revision:3})}},
  {record:{...good,payload:{schema:1,key:good.key,revision:3}}},
  {value:good.payload},
 ])await assert.rejects(()=>fixture(async()=>response(200,body)).load(),/Invalid platform state/);
});

test('an unknown legacy route cannot masquerade as a missing initial record',async()=>{
 await assert.rejects(()=>fixture(async()=>response(404,{error:'not found'},false)).load(),/capability unavailable/);
 await assert.rejects(()=>fixture(async()=>response(404,{error:'not found'})).load(),/Account database unavailable/);
 assert.deepEqual(await fixture(async()=>response(404,{code:'record_not_found'})).load(),empty());
});

test('unsupported, asynchronous and unconfirmed CAS writes fail without a query fallback',async()=>{
 for(const [status,body,capable]of [
  [404,{},false],[501,{}],[503,{error:'synchronous_durability_required'}],
  [202,{ok:true,revision:1,seq:1}],[200,{ok:true,revision:2,seq:1}],
  [200,{ok:true,revision:1}],[200,{ok:true,revision:1,seq:0}],
  [200,{ok:true,revision:1,seq:'1'}],[200,{ok:false,revision:1,seq:1}],
 ]){
  const calls=[];const store=fixture(async(url)=>{calls.push(url);return response(status,body,capable);});
  await assert.rejects(()=>store.save({...empty(),revision:1},0),/Account database/);
  assert.equal(calls.length,1);assert.match(calls[0],/\/record-cas\//);
 }
});

test('invalid or exhausted revision input never reaches RedX',async()=>{
 let calls=0;const store=fixture(async()=>{calls++;throw Error('Unexpected request');});
 for(const [state,expected]of [
  [{schema:1,revision:0},0],[{schema:1,revision:2},0],
  [{schema:1,revision:1},-1],[{schema:1,revision:2},1.5],
  [{schema:1,revision:Number.MAX_SAFE_INTEGER+1},Number.MAX_SAFE_INTEGER],
  [{schema:1,revision:1,key:'different'},0],[{schema:2,revision:1},0],
 ])await assert.rejects(()=>store.save(state,expected),/Invalid platform state revision/);
 assert.equal(calls,0);
});

test('a global offset or ambiguous post-commit receipt cannot confirm native-file durability',async()=>{
 const valid={ok:true,revision:1,seq:7,local_seq:7,sequence_scope:'native-file'};
 for(const body of [
  {ok:true,revision:1,seq:7},
  {...valid,sequence_scope:'replication-log'},
  {...valid,local_seq:0},{...valid,local_seq:'7'},
  {...valid,local_seq:8},{...valid,seq:8},
  {...valid,seq:Number.MAX_SAFE_INTEGER+1,local_seq:Number.MAX_SAFE_INTEGER+1},
 ])await assert.rejects(()=>fixture(async()=>response(200,body)).save({...empty(),revision:1},0),error=>!(error instanceof Conflict)&&/did not confirm/.test(error.message));
 await fixture(async()=>response(200,valid)).save({...empty(),revision:1},0);
 await assert.rejects(()=>fixture(async()=>response(503,{error:'commit result unavailable'})).save({...empty(),revision:1},0),error=>!(error instanceof Conflict));
});
