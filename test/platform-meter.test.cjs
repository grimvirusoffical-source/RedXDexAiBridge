'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {PlatformMeter,POLLING,trackBackgroundWork}=require('../app/platform-meter.cjs');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const profile=()=>({sub:'person',deviceId:'a'.repeat(64),accepted:true,limits:{weeklyMinutes:120},usage:{activeMs:1000}});
async function backendFixture(){
 const crypto=require('node:crypto'),{createPlatform,monday}=require('../services/bridge-platform/index.cjs'),{MemoryStore}=require('../services/bridge-platform/store.cjs');
 const clock=new Clock();clock.time=Date.UTC(2026,10,2);const store=new MemoryStore(),api=createPlatform({store,ownerSubjects:['owner'],ipHashKey:'fixture-meter-hash-key-at-least-32-characters',now:clock.now,legalDocuments:['terms','privacy','agreement'].map(id=>({id,title:id,content:'Meter test fixture.'}))});
 const initial={verified:true,sub:'person'},keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString(),challenge=await api.dispatch(initial,'/device/challenge');
 const enrollment=await api.dispatch(initial,'/device/enroll',{nonce:challenge.nonce,publicKey,signature:crypto.sign(null,Buffer.from('bridge-enroll:'+challenge.nonce),keys.privateKey).toString('base64url'),label:'Meter fixture'});
 const actor={...initial,deviceId:enrollment.deviceId,deviceVerified:true},read=await api.dispatch(actor,'/legal/read',{version:api.legalVersion});await api.dispatch(actor,'/legal/accept',{grant:read.grant,read:true,agree:true});
 const calls=[],client={call:async(route,body)=>{calls.push({route,body});return api.dispatch(actor,route,body);},status:async()=>({...await api.dispatch(actor,'/me'),deviceId:actor.deviceId})};
 const meter=new PlatformMeter({client,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,stopWork:()=>{}});
 const exhaust=()=>{store.value.members.person.usage={weekStartMs:monday(clock.now()),activeMs:120*60000,terminalMs:0,crawlerPages:0};};
 return{clock,store,api,actor,meter,calls,exhaust};
}
test('a verified paid subscription restores exhausted Free work without restart and still requires a new server lease',async()=>{
 const f=await backendFixture();f.exhaust();await assert.rejects(f.meter.begin('process_start'),error=>error.code==='weekly_time_limit');assert.ok(f.meter.failed);
 const order=await f.api.dispatch(f.actor,'/checkout/quote',{kind:'subscription',tier:'gold'});
 await f.api.applyPayment({verified:true,paid:true,eventId:'evt_meter_paid',checkoutSessionId:'cs_meter_paid',orderId:order.id,sub:f.actor.sub,deviceId:f.actor.deviceId,amountCents:799,currency:'usd',subscriptionId:'sub_meter_fixture',periodEndMs:f.clock.now()+30*86400000});
 await f.meter.recover();assert.equal(f.meter.tasks.size,0);assert.equal(f.meter.lease,null);assert.equal(f.calls.filter(call=>call.route==='/usage/start').length,1);
 const finish=await f.meter.begin('run_command');assert.equal(f.calls.filter(call=>call.route==='/usage/start').length,2);await f.clock.tick(1000);await finish();assert.equal((await f.api.dispatch(f.actor,'/me')).usage.activeMs,120*60000+1000);
});
test('weekly recovery uses the current server reset rather than local failure age or a cached profile',async()=>{
 const f=await backendFixture();f.exhaust();await assert.rejects(f.meter.begin('crawl_start'));await assert.rejects(f.meter.recover(),error=>error.code==='weekly_time_limit');assert.ok(f.meter.failed);
 await f.clock.tick(7*86400000);await f.meter.recover();assert.equal((await f.api.dispatch(f.actor,'/me')).usage.activeMs,0);const finish=await f.meter.begin('read_text_file');await f.clock.tick(750);await finish();assert.equal((await f.api.dispatch(f.actor,'/me')).usage.activeMs,750);
});
test('recovery requires fresh authenticated accepted allowance, coalesces requests and never resumes old work',async()=>{
 const f=fixture(),pending=deferred();let reads=0;f.meter.client.status=async()=>{reads++;return pending.promise;};f.meter.fail(Error('Previous allowance failure'));
 const first=f.meter.recover(),second=f.meter.recover();assert.equal(first,second);await flush();assert.equal(reads,1);assert.ok(f.meter.failed);assert.equal(f.calls.length,0);
 pending.resolve(profile());assert.deepEqual(await first,{recovered:true});assert.equal(f.meter.failed,null);assert.equal(f.meter.tasks.size,0);assert.equal(f.meter.lease,null);assert.equal(f.calls.length,0);
 const finish=await f.meter.begin('process_start');assert.equal(f.calls[0].route,'/usage/start');await finish();assert.equal(reads,1);
});
test('unaccepted, exhausted, malformed or failed profile checks cannot clear a cached meter failure',async()=>{
 const changes=[value=>({...value,accepted:false}),value=>({...value,sub:'constructor'}),value=>({...value,deviceId:'other-device'}),value=>({...value,limits:{weeklyMinutes:NaN}}),value=>({...value,usage:{activeMs:-1}}),value=>({...value,usage:{activeMs:120*60000}})];
 for(const change of changes){const f=fixture(),original=Error('Original failure');f.meter.client.status=async()=>change(profile());f.meter.fail(original);await assert.rejects(f.meter.recover());assert.equal(f.meter.failed,original);assert.equal(f.calls.length,0);}
 const f=fixture(),original=Error('Original failure');f.meter.client.status=async()=>{throw Error('Offline');};f.meter.fail(original);await assert.rejects(f.meter.recover(),/Offline/);assert.equal(f.meter.failed,original);
});
test('late recovery cannot undo an explicit disconnect and healthy refresh never interrupts active work',async()=>{
 const f=fixture(),pending=deferred();f.meter.client.status=()=>pending.promise;f.meter.fail(Error('Quota failure'));const recovery=f.meter.recover();await flush();const stop=f.meter.stop();pending.resolve(profile());await assert.rejects(recovery,/cancelled/);await stop;assert.ok(f.meter.failed);assert.equal(f.meter.tasks.size,0);assert.equal(f.calls.length,0);
 const healthy=fixture(),end=await healthy.meter.begin('read_text_file'),lease=healthy.meter.lease;healthy.meter.client.status=async()=>{throw Error('Healthy recovery must not fetch');};assert.deepEqual(await healthy.meter.recover(),{recovered:false});assert.equal(healthy.meter.lease,lease);assert.equal(healthy.meter.tasks.size,1);await end();
});
test('failed stop acknowledgement retains settlement evidence until an authoritative retry succeeds',async()=>{
 const f=fixture(),original=f.meter.client.call.bind(f.meter.client);let stops=0;f.meter.client.call=async(route,body)=>{if(route==='/usage/stop'&&++stops===1)return{};return original(route,body);};f.meter.client.status=async()=>profile();
 const finish=await f.meter.begin('process_start');await f.clock.tick(1000);await assert.rejects(finish(),/settlement/);assert.ok(f.meter.failed);assert.ok(f.meter.settlementLease);assert.equal(f.meter.lease,null);
 await f.meter.recover();assert.equal(stops,2);assert.equal(f.chargedMs,1000);assert.equal(f.meter.failed,null);assert.equal(f.meter.settlementLease,null);assert.equal(f.calls.filter(call=>call.route==='/usage/start').length,1);
});
test('explicit stop settles a failed heartbeat without silently clearing its failure',async()=>{
 const f=fixture();await f.meter.begin('process_start');f.heartbeatFails();await f.clock.tick(5000);assert.ok(f.meter.settlementLease);await f.clock.tick(1000);await f.meter.stop();assert.equal(f.chargedMs,6000);assert.ok(f.meter.failed);assert.equal(f.meter.settlementLease,null);
 f.meter.client.status=async()=>profile();await f.meter.recover();assert.equal(f.meter.failed,null);
});
test('a late acknowledged heartbeat is kept only for exact-sequence settlement after local expiry',async()=>{
 const f=fixture();await f.meter.begin('process_start');const held=f.holdHeartbeat();await f.clock.tick(5000);await f.clock.tick(10000);assert.ok(f.meter.failed);assert.equal(f.meter.lease,null);assert.equal(f.meter.tasks.size,0);
 held.resolve();await flush();assert.equal(f.meter.settlementLease.sequence,1);assert.equal(f.meter.lease,null);await f.meter.stop();assert.equal(f.calls.at(-1).route,'/usage/stop');assert.equal(f.calls.at(-1).body.sequence,2);assert.equal(f.chargedMs,15000);assert.ok(f.meter.failed);assert.equal(f.calls.filter(call=>call.route==='/usage/start').length,1);
 f.meter.client.status=async()=>({...profile(),usage:{activeMs:f.chargedMs}});await f.meter.recover();assert.equal(f.meter.lease,null);assert.equal(f.meter.tasks.size,0);
});
test('meter notifications contain signals only and observer failures cannot change accounting',async()=>{
 const signals=[],f=fixture({onChange:value=>{signals.push(value);throw Error('Observer unavailable');}}),end=await f.meter.begin('process_start');await f.clock.tick(5000);await end();await f.meter.stop();
 assert.deepEqual(signals.map(value=>value.reason),['start','heartbeat','settled','stop']);for(const value of signals)assert.deepEqual(Object.keys(value),['reason']);assert.equal(f.chargedMs,5000);assert.equal(f.meter.failed,null);
});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
class Clock {
 constructor(){this.time=1000;this.timers=new Map();this.next=0;}
 now=()=>this.time;
 setTimer=(fn,ms)=>{const key=++this.next;this.timers.set(key,{at:this.time+ms,fn});return key;};
 clearTimer=key=>this.timers.delete(key);
 async tick(ms){const end=this.time+ms;while(true){const due=[...this.timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];if(!due)break;this.time=due[1].at;this.timers.delete(due[0]);due[1].fn();await flush();}this.time=end;await flush();}
}
function fixture({leaseMs=15000,onChange=()=>{}}={}){
 const clock=new Clock(),calls=[];let stopped=0,session=null,chargedMs=0,heartbeats=0,hold=null,heartbeatError=null,crawlerError=null;
 const client={async call(route,body){
  calls.push({route,body:{...body},at:clock.time});
  if(route==='/usage/start'){
   assert.equal(session,null,'concurrent tools must not create a second work session');
   session={id:'session-'+calls.length,sequence:0,last:clock.time};return{sessionId:session.id,leaseUntilMs:clock.time+leaseMs,heartbeatSeconds:10};
  }
  if(route==='/usage/crawler'){if(crawlerError)throw crawlerError;return{usedPages:1};}
  assert.ok(session,'settlement requires an existing lease');assert.equal(body.sessionId,session.id);assert.equal(body.sequence,session.sequence+1,'strict sequential heartbeat/stop settlement');
  if(route==='/usage/heartbeat'&&heartbeatError)throw heartbeatError;
  chargedMs+=clock.time-session.last;session.last=clock.time;session.sequence=body.sequence;
  if(route==='/usage/stop'){session=null;return{stopped:true,leaseUntilMs:clock.time};}
  assert.equal(route,'/usage/heartbeat');heartbeats++;
  const result={leaseUntilMs:clock.time+leaseMs,stopped:false};
  if(hold){const d=hold;hold=null;await d.promise;return result;}
  return result;
 }};
 const meter=new PlatformMeter({client,stopWork:()=>{stopped++;},onChange,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
 return{clock,calls,meter,get stopped(){return stopped;},get chargedMs(){return chargedMs;},get heartbeats(){return heartbeats;},holdHeartbeat(){hold=deferred();return hold;},heartbeatFails(error=Error('network unavailable')){heartbeatError=error;},crawlerFails(error){crawlerError=error;}};
}
test('many concurrent AIs are charged the union of active time, not one clock per task',async()=>{
 const f=fixture(),finishes=await Promise.all(Array.from({length:1000},(_,i)=>f.meter.begin(i%2?'process_start':'crawl_start',{clientId:'ai_'+i})));
 assert.equal(f.calls.filter(c=>c.route==='/usage/start').length,1);assert.equal(f.calls[0].body.mode,'bridge');
 await f.clock.tick(8000);await Promise.all(finishes.slice(0,500).map(end=>end()));
 assert.equal(f.meter.tasks.size,500);assert.equal(f.calls.filter(c=>c.route==='/usage/stop').length,0);
 await f.clock.tick(4000);await Promise.all(finishes.slice(500).map(end=>end()));
 assert.equal(f.chargedMs,12000);assert.equal(f.calls.filter(c=>c.route==='/usage/stop').length,1);assert.equal(f.meter.lease,null);assert.equal(f.stopped,0);
});
test('continuous joining and finishing tasks cannot postpone the heartbeat or remove the expiry timer',async()=>{
 const f=fixture(),anchor=await f.meter.begin('run_command');
 for(let i=0;i<180;i++){const end=await f.meter.begin(i%2?'read_text_file':'crawl_start');await f.clock.tick(100);await end();assert.notEqual(f.meter.expiry,null);}
 assert.equal(f.heartbeats,3);assert.equal(f.calls.filter(c=>c.route==='/usage/start').length,1);assert.equal(f.stopped,0);
 await anchor();assert.equal(f.chargedMs,18000);
});
test('polling and control-only commands never create work leases',async()=>{
 const f=fixture();for(const name of POLLING){const end=await f.meter.begin(name);await end();}
 assert.equal(f.calls.length,0);assert.equal(f.meter.tasks.size,0);
 const done=await f.meter.begin('process_start');await f.clock.tick(900);
 for(const name of POLLING)await(await f.meter.begin(name))();
 assert.equal(f.calls.length,1);await done();assert.equal(f.chargedMs,900);
});
test('absolute expiry stops work while a heartbeat HTTP response is still in flight and rejects late resurrection',async()=>{
 const f=fixture(),done=await f.meter.begin('process_start'),held=f.holdHeartbeat();
 await f.clock.tick(5000);assert.equal(f.calls.at(-1).route,'/usage/heartbeat');
 const queued=f.meter.begin('crawl_start');const denied=assert.rejects(queued,/renewed/);
 await f.clock.tick(10000);assert.equal(f.stopped,1);assert.equal(f.meter.lease,null);assert.equal(f.meter.tasks.size,0);
 await assert.rejects(f.meter.begin('read_text_file'),/renewed/);
 held.resolve();await flush();await denied;await done();assert.equal(f.meter.lease,null);assert.equal(f.stopped,1);
});
test('heartbeat communication failure fails closed immediately and prevents new work',async()=>{
 const f=fixture(),done=await f.meter.begin('crawl_start');f.heartbeatFails();await f.clock.tick(5000);
 assert.equal(f.stopped,1);assert.equal(f.meter.lease,null);assert.equal(f.clock.timers.size,0);await assert.rejects(f.meter.begin('process_start'),/network unavailable/);await done();
});
test('normal completion is idempotent and settles only after the final concurrent task ends',async()=>{
 const f=fixture(),a=await f.meter.begin('crawl_start'),b=await f.meter.begin('read_text_file');await f.clock.tick(2300);
 await Promise.all([a(),a()]);assert.equal(f.meter.tasks.size,1);assert.equal(f.calls.length,1);
 await Promise.all([b(),b()]);assert.equal(f.calls.filter(c=>c.route==='/usage/stop').length,1);assert.equal(f.chargedMs,2300);assert.equal(f.stopped,0);
});
test('explicit disconnect stops local work immediately and settles an acknowledged in-flight heartbeat with the right sequence',async()=>{
 const f=fixture();await f.meter.begin('process_start');const held=f.holdHeartbeat();await f.clock.tick(5000);await f.clock.tick(1000);
 const stop=f.meter.stop();assert.equal(f.stopped,1);assert.equal(f.meter.tasks.size,0);assert.equal(f.clock.timers.size,0);
 held.resolve();await stop;assert.equal(f.meter.lease,null);assert.equal(f.calls.at(-1).body.sequence,2);assert.equal(f.chargedMs,6000);
 const end=await f.meter.begin('read_text_file');await end();assert.equal(f.calls.filter(c=>c.route==='/usage/start').length,2);
});
test('revocation before or during the initial entitlement request never starts a task',async()=>{
 const f=fixture();await assert.rejects(f.meter.begin('process_start',{isActive:()=>false}),/revoked/);assert.equal(f.calls.length,0);
 const pending=deferred(),clock=new Clock(),calls=[];let active=true;
 const meter=new PlatformMeter({now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,client:{async call(route,body){calls.push({route,body});if(route==='/usage/start')return pending.promise;return{stopped:true};}}});
 const start=meter.begin('process_start',{isActive:()=>active});await flush();active=false;pending.resolve({sessionId:'revoked',leaseUntilMs:clock.time+15000});await assert.rejects(start,/revoked/);
 assert.equal(meter.tasks.size,0);assert.equal(meter.lease,null);assert.equal(calls.at(-1).route,'/usage/stop');
});
test('disconnect during the initial request settles a never-started reservation when its acknowledgement arrives',async()=>{
 const pending=deferred(),clock=new Clock(),calls=[];let stopped=0;
 const meter=new PlatformMeter({now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,stopWork:()=>stopped++,client:{async call(route,body){calls.push({route,body});return route==='/usage/start'?pending.promise:{stopped:true};}}});
 const start=meter.begin('process_start'),denied=assert.rejects(start,/cancelled/);await flush();const stop=meter.stop();
 pending.resolve({sessionId:'unused',leaseUntilMs:clock.time+15000});await denied;await stop;
 assert.equal(meter.tasks.size,0);assert.equal(meter.lease,null);assert.equal(stopped,0);assert.deepEqual(calls.map(c=>c.route),['/usage/start','/usage/stop']);assert.equal(calls[1].body.sequence,1);
});
test('page quotas refuse a crawl without stopping another entitled task; network failure stops shared work',async()=>{
 const f=fixture(),a=await f.meter.begin('process_start'),b=await f.meter.begin('crawl_start');
 f.crawlerFails(Object.assign(Error('page allowance reached'),{code:'weekly_crawler_limit'}));await assert.rejects(f.meter.crawlerPage(),/page allowance/);assert.equal(f.stopped,0);assert.equal(f.meter.tasks.size,2);
 await b();f.crawlerFails(Error('network unavailable'));await assert.rejects(f.meter.crawlerPage(),/network unavailable/);assert.equal(f.stopped,1);await a();
});
test('invalid and unbounded server leases never permit unbounded offline work',async()=>{
 for(const result of [{sessionId:'bad',leaseUntilMs:0},{sessionId:'bad',leaseUntilMs:Infinity},{leaseUntilMs:99999}]){
  const clock=new Clock();let stopped=0;const meter=new PlatformMeter({client:{call:async()=>result},stopWork:()=>stopped++,now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer});await assert.rejects(meter.begin('read_text_file'),/valid/);assert.equal(meter.tasks.size,0);assert.equal(stopped,1);
 }
 const f=fixture({leaseMs:86400000});await f.meter.begin('process_start');assert.equal(f.meter.lease.leaseUntilMs,f.clock.time+15000);
});
test('a malformed heartbeat acknowledgement stops work instead of renewing from stale metadata',async()=>{
 const clock=new Clock();let stopped=0;
 const meter=new PlatformMeter({now:clock.now,setTimer:clock.setTimer,clearTimer:clock.clearTimer,stopWork:()=>stopped++,client:{call:async route=>route==='/usage/start'?{sessionId:'a',leaseUntilMs:clock.time+15000}:{} }});
 await meter.begin('process_start');await clock.tick(5000);assert.equal(stopped,1);assert.equal(meter.lease,null);await assert.rejects(meter.begin('read_text_file'),/invalid.*acknowledgement/);
});
test('background ownership outlives the initiating response and releases immediately on a process exit event',async()=>{
 const clock=new Clock(),child=new EventEmitter();let running=true,finished=0;
 const tracker=trackBackgroundWork({finish:()=>{finished++;},isRunning:()=>running,subscribe:callback=>{child.once('close',callback);return()=>child.removeListener('close',callback);},setTimer:clock.setTimer,clearTimer:clock.clearTimer});
 await clock.tick(1000);assert.equal(finished,0);running=false;child.emit('close');await flush();assert.equal(finished,1);assert.equal(clock.timers.size,0);assert.equal(child.listenerCount('close'),0);tracker.settle();await flush();assert.equal(finished,1);
});
test('crawler background completion uses bounded local observation, never network polling charges',async()=>{
 const clock=new Clock();let running=true,finished=0;
 trackBackgroundWork({finish:()=>{finished++;},isRunning:()=>running,setTimer:clock.setTimer,clearTimer:clock.clearTimer});
 await clock.tick(1200);assert.equal(finished,0);running=false;await clock.tick(50);assert.equal(finished,1);assert.equal(clock.timers.size,0);
});
test('failed process-exit subscriptions fall back to local completion observation without orphaning work',async()=>{
 const clock=new Clock();let running=true,finished=0;
 trackBackgroundWork({finish:()=>finished++,isRunning:()=>running,subscribe:()=>{throw Error('fixture subscription unavailable');},setTimer:clock.setTimer,clearTimer:clock.clearTimer});
 await clock.tick(700);assert.equal(finished,0);running=false;await clock.tick(50);assert.equal(finished,1);
});
