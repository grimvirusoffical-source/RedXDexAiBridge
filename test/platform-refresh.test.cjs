'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {usageSummary,createAccountRefreshController}=require('../app/platform-ui.js');
const source=fs.readFileSync(path.join(__dirname,'../app/platform-ui.js'),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function clock(){let time=0,id=0;const timers=new Map();return{now:()=>time,setTimer:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;},clearTimer:id=>timers.delete(id),get size(){return timers.size;},async advance(ms){const end=time+ms;let loops=0;for(;;){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;assert.ok(++loops<200,'timer loop is bounded');time=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}time=end;await flush();}};}
function accountFixture(overrides={}){
 const S={me:{sub:'member',role:'user',tier:'free'},catalog:{tiers:[],plugins:[],legal:{version:'v1'}},catalogCheckedAt:Date.now(),page:'platform-subscriptions',checkoutPending:true};
 const calls=[],context={S,accountUnavailable:false,platformAPI:{platformStatus:async()=>({sub:'member',role:'user',tier:'free',legalVersion:'v1',accepted:true})},request:async route=>{calls.push(route);return{tiers:[],plugins:[],legal:{version:'v1'}};},applyIdentity:me=>{S.me=me;},renderPlans:()=>calls.push('plans'),renderCurrency:()=>{},renderPlugins:()=>{},renderAccount:()=>{},message:()=>{},document:{querySelector:()=>null},legalDialog:async()=>{},loadUsers:async()=>{},invalidatePlatform:reason=>{S.me=null;calls.push(reason);},...overrides};
 vm.runInNewContext(source.slice(source.indexOf('async function fetchAccount('),source.indexOf('async function refresh(){')),context);return{S,calls,context,fetch:options=>context.fetchAccount(options)};
}
test('usage display uses server limits and never invents allowance when fields are absent',()=>{
 const reported=usageSummary({usage:{activeMs:90000,terminalMs:70000,crawlerPages:8},limits:{weeklyMinutes:2,weeklyTerminalMinutes:1,weeklyCrawlerPages:null}});
 assert.deepEqual(reported.active,{used:90000,limit:120000,unlimited:false,remaining:30000});assert.equal(reported.terminal.remaining,0);assert.equal(reported.crawler.unlimited,true);
 for(const usage of Object.values(usageSummary({})))assert.deepEqual(usage,{used:null,limit:null,unlimited:false,remaining:null});
 assert.equal(usageSummary({usage:{activeMs:-1},limits:{weeklyMinutes:Number.MAX_SAFE_INTEGER}}).active.limit,null);
});
test('checkout return refresh coalesces and grants nothing until the authoritative profile changes',async()=>{
 const c=clock(),first=deferred(),pending=[];let calls=0,tier='free';
 const fixture=accountFixture({platformAPI:{platformStatus:async()=>{calls++;if(calls===1)return first.promise;return{sub:'member',role:'user',tier,legalVersion:'v1',accepted:true};}}});
 const controller=createAccountRefreshController({...c,onPending:x=>pending.push(x),refresh:current=>fixture.fetch({isCurrent:current})});
 const checkout=controller.beginCheckout(),focus=controller.request({reason:'focus'});assert.equal(checkout,focus);await flush();assert.equal(calls,1);assert.equal(fixture.S.me.tier,'free');
 first.resolve({sub:'member',role:'user',tier:'free',legalVersion:'v1',accepted:true});await checkout;assert.equal(fixture.S.me.tier,'free');assert.equal(controller.pending,true);
 tier='gold';await c.advance(2000);assert.equal(fixture.S.me.tier,'gold');assert.equal(calls,2);assert.deepEqual(fixture.calls.filter(x=>x==='/catalog'),[],'usage refresh does not reload and hydrate the catalog');
 assert.equal(pending[0].pending,true);controller.dispose();assert.equal(c.size,0);
});
test('checkout polling has a deadline even if a server response never settles',async()=>{
 const c=clock(),pending=[],hang=deferred();let calls=0;
 const controller=createAccountRefreshController({...c,checkoutMs:15000,onPending:x=>pending.push(x),refresh:async()=>{calls++;return hang.promise;}});
 controller.beginCheckout();await flush();await c.advance(15000);assert.equal(calls,1);assert.equal(controller.pending,false);assert.equal(pending.at(-1).timedOut,true);assert.equal(c.size,0);controller.dispose();
});
test('hidden return does not request accounts; focus checks and live usage polling remain bounded',async()=>{
 const c=clock();let visible=false,calls=0;
 const controller=createAccountRefreshController({...c,visible:()=>visible,shouldPoll:()=>true,refresh:async()=>{calls++;}});
 await controller.request({reason:'focus'});assert.equal(calls,0);visible=true;await controller.request({reason:'focus'});assert.equal(calls,1);await c.advance(10000);assert.equal(calls,2);visible=false;await c.advance(10000);assert.equal(calls,2);assert.equal(c.size,0);controller.dispose();
});
test('logout cancellation ignores a late former-owner response and disposal stops all timers',async()=>{
 const c=clock(),response=deferred(),fixture=accountFixture({platformAPI:{platformStatus:()=>response.promise}});
 const controller=createAccountRefreshController({...c,refresh:current=>fixture.fetch({isCurrent:current})});
 const pending=controller.beginCheckout();await flush();controller.cancel();fixture.S.me=null;
 response.resolve({sub:'old-owner',role:'owner',tier:'ruby',legalVersion:'v1',accepted:true});await pending;assert.equal(fixture.S.me,null);assert.equal(controller.pending,false);assert.equal(c.size,0);controller.dispose();await controller.request({force:true});assert.equal(c.size,0);
});
test('account refresh cannot apply a response from before catalog loading was cancelled',async()=>{
 const catalog=deferred(),fixture=accountFixture({request:()=>catalog.promise});fixture.S.catalog=null;let current=true;
 const task=fixture.fetch({isCurrent:()=>current});await flush();current=false;fixture.S.me=null;catalog.resolve({tiers:[],plugins:[],legal:{version:'v1'}});assert.equal(await task,false);assert.equal(fixture.S.me,null);
});
test('failed authoritative refresh removes stale identity instead of preserving paid or owner access',async()=>{
 const fixture=accountFixture({platformAPI:{platformStatus:async()=>{throw Error('Account service unavailable');}}});fixture.S.me={sub:'owner',role:'owner',tier:'ruby'};assert.equal(await fixture.fetch(),false);assert.equal(fixture.S.me,null);assert.equal(fixture.calls.at(-1),'Account service unavailable');
});
