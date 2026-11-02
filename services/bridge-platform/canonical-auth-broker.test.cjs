'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createCanonicalAuthBroker,CanonicalAuthError}=require('./canonical-auth-broker.cjs');
const ORIGIN='https://red-xai.com',EPOCH=Date.UTC(2026,10,2),DEVICE='a'.repeat(64),NONCE='n'.repeat(32),SUB='canonical_account_fixture';
const COOKIE='fixture_mfa_session_token_not_real';
const cookie=(token=COOKIE,attributes='Path=/; Secure; HttpOnly; SameSite=Lax')=>'redx_session='+token+'; '+attributes;
const response=(json={},status=200,cookies=[])=>{const headers=new Headers({'content-type':'application/json'});for(const value of cookies)headers.append('set-cookie',value);return new Response(json===null?'':JSON.stringify(json),{status,headers});};
const code=expected=>error=>error instanceof CanonicalAuthError&&error.code===expected&&error.message===expected;
function fixture(options={}){
 const calls=[],consumed=[];let clock=EPOCH;
 const identity=()=>({account:{id:SUB,roles:['owner']},amr:['pwd','otp'],expiresMs:clock+3600000});
 const request=async(url,input)=>{calls.push({url,input});const operation=url.slice((ORIGIN+'/api/accounts/').length);
  if(options.request)return options.request(operation,input,{identity,response,cookie,calls});
  if(operation==='login')return response(options.login||{next:'2fa',token:'fixture_flow_token_not_real',methods:{totp:true,call:true}},200,options.loginCookies||[]);
  if(operation==='login/2fa')return response(options.mfaBody??null,options.mfaStatus||200,options.mfaCookies||[cookie()]);
  if(operation==='login/call')return response({phone:'fixture phone is not returned to caller'});
  if(operation==='me'){clock+=7;return response(options.me?options.me(identity()):identity(),options.meStatus||200);}
  throw Error('Unexpected fixture route');
 };
 const broker=createCanonicalAuthBroker({request,now:()=>clock,consumeNonce:async value=>{consumed.push(value);return options.consume?options.consume(value):true;},...options.limits});
 return{broker,calls,consumed,tick:ms=>{clock+=ms;},begin:extra=>broker.begin({sub:SUB,deviceKeyHash:DEVICE,nonce:NONCE,login:'  fixture_user  ',password:'fixture_password_not_real',...extra})};
}
test('fresh password and matching MFA create only a bound canonical receipt at completion time',async()=>{
 const f=fixture();try{
  const flow=await f.begin({cookie:'preexisting_cookie_must_never_be_forwarded',origin:'https://untrusted.example'});
  assert.deepEqual(Object.keys(flow),['flowId','methods']);assert.deepEqual(flow.methods,['totp','call']);
  const result=await f.broker.finish({flowId:flow.flowId,method:'totp',code:'123 456'});
  assert.equal(result.sub,SUB);assert.equal(result.deviceKeyHash,DEVICE);assert.equal(result.reauthAtMs,EPOCH+7);assert.equal(result.mfaUsed,true);assert.equal(result.freshLoginVerified,true);assert.deepEqual(result.canonicalRoles,['owner']);assert.equal(result.ownerVerified,undefined);
  assert.equal(f.consumed.length,1);assert.equal(f.consumed[0].sub,SUB);assert.equal(f.consumed[0].deviceKeyHash,DEVICE);assert.equal(f.consumed[0].nonce,NONCE);assert.equal(f.consumed[0].completedAtMs,result.reauthAtMs);
  const login=f.calls[0],mfa=f.calls[1],me=f.calls[2];assert.equal(login.input.headers.cookie,undefined);assert.equal(mfa.input.headers.cookie,undefined);assert.equal(me.input.headers.cookie,'redx_session='+COOKIE);assert.equal(mfa.input.headers['x-redx-flow'],'fixture_flow_token_not_real');
  assert.deepEqual(JSON.parse(login.input.body),{login:'fixture_user',password:'fixture_password_not_real'});
  for(const {url,input}of f.calls){assert.ok(url.startsWith(ORIGIN+'/api/accounts/'));assert.equal(input.redirect,'error');assert.equal(input.credentials,'omit');assert.equal(input.headers.origin,ORIGIN);}
  const encoded=JSON.stringify({flow,result});for(const secret of [COOKIE,'fixture_flow_token_not_real','fixture_password_not_real',NONCE])assert.equal(encoded.includes(secret),false);
  assert.deepEqual(f.calls.map(value=>value.url),['login','login/2fa','me'].map(route=>ORIGIN+'/api/accounts/'+route));
 }finally{f.broker.close();}
});
test('phone-call challenge is one-shot and must match authoritative call AMR',async()=>{
 const f=fixture({me:me=>({...me,amr:['pwd','call']})});try{const flow=await f.begin();assert.deepEqual(await f.broker.requestCall(flow.flowId),{sent:true});await assert.rejects(f.broker.requestCall(flow.flowId),code('invalid_factor'));assert.equal((await f.broker.finish({flowId:flow.flowId,method:'call',code:'123456'})).mfaUsed,true);assert.equal(f.calls.filter(v=>v.url.endsWith('/login/call')).length,1);}finally{f.broker.close();}
});
test('MFA account switch, negative verification/status and expired sessions produce no receipt or nonce consumption',async()=>{
 const variants=[me=>({...me,account:{...me.account,id:'different_account'}}),me=>({...me,account:{...me.account,emailVerified:false}}),me=>({...me,email_verified:false}),me=>({...me,emailVerified:'false'}),me=>({...me,account:{...me.account,status:'banned'}}),me=>({...me,account:{...me.account,status:'inactive'}}),me=>({...me,account:{...me.account,disabled:true}}),me=>({...me,account:{...me.account,banned:true}}),me=>({...me,active:false}),me=>({...me,expiresMs:EPOCH}),me=>({...me,amr:['otp']}),me=>({...me,amr:['pwd','call']}),me=>({...me,account:{sub:SUB,roles:['owner']}})];
 for(const alter of variants){const f=fixture({me:alter});try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),error=>error instanceof CanonicalAuthError&&['subject_mismatch','untrusted_account'].includes(error.code));assert.equal(f.consumed.length,0);}finally{f.broker.close();}}
});
test('setup or password-only completion cannot establish a fresh MFA transaction',async()=>{
 for(const login of [{next:'2fa_setup',token:'fixture_token_not_real',methods:{totp:true}},{next:'complete'},{next:'2fa',token:'fixture_token_not_real',methods:{sms:true}}]){const f=fixture({login});try{await assert.rejects(f.begin(),error=>error instanceof CanonicalAuthError);assert.equal(f.calls.length,1);assert.equal(f.consumed.length,0);}finally{f.broker.close();}}
});
test('MFA requires a freshly issued secure first-party session cookie, with no ambiguous duplicates',async()=>{
 const bad=[[],[cookie(COOKIE,'Path=/; HttpOnly; SameSite=Lax')],[cookie(COOKIE,'Path=/; Secure; SameSite=Lax')],[cookie(COOKIE,'Secure; HttpOnly; SameSite=Lax')],[cookie(COOKIE,'Path=/; Secure; HttpOnly; SameSite=None')],[cookie(COOKIE,'Path=/; Secure; HttpOnly; SameSite=Lax; Domain=untrusted.example')],[cookie(COOKIE,'Path=/other; Secure; HttpOnly; SameSite=Lax')],[cookie(),cookie('different_fixture_cookie')],[cookie(COOKIE,'Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0')]];
 for(const mfaCookies of bad){const f=fixture({mfaCookies});try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),error=>error instanceof CanonicalAuthError);assert.equal(f.consumed.length,0);assert.equal(f.calls.some(v=>v.url.endsWith('/me')),false);}finally{f.broker.close();}}
 const f=fixture({loginCookies:[cookie()]});try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('fresh_session_required'));assert.equal(f.consumed.length,0);}finally{f.broker.close();}
});
test('Max-Age determines cookie validity when an Expires attribute is also present',async()=>{
 const attributes='Path=/; Secure; HttpOnly; SameSite=Lax';
 for(const expires of ['Thu, 01 Jan 1970 00:00:00 GMT','not-a-cookie-date']){
  const f=fixture({mfaCookies:[cookie(COOKIE,attributes+'; Max-Age=600; Expires='+expires)]});
  try{const flow=await f.begin();assert.equal((await f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'})).sub,SUB);assert.equal(f.consumed.length,1);}finally{f.broker.close();}
 }
 for(const maxAge of ['0','-1']){
  const f=fixture({mfaCookies:[cookie(COOKIE,attributes+'; Max-Age='+maxAge+'; Expires=Thu, 01 Jan 2099 00:00:00 GMT')]});
  try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('fresh_session_required'));assert.equal(f.consumed.length,0);assert.equal(f.calls.some(v=>v.url.endsWith('/me')),false);}finally{f.broker.close();}
 }
 const f=fixture({mfaCookies:[cookie(COOKIE,attributes+'; Expires=Thu, 01 Jan 1970 00:00:00 GMT')]});
 try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('fresh_session_required'));assert.equal(f.consumed.length,0);}finally{f.broker.close();}
});
test('each fresh password transaction starts a separate cookie jar',async()=>{
 let counter=0;const f=fixture({request:async(operation,input,{identity})=>{
  if(operation==='login'){assert.equal(input.headers.cookie,undefined);const n=++counter;return response({next:'2fa',token:'fixture_flow_token_number_'+n,methods:{totp:true}},200,[cookie('fixture_pending_cookie_number_'+n)]);}
  if(operation==='login/2fa'){const n=input.headers['x-redx-flow'].endsWith('_1')?1:2;assert.equal(input.headers.cookie,'redx_session=fixture_pending_cookie_number_'+n);return response(null,200,[cookie('fixture_full_cookie_number_'+n)]);}
  if(operation==='me')return response(identity());return response({ok:true});
 }});try{const first=await f.begin(),second=await f.begin({nonce:'b'.repeat(32)});await f.broker.finish({flowId:first.flowId,method:'totp',code:'123456'});await f.broker.finish({flowId:second.flowId,method:'totp',code:'123456'});assert.equal(f.consumed.length,2);}finally{f.broker.close();}
});
test('local flow and trusted-store nonce are single-use and cannot be replayed',async()=>{
 const f=fixture({consume:()=>false});try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('nonce_reused'));await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('invalid_flow'));assert.equal(f.consumed.length,1);}finally{f.broker.close();}
 const g=fixture({consume:()=>({verified:true})});try{const flow=await g.begin();await assert.rejects(g.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('nonce_reused'));}finally{g.broker.close();}
});
test('concurrent completion cannot send two MFA requests for one flow',async()=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});const f=fixture({request:async(operation,_input,{identity})=>{
  if(operation==='login')return response({next:'2fa',token:'fixture_flow_token_not_real',methods:{totp:true}});
  if(operation==='login/2fa'){await waiting;return response(null,200,[cookie()]);}if(operation==='me')return response(identity());return response({ok:true});
 }});try{const flow=await f.begin(),pending=f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'});await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('invalid_flow'));release();await pending;assert.equal(f.calls.filter(v=>v.url.endsWith('/login/2fa')).length,1);}finally{release();f.broker.close();}
});
test('expired and cancelled flows cannot complete or consume a device nonce',async()=>{
 const f=fixture({limits:{flowTTLms:1000}});try{let flow=await f.begin();f.tick(1001);await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('invalid_flow'));flow=await f.begin();assert.equal(f.broker.cancel(flow.flowId),true);assert.equal(f.broker.cancel(flow.flowId),false);await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('invalid_flow'));assert.equal(f.consumed.length,0);}finally{f.broker.close();}
});
test('response failures, redirects and oversized/malformed bodies expose only fixed error codes',async()=>{
 const errors=[()=>{throw Error('fixture_password_not_real');},()=>new Response('fixture_password_not_real'),()=>new Response('x'.repeat(32769)),()=>{const r=response({});Object.defineProperty(r,'url',{value:'https://untrusted.example/steal'});return r;},()=>{const r=response({});Object.defineProperty(r,'redirected',{value:true});return r;}];
 for(const action of errors){const f=fixture({request:action});try{await assert.rejects(f.begin(),error=>{assert.ok(error instanceof CanonicalAuthError);assert.equal(JSON.stringify(error).includes('fixture_password_not_real'),false);assert.equal(error.message.includes('fixture_password_not_real'),false);return true;});assert.equal(f.consumed.length,0);}finally{f.broker.close();}}
});
test('timed-out requests retain their bounded slot until the underlying work settles',async()=>{
 let signal;const f=fixture({limits:{requestTimeoutMs:15,maxConcurrent:1},request:(_operation,input)=>{signal=input.signal;return new Promise(()=>{});}});try{await assert.rejects(f.begin(),code('upstream_unavailable'));assert.equal(signal.aborted,true);await assert.rejects(f.begin(),code('broker_capacity'));assert.equal(f.calls.length,1);}finally{f.broker.close();}
});
test('trusted nonce-store timeout never returns a receipt or frees its unresolved work slot',async()=>{
 const f=fixture({limits:{requestTimeoutMs:15,maxConcurrent:1},consume:()=>new Promise(()=>{})});try{const flow=await f.begin();await assert.rejects(f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),code('nonce_unavailable'));assert.equal(f.consumed[0].signal.aborted,true);await assert.rejects(f.begin(),code('broker_capacity'));}finally{f.broker.close();}
});
test('flow capacity, binding shape and caller-provided targets fail closed',async()=>{
 const f=fixture({limits:{maxFlows:1}});try{await assert.rejects(f.begin({deviceKeyHash:'invalid'}),code('invalid_binding'));const flow=await f.begin();await assert.rejects(f.begin(),code('broker_capacity'));f.broker.cancel(flow.flowId);const next=await f.begin({url:'https://untrusted.example',headers:{cookie:'stolen'}});assert.ok(next.flowId);f.broker.close();await assert.rejects(f.broker.finish({flowId:next.flowId,method:'totp',code:'123456'}),code('invalid_flow'));}finally{f.broker.close();}
});
function lateResponse(){
 let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};
}
function watchedResponse(json,cookies=[]){
 const value=response(json,200,cookies),original=value.headers.getSetCookie.bind(value.headers);let reads=0;
 Object.defineProperty(value.headers,'getSetCookie',{value:()=>{reads++;return original();}});
 return{value,reads:()=>reads};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('late password responses cannot restore cookies or flow tokens after timeout, expiry or close',async()=>{
 for(const mode of ['timeout','expiry','close']){
  const late=lateResponse();let first=true;
  const f=fixture({limits:{requestTimeoutMs:mode==='timeout'?15:200,flowTTLms:mode==='expiry'?25:1000,maxConcurrent:1},request:operation=>{
   assert.equal(operation,'login');if(first){first=false;return late.promise;}return response({next:'2fa',token:'fixture_new_flow_token',methods:{totp:true}});
  }});
  try{
   const pending=f.begin(),rejected=assert.rejects(pending,code(mode==='timeout'?'upstream_unavailable':'invalid_flow'));await turn();if(mode==='close')f.broker.close();await rejected;
   const watched=watchedResponse({next:'2fa',token:'fixture_late_flow_token',methods:{totp:true}},[cookie('fixture_late_session_token')]);late.resolve(watched.value);await turn();
   assert.equal(watched.reads(),0);assert.equal(f.consumed.length,0);assert.equal(f.calls.length,1);
   if(mode!=='close'){await f.begin();assert.equal(f.calls[1].input.headers.cookie,undefined);}
  }finally{late.resolve(response({}));f.broker.close();}
 }
});
test('close stops claimed MFA and me requests before a late response can restore transient secrets',async()=>{
 for(const stage of ['login/2fa','me']){
  const late=lateResponse(),started=lateResponse();const f=fixture({request:(operation,_input,{identity})=>{
   if(operation==='login')return response({next:'2fa',token:'fixture_flow_token_not_real',methods:{totp:true}});
   if(operation===stage){started.resolve();return late.promise;}
   if(operation==='login/2fa')return response(null,200,[cookie()]);throw Error('Unexpected route');
  }});
  try{
   const flow=await f.begin(),pending=f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),rejected=assert.rejects(pending,code('invalid_flow'));await started.promise;f.broker.close();await rejected;
   const watched=watchedResponse(stage==='me'?{account:{id:SUB},amr:['pwd','otp'],expiresMs:EPOCH+3600000}:null,[cookie('fixture_late_cookie_not_real')]);late.resolve(watched.value);await turn();
   assert.equal(watched.reads(),0);assert.equal(f.consumed.length,0);assert.equal(f.calls.some(value=>value.url.endsWith('/logout')),false);
  }finally{late.resolve(response({}));f.broker.close();}
 }
});
test('a claimed completion retains its original deadline and can still be cancelled',async()=>{
 for(const mode of ['expiry','cancel']){
  const late=lateResponse(),started=lateResponse();const f=fixture({limits:{flowTTLms:mode==='expiry'?25:1000,requestTimeoutMs:200},request:operation=>{
   if(operation==='login')return response({next:'2fa',token:'fixture_flow_token_not_real',methods:{totp:true}});if(operation==='login/2fa'){started.resolve();return late.promise;}throw Error('Unexpected route');
  }});
  try{
   const flow=await f.begin(),pending=f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),rejected=assert.rejects(pending,code('invalid_flow'));await started.promise;if(mode==='cancel')assert.equal(f.broker.cancel(flow.flowId),true);await rejected;
   const watched=watchedResponse(null,[cookie()]);late.resolve(watched.value);await turn();assert.equal(watched.reads(),0);assert.equal(f.consumed.length,0);
  }finally{late.resolve(response({}));f.broker.close();}
 }
});
test('close aborts claimed nonce work and a later true result cannot issue a receipt',async()=>{
 const late=lateResponse(),started=lateResponse();const f=fixture({consume:()=>{started.resolve();return late.promise;}});try{
  const flow=await f.begin(),pending=f.broker.finish({flowId:flow.flowId,method:'totp',code:'123456'}),rejected=assert.rejects(pending,code('nonce_unavailable'));await started.promise;f.broker.close();await rejected;
  assert.equal(f.consumed[0].signal.aborted,true);late.resolve(true);await turn();assert.equal(f.calls.length,3);assert.equal(f.calls.some(value=>value.url.endsWith('/logout')),false);
 }finally{late.resolve(false);f.broker.close();}
});
