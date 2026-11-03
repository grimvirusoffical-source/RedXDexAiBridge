'use strict';
const crypto=require('node:crypto');
const {PlatformError}=require('./index.cjs');
const {CHECKS,validLegalVersion}=require('./readiness.cjs');
const DEVICELESS=new Set(['/catalog','/me','/device/challenge','/device/enroll','/account/join']);
const PURCHASES=new Set(['/checkout/quote','/checkout/create','/purchase/credits']);
const DEVICE_PROOF_HEADERS=['x-bridge-device','x-bridge-time','x-bridge-nonce','x-bridge-signature'];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const ownValue=(value,key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;};
function purchaseReady(value,legalVersion){
 if(!plain(value)||!validLegalVersion(legalVersion))return false;
 for(const [key,expected]of Object.entries({ready:true,app:'bridge',issuer:'https://red-xai.com',billingMode:'live',legalVersion}))if(ownValue(value,key)!==expected)return false;
 const checks=ownValue(value,'checks');return plain(checks)&&CHECKS.every(key=>ownValue(checks,key)===true);
}
const CANONICAL_ME='https://red-xai.com/api/accounts/me',COOKIE_TOKEN=/^[A-Za-z0-9_~.+/-]{12,1024}={0,2}$/;
const canonicalSubject=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\p{Cc}]/u.test(value)&&!(value in Object.prototype);
function expectedCookieSubject(encoded){
 if(typeof encoded!=='string'||!encoded.length||encoded.length>1100||!/^[A-Za-z0-9_-]+$/.test(encoded))return null;
 const bytes=Buffer.from(encoded,'base64url'),value=bytes.toString('utf8');if(bytes.length>800||bytes.toString('base64url')!==encoded||!Buffer.from(value,'utf8').equals(bytes)||!canonicalSubject(value))return null;return value;
}
async function canonicalJSON(response){
 if(!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(response.headers?.get('content-type')||'')||typeof response.body?.getReader!=='function')throw Error('Canonical account verification unavailable');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>32768){await reader.cancel().catch(()=>{});throw Error('Canonical account verification unavailable');}chunks.push(Buffer.from(next.value));}const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));if(!data||typeof data!=='object'||Array.isArray(data))throw Error();return data;}catch{throw Error('Canonical account verification unavailable');}finally{reader.releaseLock();}
}
function createHandler({platform,authenticate,verifyCSRF=null,extraRoutes=null,rawWebhook=null,readiness=null,prefix='/redxai-bridge/api',publicOrigin='https://red-xai.com'}={}){
 if(!platform||typeof authenticate!=='function')throw Error('Trusted authentication adapter required');
 const budgets=new Map();
 async function purchasesAvailable(){
  if(typeof readiness!=='function')return false;let timer;
  try{const value=await Promise.race([Promise.resolve().then(()=>readiness()),new Promise(resolve=>{timer=setTimeout(()=>resolve(null),3000);})]);return purchaseReady(value,platform.legalVersion);}catch{return false;}finally{clearTimeout(timer);}
 }
 return async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; frame-ancestors 'none'"});res.end(JSON.stringify(data));};
  try{
   if(req.headers.host!==new URL(publicOrigin).host)return send(403,{error:'wrong_host'});
   const u=new URL(req.url,publicOrigin);if(u.origin!==publicOrigin||!u.pathname.startsWith(prefix+'/'))return send(404,{error:'not_found'});
   const route=u.pathname.slice(prefix.length);
   if(route==='/stripe/webhook'&&req.method==='POST'&&rawWebhook)return await rawWebhook(req,res);
   if(!['GET','POST'].includes(req.method))return send(405,{error:'method_not_allowed'});
   if(req.headers.origin&&req.headers.origin!==publicOrigin)return send(403,{error:'cross_origin_refused'});
   if(route==='/readiness'){if(req.method!=='GET')return send(405,{error:'method_not_allowed'});const {publicReadiness}=require('./readiness.cjs');let result={};try{if(typeof readiness==='function')result=await readiness();}catch{}return send(200,publicReadiness(result,platform.legalVersion));}
   let actor=await authenticate(req);if(!actor||actor.verified!==true)return send(401,{error:'sign_in_required'});
   const now=Date.now();let budget=budgets.get(actor.sub);if(!budget||budget.untilMs<=now){budget={count:0,untilMs:now+60000};budgets.set(actor.sub,budget);}if(++budget.count>240)return send(429,{error:'rate_limited',retryAfter:Math.ceil((budget.untilMs-now)/1000)});if(budgets.size>1000)for(const [sub,value]of budgets)if(value.untilMs<=now)budgets.delete(sub);
   const chunks=[];let length=0;
   if(req.method==='POST'){
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(415,{error:'json_required'});
    for await(const b of req){length+=b.length;if(length>8*1024*1024)return send(413,{error:'body_too_large'});chunks.push(b);}
    if(req.headers.origin||req.headers.cookie){if(typeof verifyCSRF!=='function'||!(await verifyCSRF(req,actor)))return send(403,{error:'csrf_required'});}
   }
   const raw=Buffer.concat(chunks),body=raw.length?JSON.parse(raw.toString('utf8')):{};if(!body||typeof body!=='object'||Array.isArray(body))return send(400,{error:'invalid_json'});
   const suppliedMeProof=route==='/me'&&DEVICE_PROOF_HEADERS.some(key=>Object.hasOwn(req.headers,key));
   if(suppliedMeProof&&!DEVICE_PROOF_HEADERS.every(key=>typeof req.headers[key]==='string'&&req.headers[key].length>0))return send(403,{error:'device_proof_required'});
   if(!DEVICELESS.has(route)||suppliedMeProof)actor=await platform.verifyDeviceProof(actor,{method:req.method,path:u.pathname+u.search,bodyHash:crypto.createHash('sha256').update(raw).digest('hex'),deviceId:req.headers['x-bridge-device'],timeMs:Number(req.headers['x-bridge-time']),nonce:req.headers['x-bridge-nonce'],signature:req.headers['x-bridge-signature']});
   if(PURCHASES.has(route)&&!(await purchasesAvailable()))return send(503,{error:'purchases_unavailable'});
   const query=Object.fromEntries(u.searchParams);if(extraRoutes){const extra=await extraRoutes({req,res,route,actor,body,query});if(extra!==undefined)return res.writableEnded?undefined:send(200,extra);}
   send(200,await platform.dispatch(actor,route,body,query));
  }catch(e){if(e instanceof SyntaxError)return send(400,{error:'invalid_json'});if(e instanceof PlatformError)return send(e.status,{error:e.code,...e.details});send(503,{error:'platform_unavailable'});}
 };
}
function createQuickLoginAuthenticator({request=fetch,trustedIP=()=>null,resolvePrivileges=async()=>({})}={}){
 return async req=>{
  const auth=req.headers.authorization||'';if(!/^Bearer rxca_[A-Za-z0-9_-]{43}$/.test(auth))return null;
  const response=await request('https://red-xai.com/redxai-connect/userinfo',{headers:{authorization:auth,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return null;const raw=await response.text();if(raw.length>32768)throw Error('Identity response too large');const user=JSON.parse(raw);
  if(user.issuer!=='https://red-xai.com'||user.protocol!=='redx-site-session-v1'||user.client_id!=='bridge'||user.scope!=='bridge.app'||user.email_verified!==true||typeof user.sub!=='string')return null;
  const privileges=await resolvePrivileges({sub:user.sub,credential:auth,request:req});
  return{sub:user.sub,username:user.username||'',email:user.email||'',verified:true,remoteIP:trustedIP(req),mfaUsed:privileges.mfaUsed===true,reauthenticationVerified:privileges.reauthenticationVerified===true,ownerVerified:privileges.ownerVerified===true,reauthAtMs:privileges.reauthAtMs||0,recoveryVerified:privileges.recoveryVerified===true,freshLoginVerified:privileges.freshLoginVerified===true,authorityContext:privileges.authorityContext};
 };
}
function createNativeAuthenticator({request=fetch,trustedIP=()=>null,resolvePrivileges=async()=>({}),canonicalCookieTransport=false,canonicalTimeoutMs=10000,canonicalMaxInFlight=8,now=Date.now}={}){
 if(!Number.isSafeInteger(canonicalTimeoutMs)||canonicalTimeoutMs<10||canonicalTimeoutMs>10000||!Number.isSafeInteger(canonicalMaxInFlight)||canonicalMaxInFlight<1||canonicalMaxInFlight>8||typeof now!=='function')throw Error('Invalid canonical account verification limits');
 const quick=createQuickLoginAuthenticator({request,trustedIP,resolvePrivileges});
 const canonicalPending=new Set();
 async function canonical(req){
  if(canonicalCookieTransport!==true||['authorization','x-redx-session','cookie','origin'].some(key=>Object.hasOwn(req.headers,key)))return null;
  const credential=req.headers['x-bridge-site-session'],expected=expectedCookieSubject(req.headers['x-bridge-site-subject']);
  if(typeof credential!=='string'||!COOKIE_TOKEN.test(credential)||!expected)return null;
  if(canonicalPending.size>=canonicalMaxInFlight)throw Error('Canonical account verification unavailable');
  const controller=new AbortController();let timer;
  const pending=(async()=>{
   const response=await request(CANONICAL_ME,{method:'GET',headers:{accept:'application/json',cookie:'redx_session='+credential},credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});
   if(controller.signal.aborted)throw Error();if(response.redirected||(response.url&&response.url!==CANONICAL_ME))return null;
   if(!response.ok)return null;const data=await canonicalJSON(response);if(controller.signal.aborted)throw Error();const account=data.account,amr=data.amr,checkedAtMs=now();
   if(!Number.isSafeInteger(checkedAtMs)||checkedAtMs<0||!account||typeof account!=='object'||Array.isArray(account)||!canonicalSubject(account.id)||account.id!==expected||!Array.isArray(amr)||!amr.length||amr.length>32||!amr.every(value=>typeof value==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(value))||!Number.isSafeInteger(data.expiresMs)||data.expiresMs<=checkedAtMs)return null;
   for(const value of [data,account])if((value.active!==undefined&&value.active!==true)||(value.status!==undefined&&value.status!=='active')||['deleted','disabled','banned'].some(key=>value[key]!==undefined&&value[key]!==false)||['email_verified','emailVerified'].some(key=>value[key]!==undefined&&value[key]!==true)||(value.pending!==undefined&&(!Array.isArray(value.pending)||value.pending.length)))return null;
   // Upstream metadata is evidence for the trusted adapter, not a direct grant.
   const privileges=await resolvePrivileges({sub:account.id,credential,provider:'website-cookie',request:req,upstream:data,signal:controller.signal});
   if(controller.signal.aborted)throw Error();if(!privileges||typeof privileges!=='object'||Array.isArray(privileges))throw Error();
   const completedAtMs=now();if(!Number.isSafeInteger(completedAtMs)||completedAtMs<0||data.expiresMs<=completedAtMs)return null;return{account,privileges};
  })();
  canonicalPending.add(pending);pending.then(()=>canonicalPending.delete(pending),()=>canonicalPending.delete(pending));
  let verified;
  try{verified=await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Canonical account verification unavailable'));},canonicalTimeoutMs);})]);}
  catch{throw Error('Canonical account verification unavailable');}finally{clearTimeout(timer);}
  if(!verified)return null;const {account,privileges}=verified,sub=account.id;
  // The expected subject is only a constraint on a proven primary identity.
  // Roles/AMR/expiry do not themselves grant owner, email or freshness claims.
  return{sub,username:typeof account.username==='string'?account.username.slice(0,80):'',email:typeof account.email==='string'?account.email.slice(0,254):'',verified:true,remoteIP:trustedIP(req),mfaUsed:privileges.mfaUsed===true,reauthenticationVerified:privileges.reauthenticationVerified===true,ownerVerified:privileges.ownerVerified===true,reauthAtMs:privileges.reauthAtMs||0,recoveryVerified:privileges.recoveryVerified===true,freshLoginVerified:privileges.freshLoginVerified===true,authorityContext:privileges.authorityContext};
 }
 return async req=>{
  if(Object.hasOwn(req.headers,'x-bridge-site-session')||Object.hasOwn(req.headers,'x-bridge-site-subject'))return canonical(req);
  if(req.headers.authorization)return quick(req);
  const credential=req.headers['x-redx-session'];if(typeof credential!=='string'||credential.length<12||credential.length>512||/[\r\n]/.test(credential))return null;
  const r=await request('https://api.red-xai.com/v1/accounts/me',{headers:{'X-RedX-Session':credential,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)return null;
  const raw=await r.text();if(raw.length>32768)throw Error('Identity response too large');const d=JSON.parse(raw),account=d.account,sub=account?.id||account?.sub;
  if(typeof sub!=='string'||account.disabled===true||account.deleted===true||d.active===false||account.active===false||account.status==='banned')return null;
  const privileges=await resolvePrivileges({sub,credential,provider:'website',request:req,upstream:d});
  return{sub,username:account.username||'',email:account.email||'',verified:true,remoteIP:trustedIP(req),mfaUsed:privileges.mfaUsed===true,reauthenticationVerified:privileges.reauthenticationVerified===true,ownerVerified:privileges.ownerVerified===true,reauthAtMs:privileges.reauthAtMs||0,recoveryVerified:privileges.recoveryVerified===true,freshLoginVerified:privileges.freshLoginVerified===true,authorityContext:privileges.authorityContext};
 };
}
module.exports={createHandler,createQuickLoginAuthenticator,createNativeAuthenticator};
