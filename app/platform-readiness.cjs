'use strict';
const ORIGIN='https://red-xai.com',PREFIX='/redxai-bridge/api',READINESS_URL=ORIGIN+PREFIX+'/readiness';
const CHECKS=Object.freeze(['accountAuthority','ownerBinding','ownerMfa','bridgeDeletion','globalDeletion','deviceProof','legalAcceptance','legalReviewed','usageEnforcement','stripeWebhook','redxPersistence']);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const own=(value,key)=>{const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;};
const legalVersionValid=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(value);
function readinessVerified(value,legalVersion){
 if(!plain(value)||!legalVersionValid(legalVersion))return false;
 for(const [key,expected]of Object.entries({ready:true,app:'bridge',issuer:ORIGIN,billingMode:'live',legalVersion}))if(own(value,key)!==expected)return false;
 const checks=own(value,'checks');return plain(checks)&&CHECKS.every(key=>own(checks,key)===true);
}
function unavailable(){const error=Error('Red-XAI subscriptions are not available until the production account, payment and agreement checks pass.');error.code='platform_not_ready';return error;}
async function publicJSON(response,signal,maxBytes){
 if(!response||response.status!==200||response.redirected||(response.url&&response.url!==READINESS_URL)||!/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?\s*$/i.test(response.headers?.get('content-type')||'')||typeof response.body?.getReader!=='function')throw unavailable();
 const reader=response.body.getReader(),chunks=[];let length=0;
 const cancel=()=>{reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 try{
  while(true){if(signal.aborted)throw unavailable();const item=await reader.read();if(signal.aborted)throw unavailable();if(item.done)break;length+=item.value.byteLength;if(length>maxBytes){cancel();throw unavailable();}chunks.push(Buffer.from(item.value));}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 }finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
function createReadinessProbe({request=fetch,legalVersion,timeoutMs=5000,maxBytes=16384}={}){
 if(typeof request!=='function'||!legalVersionValid(legalVersion)||!Number.isSafeInteger(timeoutMs)||timeoutMs<10||timeoutMs>15000||!Number.isSafeInteger(maxBytes)||maxBytes<256||maxBytes>32768)throw Error('Valid bounded platform readiness settings are required');
 let active=null;
 return function probe(){
  if(active)return active.result.then(value=>structuredClone(value));
  const controller=new AbortController(),entry={result:null},pending=(async()=>{
   const response=await request(READINESS_URL,{method:'GET',headers:{accept:'application/json'},credentials:'omit',redirect:'error',cache:'no-store',signal:controller.signal});
   if(controller.signal.aborted)throw unavailable();const value=await publicJSON(response,controller.signal,maxBytes);
   if(controller.signal.aborted||!readinessVerified(value,legalVersion))throw unavailable();
   return{ready:true,app:'bridge',issuer:ORIGIN,billingMode:'live',legalVersion,checks:Object.fromEntries(CHECKS.map(key=>[key,true]))};
  })();
  let timer;active=entry;
  // Caller timeouts retain an unresolved provider request's capacity slot.
  const release=()=>{if(active===entry)active=null;};pending.then(release,release);
  entry.result=Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(unavailable());},timeoutMs);})]).catch(()=>{throw unavailable();}).finally(()=>clearTimeout(timer));
  return entry.result.then(value=>structuredClone(value));
 };
}
module.exports={ORIGIN,PREFIX,READINESS_URL,CHECKS,readinessVerified,createReadinessProbe};
