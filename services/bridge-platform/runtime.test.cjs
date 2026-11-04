'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),cp=require('node:child_process');
const {EventEmitter}=require('node:events');
const {DEFAULT_PORT,MESSAGES,listenPort,listenLoopback,runProductionService}=require('./runtime.cjs');
const deferred=()=>{let resolve;const promise=new Promise(ok=>{resolve=ok;});return{promise,resolve};};
const close=server=>new Promise(resolve=>server.close(()=>resolve()));
async function availablePort(){
 const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));
 const port=reserve.address().port;await close(reserve);return port;
}
function harness(){
 const signals=new EventEmitter(),logs=[],codes=[],forced=[];
 return{signals,logs,codes,forced,options:{signals,logger:{log:message=>logs.push(message),error:message=>logs.push(message)},setExitCode:code=>codes.push(code),forceExit:code=>forced.push(code)}};
}
test('production loopback port rejects coercion and invalid range before any bind',()=>{
 assert.equal(listenPort(),DEFAULT_PORT);assert.equal(listenPort(65535),65535);
 for(const value of [null,false,0,-1,65536,17783.5,'17783',NaN,Infinity]){
  let bound=false;assert.throws(()=>listenLoopback({listen(){bound=true;}},value),/Invalid Bridge platform listen port/);assert.equal(bound,false);
 }
});
test('listener binds the selected port only on IPv4 loopback',async()=>{
 const server=http.createServer((req,res)=>res.end('loopback')),port=await availablePort();
 try{
  const address=await listenLoopback(server,port);assert.equal(address.address,'127.0.0.1');assert.equal(address.family,'IPv4');assert.equal(address.port,port);
  const body=await new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,agent:false},res=>{let data='';res.on('data',chunk=>{data+=chunk;});res.on('end',()=>resolve(data));}).on('error',reject));
  assert.equal(body,'loopback');
 }finally{await close(server);}
});
test('missing protected configuration exits the real production entrypoint without disclosing its path',()=>{
 const env={};for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key])env[key]=process.env[key];
 env.BRIDGE_CONFIG_FILE=path.join(__dirname,'PRIVATE_FIXTURE_PATH_NOT_FOR_LOGS','missing.json');
 const result=cp.spawnSync(process.execPath,[path.join(__dirname,'server.cjs')],{env,encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr.trim(),MESSAGES.startupFailure);assert.doesNotMatch(result.stderr,/PRIVATE_FIXTURE|ENOENT|Error:| at /);
});
test('factory failures redact arbitrary private exception text and remove owned signal handlers',async()=>{
 const h=harness(),result=await runProductionService({...h.options,createService:async()=>{throw Error('PRIVATE_TEST_CREDENTIAL_MUST_NOT_APPEAR');}});
 assert.equal(result.started,false);assert.deepEqual(await result.stopped,{code:1});assert.deepEqual(h.codes,[1]);assert.deepEqual(h.logs,[MESSAGES.startupFailure]);assert.equal(h.signals.listenerCount('SIGTERM'),0);assert.equal(h.signals.listenerCount('SIGINT'),0);
});
test('occupied loopback port fails startup without leaving a new listener or printing addresses',async()=>{
 const occupied=http.createServer();await new Promise(resolve=>occupied.listen(0,'127.0.0.1',resolve));
 const server=http.createServer(),h=harness();
 try{
  const result=await runProductionService({...h.options,createService:async()=>({server,listen:()=>listenLoopback(server,occupied.address().port)})});
  assert.equal(result.started,false);assert.equal(server.listening,false);assert.deepEqual(await result.stopped,{code:1});assert.deepEqual(h.logs,[MESSAGES.startupFailure]);assert.deepEqual(h.codes,[1]);assert.deepEqual(h.forced,[]);
 }finally{await close(occupied);await close(server);}
});
test('SIGTERM stops admission and lets an in-flight response drain before a clean exit',async()=>{
 const entered=deferred(),responseReady=deferred(),server=http.createServer((req,res)=>{responseReady.resolve(res);entered.resolve();}),h=harness(),port=await availablePort();
 const result=await runProductionService({...h.options,createService:async()=>({server,listen:()=>listenLoopback(server,port)})});
 assert.equal(result.started,true);
 const response=new Promise((resolve,reject)=>http.get({host:'127.0.0.1',port,agent:false},res=>{let data='';res.on('data',chunk=>{data+=chunk;});res.on('end',()=>resolve(data));}).on('error',reject));
 await entered.promise;h.signals.emit('SIGTERM');assert.equal(server.listening,false);assert.deepEqual(h.codes,[]);
 (await responseReady.promise).end('finished');assert.equal(await response,'finished');assert.deepEqual(await result.stopped,{code:0});
 assert.deepEqual(h.codes,[0]);assert.deepEqual(h.forced,[]);assert.deepEqual(h.logs,[MESSAGES.listening,MESSAGES.stopped]);assert.equal(h.signals.listenerCount('SIGTERM'),0);
});
test('a hung connection reaches the bounded stop deadline without logging request or exception details',async()=>{
 const entered=deferred(),server=http.createServer(()=>entered.resolve()),h=harness(),port=await availablePort();
 const result=await runProductionService({...h.options,shutdownTimeoutMs:30,createService:async()=>({server,listen:()=>listenLoopback(server,port)})});
 const response=new Promise(resolve=>http.get({host:'127.0.0.1',port,path:'/PRIVATE_FIXTURE_REQUEST',agent:false},res=>{res.resume();res.on('end',()=>resolve('ended'));}).on('error',()=>resolve('closed')));
 await entered.promise;h.signals.emit('SIGTERM');assert.deepEqual(await result.stopped,{code:1});assert.equal(await response,'closed');
 assert.deepEqual(h.codes,[1]);assert.deepEqual(h.forced,[1]);assert.deepEqual(h.logs,[MESSAGES.listening,MESSAGES.timeout]);assert.equal(server.listening,false);assert.equal(h.signals.listenerCount('SIGTERM'),0);
 await close(server);
});
test('termination requested during construction never opens a listener afterward',async()=>{
 const constructing=deferred(),h=harness(),server=http.createServer();let listenCalled=false;
 const pending=runProductionService({...h.options,createService:()=>constructing.promise});
 h.signals.emit('SIGTERM');constructing.resolve({server,listen:async()=>{listenCalled=true;}});
 const result=await pending;assert.equal(result.started,false);assert.equal(listenCalled,false);assert.deepEqual(await result.stopped,{code:0});assert.deepEqual(h.codes,[0]);assert.deepEqual(h.logs,[MESSAGES.stopped]);
});

