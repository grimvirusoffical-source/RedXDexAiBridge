'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),vm=require('node:vm'),{createRequire}=require('node:module'),{EventEmitter}=require('node:events'),{Readable}=require('node:stream');
const sourceFile=path.join(__dirname,'secret-intake.cjs'),source=fs.readFileSync(sourceFile,'utf8'),ACCOUNT='acct_1USFfGEKYCPRlM5G';
const API='rk_test_'+'A'.repeat(32),WEBHOOK='whsec_'+'B'.repeat(32);
// macOS exposes its temporary directory through /var -> /private/var. Use the
// canonical fixture location; the production destination guard stays strict.
const TEMPORARY_ROOT=fs.realpathSync(os.tmpdir());
const RESTRICTED=os.platform()==='win32'&&/(?:^|\/)Packages\/[^/]+\/AC\/Temp(?:\/|$)/i.test(os.tmpdir().replace(/\\/g,'/'));
let virtualPort=19000;
function virtualHTTP(){
 let current;
 return{createServer(_options,handler){
  const server=new EventEmitter();let listening=false,port,host;
  server.listen=(wanted,address,ready)=>{port=wanted||++virtualPort;host=address;listening=true;queueMicrotask(ready);return server;};server.address=()=>({address:host,port});server.close=ready=>{listening=false;if(ready)setImmediate(ready);return server;};server.closeIdleConnections=()=>{};
  server.send=options=>new Promise((resolve,reject)=>{
   if(!listening)return reject(Error('Intake closed'));
   const req=options.partial?new Readable({read(){}}):Readable.from(options.body?[Buffer.from(options.body)]:[]);if(options.partial&&options.body)req.push(Buffer.from(options.body));req.method=options.method;req.url=options.route;req.complete=false;req.once('end',()=>{req.complete=true;});
   req.headers={host:host+':'+port,...options.headers};req.rawHeaders=Object.entries(req.headers).flatMap(([key,value])=>[key,String(value)]);
   const res=new EventEmitter();res.destroyed=false;res.writableEnded=false;let status,headers;
   if(options.signal)options.signal.addEventListener('abort',()=>{res.destroyed=true;req.destroy();res.emit('close');reject(Error('Fixture request cancelled'));},{once:true});
   res.writeHead=(code,values)=>{status=code;headers=values;};res.end=body=>{res.writableEnded=true;queueMicrotask(()=>{res.emit('finish');resolve({status,headers:Object.fromEntries(Object.entries(headers).map(([key,value])=>[key,key==='set-cookie'?[value]:value])),body});});};
   Promise.resolve(handler(req,res)).catch(reject);
  });current=server;return server;
 },send:options=>current.send(options)};
}
// Normal hosts exercise real loopback HTTP. This AppContainer cannot connect
// to native loopback, so only its unit fixtures use virtual HTTP/runtime data.
// The real module retains its unconditional guard; every writer is injected.
function load({platform='win32',temporaryDirectory='C:/Users/Fixture/AppData/Local/Temp',logs=[]}={}){
 const exported={exports:{}},nativeRequire=createRequire(sourceFile),transport=RESTRICTED?virtualHTTP():null;
 const requireMock=name=>name==='node:os'?{platform:()=>platform,tmpdir:()=>temporaryDirectory}:name==='node:http'&&transport?transport:nativeRequire(name);requireMock.main={};
 vm.runInNewContext(source,{module:exported,exports:exported.exports,require:requireMock,Buffer,TextDecoder,URLSearchParams,setTimeout,clearTimeout,console:{log:value=>logs.push(String(value)),error:value=>logs.push(String(value))}},{filename:sourceFile});
 return{...exported.exports,transport};
}
function directory(){return fs.mkdtempSync(path.join(TEMPORARY_ROOT,'redx-intake-test-'));}
function remove(directory){assert.ok(path.isAbsolute(directory)&&directory.startsWith(path.join(TEMPORARY_ROOT,'redx-intake-test-')));fs.rmSync(directory,{recursive:true,force:true});}
async function fixture({kind='sandbox-api',writer,settings={},runtime={},logs=[]}={}){
 const root=directory(),file=path.join(root,'protected','sandbox.secret'),calls=[],module=load({...runtime,logs});
 try{const intake=await module.startSecretIntake({file,kind,writer:writer||((...args)=>{calls.push(args);return{saved:true};}),...settings});return{root,file,kind,calls,intake,transport:module.transport,cleanup:async()=>{await intake.close();remove(root);}};}catch(error){remove(root);throw error;}
}
function request(f,{method='GET',route='/',headers={},body,chunked=false,partial=false,signal}={}){
 if(f.transport){const all={...headers};if(body!==undefined&&!chunked&&all['content-length']===undefined)all['content-length']=String(Buffer.byteLength(body));return f.transport.send({method,route,headers:all,body,partial,signal});}
 return new Promise((resolve,reject)=>{
  const address=new URL(f.intake.url),data=body===undefined?null:Buffer.from(body);
  const all={...headers};if(data&&!chunked&&all['content-length']===undefined)all['content-length']=data.length;
  const req=http.request({hostname:address.hostname,port:address.port,path:route,method,headers:all,agent:false,signal},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);});req.on('error',reject);if(partial)req.write(data);else req.end(data);
 });
}
async function bootstrap(f){const result=await request(f);assert.equal(result.status,200);const csrf=result.body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)?.[1],cookie=result.headers['set-cookie']?.[0].split(';')[0];assert.ok(csrf&&cookie);return{...result,csrf,cookie};}
function postOptions(f,form,overrides={}){
 const fields={csrf:form.csrf,account:ACCOUNT,kind:f.kind,secret:f.kind==='sandbox-api'?API:WEBHOOK,...overrides.fields};
 return{method:'POST',route:'/save',body:new URLSearchParams(fields).toString(),headers:{origin:new URL(f.intake.url).origin,cookie:form.cookie,'content-type':'application/x-www-form-urlencoded',...overrides.headers},...overrides.options};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
test('normal user/server runtime serves a loopback password form with strict browser boundaries',async()=>{
 const f=await fixture();try{
  const result=await bootstrap(f);assert.equal(new URL(f.intake.url).hostname,'127.0.0.1');assert.equal(new URL(f.intake.url).search,'');
  assert.match(result.body,/name="secret" type="password"/);assert.match(result.body,/<form method="post" action="\/save"/);assert.equal(result.body.includes('<script'),false);
  assert.match(result.headers['set-cookie'][0],/HttpOnly; SameSite=Strict/);assert.match(result.headers['content-security-policy'],/script-src 'none'/);assert.match(result.headers['content-security-policy'],/connect-src 'none'/);assert.match(result.headers['content-security-policy'],/form-action 'self'/);
  // no-referrer nulls native form POST Origin; null still remains refused.
  assert.equal(result.headers['referrer-policy'],'same-origin');assert.equal(result.headers['cache-control'],'no-store');assert.equal(result.headers['access-control-allow-origin'],undefined);assert.equal(result.body.includes(f.file),false);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('known Windows package/AppContainer execution is rejected before accepting any value',async()=>{
 for(const temporaryDirectory of ['C:/Users/Fixture/AppData/Local/Packages/sandbox.fixture/AC/Temp','C:\\Users\\Fixture\\AppData\\Local\\Packages\\sandbox.{fixture}\\AC\\Temp','C:/Users/Fixture/AppData/Local/Packages/AnotherPackage/AC/Temp']){
  const root=directory();let calls=0;try{await assert.rejects(load({temporaryDirectory}).startSecretIntake({file:path.join(root,'secret'),kind:'sandbox-api',writer:()=>{calls++;return{saved:true};}}),/Unsupported protected credential intake environment/);assert.equal(calls,0);assert.equal(fs.existsSync(path.join(root,'secret')),false);}finally{remove(root);}
 }
 const f=await fixture({runtime:{platform:'linux',temporaryDirectory:'/tmp'}});await f.cleanup();
});
test('the real module rejects this known AppContainer without accepting credentials',{skip:!RESTRICTED},async()=>{
 const root=directory();let calls=0;try{await assert.rejects(require('./secret-intake.cjs').startSecretIntake({file:path.join(root,'secret'),kind:'sandbox-api',writer:()=>{calls++;return{saved:true};}}),/Unsupported protected credential intake environment/);assert.equal(calls,0);}finally{remove(root);}
});
test('API and webhook values go only to the fixed protected writer and never return in responses',async()=>{
 for(const kind of ['sandbox-api','sandbox-webhook']){
  const logs=[],f=await fixture({kind,logs});try{
   const form=await bootstrap(f),result=await request(f,postOptions(f,form)),secret=kind==='sandbox-api'?API:WEBHOOK;assert.equal(result.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],f.file);assert.equal(f.calls[0][1],secret);assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0][2])),{kind,expectedAccount:ACCOUNT});
   const done=await f.intake.done;assert.deepEqual(JSON.parse(JSON.stringify(done)),{status:'saved',kind,account:ACCOUNT});assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(done).includes(secret),false);assert.equal(logs.length,0);await assert.rejects(request(f));
  }finally{await f.cleanup();}
 }
});
test('wrong Host, Origin, cookie, CSRF, fetch site, account or kind cannot reach the writer',async()=>{
 const f=await fixture();try{
  const form=await bootstrap(f),variants=[{headers:{host:'localhost:'+new URL(f.intake.url).port}},{headers:{origin:'https://untrusted.example'}},{headers:{origin:'null'}},{headers:{origin:undefined}},{headers:{cookie:undefined}},{headers:{cookie:'redx_sandbox_intake='+'x'.repeat(43)}},{headers:{cookie:form.cookie+'; '+form.cookie}},{headers:{'sec-fetch-site':'cross-site'}},{fields:{csrf:'x'.repeat(43)}},{fields:{account:'acct_other'}},{fields:{kind:'sandbox-webhook'}}];
  for(const variant of variants){const options=postOptions(f,form,variant);for(const [name,value]of Object.entries(options.headers))if(value===undefined)delete options.headers[name];assert.equal((await request(f,options)).status,403);}
  assert.equal((await request(f,{headers:{host:'untrusted.example'}})).status,403);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('wrong content types, prefixes, duplicate/extra fields, malformed encoding and query values are refused',async()=>{
 const f=await fixture();try{
  const form=await bootstrap(f);
  for(const type of ['application/json','text/plain','application/x-www-form-urlencoded; charset=utf-16'])assert.equal((await request(f,postOptions(f,form,{headers:{'content-type':type}}))).status,415);
  for(const secret of ['rk_live_'+'A'.repeat(32),'sk_test_'+'A'.repeat(32),WEBHOOK,'rk_test_bad',API+'\n'])assert.equal((await request(f,postOptions(f,form,{fields:{secret}}))).status,400);
  for(const suffix of ['&secret='+API,'&file=other','&destination=other']){const options=postOptions(f,form);options.body+=suffix;assert.equal((await request(f,options)).status,400);}
  for(const body of ['secret=%ZZ',Buffer.from([255])]){const options=postOptions(f,form);options.body=body;assert.equal((await request(f,options)).status,400);}
  const query=postOptions(f,form,{options:{route:'/save?secret=fixture_value'}});const result=await request(f,query);assert.equal(result.status,405);assert.equal(result.body.includes('fixture_value'),false);assert.equal(f.calls.length,0);
 }finally{await f.cleanup();}
});
test('declared and streamed oversized bodies are bounded before the writer',async()=>{
 const f=await fixture();try{const form=await bootstrap(f);for(const chunked of [false,true]){const options=postOptions(f,form,{fields:{secret:'x'.repeat(4096)},options:{chunked}});assert.equal((await request(f,options)).status,413);}assert.equal(f.calls.length,0);}finally{await f.cleanup();}
});
test('an unfinished body times out without invoking the writer',async()=>{
 const f=await fixture({settings:{bodyTimeoutMs:20}});try{
  const form=await bootstrap(f),options=postOptions(f,form,{options:{body:'secret=',partial:true,chunked:true}});let timer;
  try{await Promise.race([request(f,options).catch(()=>null),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fixture body timeout did not terminate')),1000);})]);}finally{clearTimeout(timer);}
  assert.equal(f.calls.length,0);const result=await request(f,postOptions(f,form));assert.equal(result.status,200);assert.equal((await f.intake.done).status,'saved');
 }finally{await f.cleanup();}
});
test('one-use tokens and concurrent submissions permit exactly one successful save',async()=>{
 const started=deferred(),release=deferred(),calls=[];const f=await fixture({writer:async(...args)=>{calls.push(args);started.resolve();await release.promise;return{saved:true};}});try{
  const form=await bootstrap(f),first=request(f,postOptions(f,form));await started.promise;
  assert.equal((await request(f,postOptions(f,form))).status,409);assert.equal((await request(f)).status,409);assert.equal(calls.length,1);release.resolve();assert.equal((await first).status,200);assert.equal((await f.intake.done).status,'saved');await assert.rejects(request(f,postOptions(f,form)));assert.equal(calls.length,1);
 }finally{release.resolve();await f.cleanup();}
});
test('a confirmed save still closes the intake if the submitting browser disconnects',async()=>{
 const started=deferred(),release=deferred();let calls=0;const f=await fixture({writer:async()=>{calls++;started.resolve();await release.promise;return{saved:true};}});try{
  const form=await bootstrap(f),controller=new AbortController(),pending=request(f,postOptions(f,form,{options:{signal:controller.signal}})),rejected=assert.rejects(pending);await started.promise;controller.abort();await rejected;release.resolve();assert.equal((await f.intake.done).status,'saved');assert.equal(calls,1);await assert.rejects(request(f));
 }finally{release.resolve();await f.cleanup();}
});
test('existing destinations and repository paths are rejected without overwriting',async()=>{
 const root=directory();let calls=0;try{
  const module=load(),file=path.join(root,'existing');fs.writeFileSync(file,'fixture sentinel');await assert.rejects(module.startSecretIntake({file,kind:'sandbox-api',writer:()=>{calls++;return{saved:true};}}),/Invalid protected Sandbox destination/);assert.equal(fs.readFileSync(file,'utf8'),'fixture sentinel');
  const repository=path.join(root,'repo');fs.mkdirSync(repository);fs.writeFileSync(path.join(repository,'.git'),'fixture worktree pointer');await assert.rejects(module.startSecretIntake({file:path.join(repository,'secret'),kind:'sandbox-api',writer:()=>{calls++;return{saved:true};}}),/Invalid protected Sandbox destination/);
  await assert.rejects(module.startSecretIntake({file:path.join(root,'new'),kind:'sandbox-api',expectedAccount:'acct_other',writer:()=>{calls++;return{saved:true};}}),/Invalid Sandbox intake configuration/);assert.equal(calls,0);
 }finally{remove(root);}
 const f=await fixture();try{const form=await bootstrap(f);fs.mkdirSync(path.dirname(f.file));fs.writeFileSync(f.file,'fixture concurrent sentinel');assert.equal((await request(f,postOptions(f,form))).status,400);assert.equal(f.calls.length,0);assert.equal(fs.readFileSync(f.file,'utf8'),'fixture concurrent sentinel');}finally{await f.cleanup();}
});
test('writer failures and timeouts expose sanitized failure only, consume the intake and close it',async()=>{
 for(const mode of ['throw','timeout','unconfirmed']){
  const late=deferred(),logs=[];let calls=0;const f=await fixture({logs,settings:{writerTimeoutMs:20},writer:()=>{calls++;if(mode==='throw')throw Error(API);if(mode==='timeout')return late.promise;return undefined;}});
  try{const form=await bootstrap(f),result=await request(f,postOptions(f,form));assert.equal(result.status,500);assert.equal(JSON.stringify(result).includes(API),false);assert.equal((await f.intake.done).status,'failed');late.resolve({saved:true});assert.equal(calls,1);assert.equal(logs.length,0);await assert.rejects(request(f));}finally{late.resolve({saved:true});await f.cleanup();}
 }
});
test('expiry and explicit close terminate unused intake without writing',async()=>{
 const expired=await fixture({settings:{intakeTimeoutMs:20}});try{assert.equal((await expired.intake.done).status,'expired');assert.equal(expired.calls.length,0);await assert.rejects(request(expired));}finally{await expired.cleanup();}
 const closed=await fixture();try{assert.equal((await closed.intake.close()).status,'closed');assert.equal(closed.calls.length,0);await assert.rejects(request(closed));}finally{await closed.cleanup();}
});
