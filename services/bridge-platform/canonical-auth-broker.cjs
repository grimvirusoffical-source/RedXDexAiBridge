'use strict';
// Unwired integration client for the primary website's observed browser flow.
// It is not a central-authority adapter: live contract, revocation, moderation
// and app-membership verification are still required before production use.
// Scoped upstream session cleanup is unverified. Cleanup clears only transient
// broker state; it never calls logout or claims to revoke a primary session.
const crypto=require('node:crypto');
const ORIGIN='https://red-xai.com',PREFIX='/api/accounts/',SESSION='redx_session';
const PATHS=new Set(['login','login/call','login/2fa','me']);
class CanonicalAuthError extends Error{constructor(code){super(code);this.name='CanonicalAuthError';this.code=code;}}
const fail=code=>{throw new CanonicalAuthError(code);};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const subject=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\x00-\x1f\x7f]/.test(value);
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_.~-]{16,1024}$/.test(value);
// consumeNonce must atomically consume the server-issued subject/device/nonce
// challenge and return exactly true. Its AbortSignal bounds caller waiting;
// unresolved work retains its capacity slot until the dependency settles.
function binding(input){
 if(!input||!subject(input.sub)||!/^[a-f0-9]{64}$/.test(input.deviceKeyHash||'')||!/^[A-Za-z0-9_-]{20,128}$/.test(input.nonce||''))fail('invalid_binding');
 return{sub:input.sub,deviceKeyHash:input.deviceKeyHash,nonce:input.nonce};
}
function createCanonicalAuthBroker({request=fetch,consumeNonce,now=Date.now,randomBytes=crypto.randomBytes,flowTTLms=180000,requestTimeoutMs=10000,maxFlows=100,maxConcurrent=8}={}){
 if(typeof request!=='function'||typeof consumeNonce!=='function'||typeof now!=='function'||typeof randomBytes!=='function')throw Error('Trusted broker dependencies required');
 if(!integer(flowTTLms,20,300000)||!integer(requestTimeoutMs,10,10000)||!integer(maxFlows,1,100)||!integer(maxConcurrent,1,8))throw Error('Invalid broker limits');
 const flows=new Map(),activeFlows=new Set(),inflight=new Set();let closed=false;
 function time(){const value=now();if(!Number.isSafeInteger(value)||value<0)fail('broker_unavailable');return value;}
 function remove(id,expected){const flow=flows.get(id);if(flow&&(!expected||flow===expected)){clearTimeout(flow.timer);flows.delete(id);return flow;}}
 function clearSecrets(flow){flow.disposed=true;clearTimeout(flow.timer);for(const controller of flow.controllers)controller.abort();flow.controllers.clear();flow.token=null;flow.cookie=null;flow.binding=null;flow.methods=[];flow.state='disposed';activeFlows.delete(flow);}
 function prune(){const timestamp=time();for(const [id,flow]of flows)if(flow.expiresMs<=timestamp){remove(id,flow);clearSecrets(flow);}}
 function flowFor(id){prune();if(closed||typeof id!=='string')fail('invalid_flow');const flow=flows.get(id);if(!flow||flow.state!=='ready'||flow.busy)fail('invalid_flow');return flow;}
 function readCookies(response,flow,requireFresh=false){
  if(closed||flow.disposed)fail('invalid_flow');
  if(typeof response.headers?.getSetCookie!=='function')fail('unsupported_cookie_response');
  const cookies=response.headers.getSetCookie();if(!Array.isArray(cookies)||cookies.length>16||cookies.reduce((n,v)=>n+String(v).length,0)>16384)fail('unsupported_cookie_response');
  let found=false,next=null;
  for(const value of cookies){
   if(typeof value!=='string'||/[\r\n\x00]/.test(value))fail('unsupported_cookie_response');
   const parts=value.split(';'),first=parts.shift(),equals=first.indexOf('=');if(equals<1)fail('unsupported_cookie_response');
   if(first.slice(0,equals).trim()!==SESSION)continue;
   if(found)fail('unsupported_cookie_response');found=true;
   const token=first.slice(equals+1).trim(),attrs=new Map();
   for(const part of parts){const split=part.indexOf('='),key=(split<0?part:part.slice(0,split)).trim().toLowerCase(),v=split<0?'':part.slice(split+1).trim();if(!key||attrs.has(key))fail('unsupported_cookie_response');attrs.set(key,v);}
   if(!attrs.has('secure')||!attrs.has('httponly')||!['lax','strict'].includes((attrs.get('samesite')||'').toLowerCase()))fail('unsupported_cookie_response');
   if(attrs.has('domain')&&attrs.get('domain').replace(/^\./,'').toLowerCase()!=='red-xai.com')fail('unsupported_cookie_response');
   if(!attrs.has('path')||!['/','/api','/api/','/api/accounts','/api/accounts/'].includes(attrs.get('path')))fail('unsupported_cookie_response');
   let expired=token==='';
   if(attrs.has('max-age')){if(!/^-?\d+$/.test(attrs.get('max-age')))fail('unsupported_cookie_response');const age=Number(attrs.get('max-age'));if(!Number.isSafeInteger(age))fail('unsupported_cookie_response');expired||=age<=0;}
   else if(attrs.has('expires')){const until=Date.parse(attrs.get('expires'));if(!Number.isFinite(until))fail('unsupported_cookie_response');expired||=until<=time();}
   if(!expired&&!/^[A-Za-z0-9_~.+/-]{12,1024}={0,2}$/.test(token))fail('unsupported_cookie_response');
   next=expired?null:token;
  }
  if(requireFresh&&(!found||!next||next===flow.cookie))fail('fresh_session_required');
  if(found)flow.cookie=next;
 }
 async function bodyOf(response){
  if(!response.body)return'';if(typeof response.body.getReader!=='function')fail('unsupported_auth_response');
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>32768){await reader.cancel().catch(()=>{});fail('unsupported_auth_response');}chunks.push(Buffer.from(item.value));}return Buffer.concat(chunks).toString('utf8');}finally{reader.releaseLock();}
 }
 async function call(operation,flow,body,{freshCookie=false}={}){
  if(!PATHS.has(operation))fail('unsupported_operation');if(closed||flow.disposed)fail('invalid_flow');if(inflight.size>=maxConcurrent)fail('broker_capacity');
  const url=ORIGIN+PREFIX+operation,controller=new AbortController();let timer,onAbort,timedOut=false;flow.controllers.add(controller);
  const headers={accept:'application/json',origin:ORIGIN};if(body!==undefined)headers['content-type']='application/json';
  if(flow.cookie)headers.cookie=SESSION+'='+flow.cookie;
  if(operation==='login/2fa'||operation==='login/call')headers['x-redx-flow']=flow.token;
  const pending=(async()=>{
   const response=await request(url,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),credentials:'omit',redirect:'error',signal:controller.signal});
   if(controller.signal.aborted||closed||flow.disposed)fail('invalid_flow');
   if(!response||response.redirected||(response.url&&response.url!==url)||!integer(response.status,100,599))fail('unsupported_auth_response');
   const raw=await bodyOf(response);if(controller.signal.aborted||closed||flow.disposed)fail('invalid_flow');let json=null;
   if(raw){try{json=JSON.parse(raw);}catch{fail('unsupported_auth_response');}if(!json||typeof json!=='object'||Array.isArray(json))fail('unsupported_auth_response');}
   if(response.status===200)readCookies(response,flow,freshCookie);
   return{status:response.status,json};
  })();
  const settled=()=>{inflight.delete(pending);flow.controllers.delete(controller);};inflight.add(pending);pending.then(settled,settled);
  try{return await Promise.race([pending,new Promise((_,reject)=>{onAbort=()=>reject(new CanonicalAuthError(timedOut?'upstream_unavailable':'invalid_flow'));controller.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{timedOut=true;controller.abort();},requestTimeoutMs);if(controller.signal.aborted)onAbort();})]);}
  catch(error){if(error instanceof CanonicalAuthError)throw error;fail('upstream_unavailable');}
  finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);}
 }
 async function cleanup(flow){
  clearSecrets(flow);
 }
 async function consume(flow,bound,completedAtMs){
  if(closed||flow.disposed)fail('invalid_flow');if(inflight.size>=maxConcurrent)fail('broker_capacity');
  const controller=new AbortController();let timer,onAbort;flow.controllers.add(controller);
  const pending=Promise.resolve().then(()=>{if(closed||flow.disposed||controller.signal.aborted)fail('invalid_flow');return consumeNonce(Object.freeze({issuer:ORIGIN,sub:bound.sub,deviceKeyHash:bound.deviceKeyHash,nonce:bound.nonce,completedAtMs,signal:controller.signal}));});
  const settled=()=>{inflight.delete(pending);flow.controllers.delete(controller);};inflight.add(pending);pending.then(settled,settled);
  try{return await Promise.race([pending,new Promise((_,reject)=>{onAbort=()=>reject(new CanonicalAuthError('nonce_unavailable'));controller.signal.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>controller.abort(),requestTimeoutMs);if(controller.signal.aborted)onAbort();})]);}
  catch{fail('nonce_unavailable');}finally{clearTimeout(timer);controller.signal.removeEventListener('abort',onAbort);}
 }
 async function begin(input){
  prune();if(closed||flows.size>=maxFlows)fail('broker_capacity');const bound=binding(input);
  if(typeof input.login!=='string'||!input.login.trim()||input.login.trim().length>254||typeof input.password!=='string'||!input.password||input.password.length>1024)fail('invalid_credentials');
  const bytes=randomBytes(32);if(!Buffer.isBuffer(bytes)||bytes.length!==32)fail('broker_unavailable');const id=bytes.toString('base64url');if(flows.has(id))fail('broker_unavailable');
  const flow={id,binding:bound,cookie:null,token:null,state:'pending',busy:false,callRequested:false,disposed:false,controllers:new Set(),expiresMs:time()+flowTTLms,timer:null};
  flow.timer=setTimeout(()=>{remove(id,flow);clearSecrets(flow);},flowTTLms);flow.timer.unref?.();flows.set(id,flow);activeFlows.add(flow);
  try{
   const response=await call('login',flow,{login:input.login.trim(),password:input.password});
   if(response.status!==200)fail('invalid_credentials');const json=response.json;
   if(json?.next==='2fa_setup')fail('mfa_setup_required');
   if(json?.next!=='2fa'||!opaque(json.token)||!json.methods||typeof json.methods!=='object'||Array.isArray(json.methods))fail('unsupported_auth_response');
   const methods=['totp','call'].filter(method=>json.methods[method]===true);if(!methods.length)fail('unsupported_auth_response');
   if(!flows.has(id)||flow.expiresMs<=time())fail('invalid_flow');flow.token=json.token;flow.methods=methods;flow.state='ready';
   return Object.freeze({flowId:id,methods:Object.freeze([...methods])});
  }catch(error){remove(id,flow);await cleanup(flow);if(error instanceof CanonicalAuthError)throw error;fail('upstream_unavailable');}
 }
 async function requestCall(id){
  const flow=flowFor(id);if(!flow.methods.includes('call')||flow.callRequested)fail('invalid_factor');flow.busy=true;flow.callRequested=true;
  try{if((await call('login/call',flow,{})).status!==200)fail('invalid_factor');if(!flows.has(id)||flow.expiresMs<=time())fail('invalid_flow');return Object.freeze({sent:true});}
  catch(error){remove(id,flow);await cleanup(flow);if(error instanceof CanonicalAuthError)throw error;fail('upstream_unavailable');}
  finally{flow.busy=false;}
 }
 async function finish({flowId,method,code}={}){
  const flow=flowFor(flowId);flows.delete(flowId); // Claim once, retaining its deadline during completion.
  try{
   if(!flow.methods.includes(method)||!['totp','call'].includes(method)||typeof code!=='string'||!/^[\d ]{4,20}$/.test(code)||!/^\d{4,10}$/.test(code.replace(/ /g,'')))fail('invalid_factor');
   if((await call('login/2fa',flow,{method,code},{freshCookie:true})).status!==200)fail('invalid_factor');
   const me=await call('me',flow);if(me.status!==200)fail('untrusted_account');const data=me.json,account=data?.account;
   if(!account||!subject(account.id)||account.id!==flow.binding.sub)fail('subject_mismatch');
   for(const record of [data,account]){
    if((record.active!==undefined&&record.active!==true)||(record.status!==undefined&&record.status!=='active')||['deleted','disabled','banned'].some(key=>record[key]!==undefined&&record[key]!==false)||['email_verified','emailVerified'].some(key=>record[key]!==undefined&&record[key]!==true))fail('untrusted_account');
   }
   const amr=data.amr,roles=account.roles===undefined?[]:account.roles;
   const strings=list=>Array.isArray(list)&&list.length<=32&&list.every(value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value));
   if(!strings(amr)||!amr.includes('pwd')||!amr.includes(method==='totp'?'otp':'call')||!strings(roles)||!Number.isSafeInteger(data.expiresMs)||data.expiresMs<=time())fail('untrusted_account');
   if(closed||flow.expiresMs<=time())fail('invalid_flow');const completedAtMs=time(),bound=flow.binding;
   const consumed=await consume(flow,bound,completedAtMs);
   if(consumed!==true)fail('nonce_reused');
   if(closed||flow.expiresMs<=time())fail('invalid_flow');
   return Object.freeze({issuer:ORIGIN,sub:bound.sub,deviceKeyHash:bound.deviceKeyHash,nonceSha256:crypto.createHash('sha256').update(bound.nonce).digest('hex'),amr:Object.freeze([...new Set(amr)]),canonicalRoles:Object.freeze([...new Set(roles)]),mfaUsed:true,reauthenticationVerified:true,freshLoginVerified:true,reauthAtMs:completedAtMs});
  }catch(error){if(error instanceof CanonicalAuthError)throw error;fail('upstream_unavailable');}
  finally{await cleanup(flow);}
 }
 function cancel(id){const flow=remove(id)||[...activeFlows].find(value=>value.id===id);if(flow)clearSecrets(flow);return!!flow;}
 function close(){closed=true;flows.clear();for(const flow of [...activeFlows])clearSecrets(flow);}
 return Object.freeze({begin,requestCall,finish,cancel,close});
}
module.exports={createCanonicalAuthBroker,CanonicalAuthError};