test('SIGTERM bounds hung construction and a late service never calls listen or changes the failed result',async()=>{
 const constructing=deferred(),forced=deferred(),h=harness(),server=http.createServer();let listenCalled=false;
 const pending=runProductionService({...h.options,shutdownTimeoutMs:30,forceExit:code=>{h.forced.push(code);forced.resolve();},createService:()=>constructing.promise});
 h.signals.emit('SIGTERM');await forced.promise;
 assert.deepEqual(h.codes,[1]);assert.deepEqual(h.forced,[1]);assert.deepEqual(h.logs,[MESSAGES.timeout]);assert.equal(h.signals.listenerCount('SIGTERM'),0);
 constructing.resolve({server,listen:async()=>{listenCalled=true;}});
 const result=await pending;assert.equal(result.started,false);assert.equal(listenCalled,false);assert.equal(server.listening,false);assert.deepEqual(await result.stopped,{code:1});
 assert.deepEqual(h.codes,[1]);assert.deepEqual(h.logs,[MESSAGES.timeout]);await close(server);
});
test('SIGTERM bounds hung listen, closes its admission socket and ignores a late successful completion',async()=>{
 const listening=deferred(),finishListen=deferred(),forced=deferred(),h=harness(),server=http.createServer(),port=await availablePort();
 const pending=runProductionService({...h.options,shutdownTimeoutMs:30,forceExit:code=>{h.forced.push(code);forced.resolve();},createService:async()=>({server,listen:async()=>{await listenLoopback(server,port);listening.resolve();await finishListen.promise;}})});
 await listening.promise;assert.equal(server.listening,true);h.signals.emit('SIGTERM');assert.equal(server.listening,false);await forced.promise;
 assert.deepEqual(h.codes,[1]);assert.deepEqual(h.forced,[1]);assert.deepEqual(h.logs,[MESSAGES.timeout]);
 finishListen.resolve();const result=await pending;assert.equal(result.started,false);assert.equal(server.listening,false);assert.deepEqual(await result.stopped,{code:1});
 assert.deepEqual(h.codes,[1]);assert.deepEqual(h.logs,[MESSAGES.timeout]);await close(server);
});
