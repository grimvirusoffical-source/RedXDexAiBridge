'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(a=>{resolve=a;});return{promise,resolve};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture({accepted=false,meter}={}){
 const calls=[],auth={authEpoch:1,session:{sub:'member'},isSignedIn(){return!!this.session;},status(){return{signedIn:!!this.session};}};
 const context={CI_SMOKE:false,accountAuth:auth,platformConfig:{required:true},platformConnectionPending:false,platformConnectionEpoch:0,gatewayStarting:null,gateway:null,workMeter:meter,clients:{},oauth:{},UI:'file:///app/index.html',LOGIN_UI:'file:///app/sign-in.html',__dirname:'/app',path,process:{pid:7},app:{getVersion:()=> '0.11.0'},accountPlatform:{state:null,async status(){const me={sub:'member',accepted};this.state=me;return me;}},win:{webContents:{getURL:()=> 'file:///app/sign-in.html'},loadFile:async file=>calls.push(['page',path.basename(file)])},tunnel:{config:()=>({mode:'temporary'}),start:async url=>calls.push(['remote',url]),stop:()=>calls.push(['remote-stop'])},approvals:{cancelAll:()=>calls.push(['approvals-stop'])},core:{root:'/fixture',processes:{stopAll:()=>calls.push(['process-stop'])},crawlJobs:{stopAll:()=>calls.push(['crawl-stop'])},desktopLease:{reset:()=>calls.push(['lease-stop'])}},fs:{unlinkSync:()=>{}},atomicJSON:()=>calls.push(['runtime']),audit:()=>{},remoteAutoConnect:()=>true,emit:(...args)=>calls.push(['emit',...args]),startServer:async()=>{calls.push(['listen']);return{url:'http://127.0.0.1:7777',server:{closeAllConnections:()=>calls.push(['connections-stop'])},stop:async()=>calls.push(['server-stop'])};}};
 const begin=source.indexOf(' async function startGateway(){'),end=source.indexOf(' function stopEverything(){');assert.ok(begin>0&&end>begin);vm.runInNewContext(source.slice(begin,end),context);return{context,calls,auth};
}
test('pending agreements with saved remote autoconnect load the app without starting a gateway',async()=>{
 const {context,calls}=fixture();await context.openAfterLogin();assert.equal(context.gateway,null);assert.equal(context.platformConnectionPending,true);assert.equal(calls.some(x=>x[0]==='listen'||x[0]==='remote'),false);assert.equal(calls.some(x=>x[0]==='page'&&x[1]==='index.html'),true);
 context.accountPlatform.status=async function(){return this.state={sub:'member',accepted:true};};await context.refreshPlatformAccount();assert.equal(calls.filter(x=>x[0]==='listen').length,1);assert.equal(calls.filter(x=>x[0]==='remote').length,1);await context.refreshPlatformAccount();assert.equal(calls.filter(x=>x[0]==='remote').length,1);
});
test('failed fresh agreement check does not connect using a cached accepted snapshot',async()=>{
 const {context,calls}=fixture();context.accountPlatform.state={sub:'member',accepted:true};context.accountPlatform.status=async()=>{throw Error('verification unavailable');};await context.openAfterLogin();assert.equal(context.gateway,null);assert.equal(calls.some(x=>x[0]==='remote'),false);assert.equal(context.platformConnectionPending,true);
});
test('explicit gateway stop prevents a delayed verified profile from reconnecting it',async()=>{
 const {context,calls}=fixture(),response=deferred();context.platformConnectionPending=true;context.accountPlatform.status=async function(){return this.state=await response.promise;};const refresh=context.refreshPlatformAccount();await flush();await context.shutDownGateway();response.resolve({sub:'member',accepted:true});await refresh;assert.equal(context.gateway,null);assert.equal(context.platformConnectionPending,false);assert.equal(calls.some(x=>x[0]==='listen'||x[0]==='remote'),false);
});
test('logout during account verification cannot emit or reconnect the former account',async()=>{
 const {context,calls,auth}=fixture(),response=deferred();context.accountPlatform.status=()=>response.promise;context.platformConnectionPending=true;const refresh=context.refreshPlatformAccount();auth.authEpoch++;auth.session=null;response.resolve({sub:'member',accepted:true});await assert.rejects(refresh,/verification was cancelled/);assert.equal(calls.some(x=>x[0]==='emit'||x[0]==='remote'),false);
});
test('logout while opening the app cannot replace the sign-in page with a stale login completion',async()=>{
 const {context,calls,auth}=fixture(),response=deferred();context.accountPlatform.status=()=>response.promise;const opening=context.openAfterLogin();auth.authEpoch++;auth.session=null;response.resolve({sub:'member',accepted:true});await assert.rejects(opening,/no longer verified/);assert.equal(calls.some(x=>x[0]==='page'||x[0]==='listen'||x[0]==='remote'),false);
});
test('quota recovery refusal keeps work blocked while a verified account remains visible',async()=>{
 const failure=Error('old exhausted quota');let recover=0;const meter={failed:failure,recover:async()=>{recover++;throw Error('Current weekly allowance is exhausted');}};
 const {context}=fixture({accepted:true,meter});const me=await context.refreshPlatformAccount();assert.equal(recover,1);assert.equal(meter.failed,failure);assert.equal(me.accepted,true);assert.equal(me.clientUsageStatus.blocked,true);assert.equal(me.clientUsageStatus.message,'Current weekly allowance is exhausted');
});
test('healthy account refresh does not stop or recover an active healthy meter',async()=>{
 let touched=0;const {context}=fixture({accepted:true,meter:{failed:null,recover:()=>{touched++;},stop:()=>{touched++;}}});await context.refreshPlatformAccount();assert.equal(touched,0);
});
test('concurrent gateway starts bind once and cancellation stops a late listener',async()=>{
 const {context,calls}=fixture({accepted:true}),listener=deferred();context.accountPlatform.state={sub:'member',accepted:true};context.startServer=()=>{calls.push(['listen']);return listener.promise;};const first=context.startGateway(),second=context.startGateway();await flush();assert.equal(calls.filter(x=>x[0]==='listen').length,1);await context.shutDownGateway();let stopped=0;listener.resolve({url:'http://127.0.0.1:7777',stop:async()=>{stopped++;}});await assert.rejects(first,/cancelled/);await assert.rejects(second,/cancelled/);assert.equal(stopped,1);assert.equal(context.gateway,null);assert.equal(calls.some(x=>x[0]==='runtime'),false);
});
test('gateway stop halts local work before awaiting remote usage settlement',async()=>{
 const settle=deferred(),{context,calls}=fixture({meter:{stop:()=>{calls.push(['usage-stop']);return settle.promise;}}});let finished=false;const task=context.shutDownGateway().then(()=>{finished=true;});await flush();assert.equal(finished,false);for(const action of ['remote-stop','process-stop','crawl-stop','lease-stop'])assert.equal(calls.some(x=>x[0]===action),true);settle.resolve();await task;
});
test('before quit settles usage with a 1500ms deadline after immediately stopping local work',async()=>{
 const handlers={},calls=[],timers=new Map();let id=0;const hang=deferred();const context={app:{on:(name,fn)=>{handlers[name]=fn;},quit:()=>calls.push('quit')},quitting:false,platformConnectionPending:true,platformConnectionEpoch:1,meterQuitPending:false,meterQuitSettled:false,approvals:{cancelAll:()=>calls.push('approvals')},core:{root:'/fixture',processes:{stopAll:()=>calls.push('process')},crawlJobs:{stopAll:()=>calls.push('crawl')}},tunnel:{stop:()=>calls.push('tunnel')},gateway:null,fs:{unlinkSync:()=>{}},path,workMeter:{stop:()=>{calls.push('settlement');return hang.promise;}},setTimeout:(fn,ms)=>{assert.equal(ms,1500);timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
 const line=source.split(/\r?\n/).find(x=>x.includes("app.on('before-quit',event=>"));assert.ok(line);vm.runInNewContext(line,context);let prevented=0;handlers['before-quit']({preventDefault:()=>prevented++});assert.equal(prevented,1);for(const action of ['process','crawl','tunnel'])assert.ok(calls.includes(action));assert.equal(calls.includes('quit'),false);assert.equal(context.platformConnectionPending,false);timers.values().next().value();await flush();assert.equal(calls.filter(x=>x==='quit').length,1);assert.equal(context.meterQuitSettled,true);handlers['before-quit']({preventDefault:()=>prevented++});assert.equal(prevented,1);
});
