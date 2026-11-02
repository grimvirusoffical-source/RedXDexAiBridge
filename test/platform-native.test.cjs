'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {PlatformClient}=require('../app/platform-client.cjs');
const {PlatformMeter}=require('../app/platform-meter.cjs');
const {profileAllowed,restrictTools,assertProfile}=require('../app/tool-profiles.cjs');
test('restricted AI connection never includes desktop or file-writing tools',()=>{
 const tools=['bridge_status','process_start','crawl_start','desktop_mouse','write_text_file'].map(name=>({name}));
 assert.deepEqual(restrictTools(tools,['bridge','terminal']).map(t=>t.name),['bridge_status','process_start']);
 assert.equal(profileAllowed('crawl_start','crawler'),true);assert.throws(()=>assertProfile('desktop_mouse',['terminal']),/does not allow/);assert.throws(()=>restrictTools(tools,['invented']),/Unknown/);
});
test('platform credentials remain native and each device request binds its exact body and URL',async()=>{
 let saved='',pub='',seen=0;const now=1700000000000;
 const request=async(url,options)=>{const u=new URL(url),b=JSON.parse(options.body);assert.equal(options.headers.authorization,'Bearer fixture-private-token');assert.equal(options.redirect,'error');
  if(u.pathname.endsWith('/device/challenge'))return Response.json({nonce:'n'.repeat(30)});
  if(u.pathname.endsWith('/device/enroll')){pub=b.publicKey;assert.equal(crypto.verify(null,Buffer.from('bridge-enroll:'+b.nonce),pub,Buffer.from(b.signature,'base64url')),true);return Response.json({deviceId:crypto.createHash('sha256').update(pub).digest('hex')});}
  const h=options.headers;const canonical=[options.method,u.pathname+u.search,crypto.createHash('sha256').update(options.body).digest('hex'),h['X-Bridge-Time'],h['X-Bridge-Nonce']].join('\n');assert.equal(crypto.verify(null,Buffer.from(canonical),pub,Buffer.from(h['X-Bridge-Signature'],'base64url')),true);assert.equal(h['X-Bridge-Time'],String(now));seen++;return Response.json({accepted:false,role:'user'});
 };
 const c=new PlatformClient({request,credentials:async()=>({provider:'quick',sub:'test-user',access:'fixture-private-token'}),loadSecret:async()=>saved,saveSecret:async(_n,v)=>{saved=v;},now:()=>now});
 const me=await c.status();assert.equal(me.role,'user');assert.match(me.deviceId,/^[a-f0-9]{64}$/);await c.call('/legal/read',{version:'v1'});assert.equal(seen,2);assert.equal(Object.hasOwn(me,'privateKey'),false);
 await assert.rejects(c.call('/../owner'),/Invalid platform/);
});
test('overlapping work shares a reservation and stops only after the final task',async()=>{
 const calls=[];let stopped=0;const client={call:async(route,body)=>{calls.push({route,body});return route==='/usage/start'?{sessionId:'work',leaseUntilMs:Date.now()+15000}:{stopped:route==='/usage/stop'};}};
 const m=new PlatformMeter({client,stopWork:()=>stopped++});const a=await m.begin('read_text_file',{}),b=await m.begin('list_files',{});assert.equal(calls.filter(x=>x.route==='/usage/start').length,1);await a();assert.equal(calls.filter(x=>x.route==='/usage/stop').length,0);await b();assert.equal(calls.filter(x=>x.route==='/usage/stop').length,1);assert.equal(stopped,0);
});
test('expired work lease stops running jobs and refuses further work',async()=>{
 const timers=[];let stopped=0;const m=new PlatformMeter({client:{call:async()=>({sessionId:'work',leaseUntilMs:15000})},now:()=>0,setTimer:(fn,ms)=>{const t={fn,ms,unref(){}};timers.push(t);return t;},clearTimer:()=>{},stopWork:()=>stopped++});await m.begin('run_command',{});timers.find(t=>t.ms===15000).fn();assert.equal(stopped,1);await assert.rejects(m.begin('run_command',{}),/could not be renewed/);
});
