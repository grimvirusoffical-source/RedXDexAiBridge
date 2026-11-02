'use strict';
const crypto=require('node:crypto');
const {PlatformError}=require('./index.cjs');
const DEVICELESS=new Set(['/catalog','/me','/device/challenge','/device/enroll','/account/join']);
function createHandler({platform,authenticate,verifyCSRF=null,extraRoutes=null,rawWebhook=null,readiness=null,prefix='/redxai-bridge/api',publicOrigin='https://red-xai.com'}={}){
 if(!platform||typeof authenticate!=='function')throw Error('Trusted authentication adapter required');
 const budgets=new Map();
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
   if(!DEVICELESS.has(route))actor=await platform.verifyDeviceProof(actor,{method:req.method,path:u.pathname+u.search,bodyHash:crypto.createHash('sha256').update(raw).digest('hex'),deviceId:req.headers['x-bridge-device'],timeMs:Number(req.headers['x-bridge-time']),nonce:req.headers['x-bridge-nonce'],signature:req.headers['x-bridge-signature']});
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
function createNativeAuthenticator({request=fetch,trustedIP=()=>null,resolvePrivileges=async()=>({})}={}){
 const quick=createQuickLoginAuthenticator({request,trustedIP,resolvePrivileges});
 return async req=>{
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
