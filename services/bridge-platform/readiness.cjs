'use strict';
const crypto=require('node:crypto');
const CHECKS=['accountAuthority','ownerBinding','ownerMfa','bridgeDeletion','globalDeletion','deviceProof','legalAcceptance','legalReviewed','usageEnforcement','stripeWebhook','redxPersistence'];
const DETAILS=['legalName','supportContact','privacyContact','refundPolicy','cancellationPolicy','jurisdiction','retentionPeriods','subprocessors','internationalTransfers','rightsProcess'];
const contentHash=legal=>crypto.createHash('sha256').update(JSON.stringify({version:legal.version,documents:legal.documents,businessDetails:legal.businessDetails})).digest('hex');
function reviewedLegal(legal,approval=legal?.review,now=Date.now()){
 if(!legal||legal.requiresReview!==false||!['approved','published'].includes(legal.status)||!Array.isArray(legal.documents)||legal.documents.length!==3||legal.documents.map(d=>d.id).join(',')!=='terms,privacy,agreement'||legal.documents.some(d=>typeof d.content!=='string'||!d.content.trim()))return false;
 if(DETAILS.some(key=>typeof legal.businessDetails?.[key]!=='string'||!legal.businessDetails[key].trim()||legal.businessDetails[key].length>8192))return false;
 return approval?.approved===true&&approval.businessDetailsReviewed===true&&approval.version===legal.version&&Number.isSafeInteger(approval.reviewedAtMs)&&approval.reviewedAtMs>0&&approval.reviewedAtMs<=now&&approval.contentSha256===contentHash(legal);
}
function publicReadiness(value={},legalVersion=''){
 const checks=Object.fromEntries(CHECKS.map(key=>[key,value.checks?.[key]===true])),billingMode=['live','sandbox'].includes(value.billingMode)?value.billingMode:'unconfigured';
 return{ready:value.ready===true&&billingMode==='live'&&CHECKS.every(key=>checks[key]),app:'bridge',issuer:'https://red-xai.com',billingMode,legalVersion:/^[A-Za-z0-9._-]{1,100}$/.test(legalVersion)?legalVersion:'',checks};
}
function createReadinessProbe({authority={},store,platform,billing,legal,config={},clientConfig={},now=Date.now,timeoutMs=3000,cacheMs=5000}={}){
 let cached=null,until=0,inflight=null,evaluation=null;
 const unavailable=()=>publicReadiness({},legal?.version);
 async function evaluate(){
  const checks=Object.fromEntries(CHECKS.map(key=>[key,false])),base=platform?.readiness?.()||{};
  checks.legalReviewed=config.legalApproved===true&&reviewedLegal(legal,config.legalApproval,now())&&reviewedLegal(legal,legal.review,now());
  let snapshot=null,evidence=null,provider=null;
  const results=await Promise.allSettled([
   store?.load?store.load():Promise.reject(Error('Store unavailable')),
   typeof authority.verifyDeploymentReadiness==='function'?authority.verifyDeploymentReadiness({issuer:'https://red-xai.com',clientId:'bridge',appNumber:6,ownerSubjects:[...(config.ownerSubjects||[])],legalVersion:legal?.version,signal:AbortSignal.timeout(timeoutMs)}):Promise.reject(Error('Authority evidence unavailable')),
   typeof billing?.verifyReadiness==='function'?billing.verifyReadiness():Promise.reject(Error('Billing evidence unavailable'))
  ]);
  if(results[0].status==='fulfilled')snapshot=results[0].value;if(results[1].status==='fulfilled')evidence=results[1].value;if(results[2].status==='fulfilled')provider=results[2].value;
  const fresh=evidence?.verified===true&&evidence.issuer==='https://red-xai.com'&&evidence.clientId==='bridge'&&evidence.appNumber===6&&Number.isSafeInteger(evidence.checkedAtMs)&&evidence.checkedAtMs<=now()+30000&&evidence.checkedAtMs>now()-600000;
  const methods=['resolvePrivileges','revokeBridgeSession','deleteBridgeMembership','deleteAccount','moderate','cancelSubscription','trustedIP','verifyCSRF'];
  checks.accountAuthority=fresh&&methods.every(key=>typeof authority[key]==='function')&&evidence.canonicalAccounts===true&&evidence.reauthentication===true&&evidence.sessionRevocation===true&&evidence.moderation===true&&evidence.recovery===true&&evidence.freshLogin===true;
  checks.ownerMfa=fresh&&evidence.mfa===true;
  checks.ownerBinding=checks.ownerMfa&&Array.isArray(config.ownerSubjects)&&config.ownerSubjects.length>0&&config.ownerSubjects.every(sub=>evidence.owners?.some(owner=>owner.sub===sub&&owner.verified===true&&owner.mfaRequired===true));
  checks.bridgeDeletion=fresh&&base.bridgeDeletion===true&&evidence.bridgeMembershipDeletion===true;checks.globalDeletion=fresh&&base.globalDeletion===true&&evidence.globalAccountDeletion===true;
  checks.deviceProof=fresh&&base.licenseSigning===true&&evidence.deviceProof===true;
  checks.legalAcceptance=checks.legalReviewed&&fresh&&evidence.legalAcceptance===true&&evidence.legalVersion===legal?.version;
  checks.usageEnforcement=clientConfig.required===true&&fresh&&evidence.usageEnforcement===true;
  checks.redxPersistence=store?.productionReady===true&&snapshot?.schema===1&&snapshot.revision>0&&snapshot.key===store.recordKey&&fresh&&evidence.persistence?.namespace===store.recordKey&&evidence.persistence?.durableWrite===true&&evidence.persistence?.casConflict===true;
  checks.stripeWebhook=provider?.catalogVerified===true&&provider.portalVerified===true&&provider.webhookVerified===true;
  const billingMode=provider?.mode||billing?.status?.()?.mode;
  return publicReadiness({ready:CHECKS.every(key=>checks[key]),billingMode,checks},legal?.version);
 }
 return async()=>{
  if(cached&&until>now())return structuredClone(cached);if(inflight)return structuredClone(await inflight);
  // A public deadline must not release the underlying provider-work slot. Keep
  // an unresolved evaluation coalesced until its actual requests have settled.
  if(!evaluation){const task=evaluate().catch(unavailable);evaluation=task;task.then(()=>{if(evaluation===task)evaluation=null;});}
  inflight=(async()=>{let timer;try{return await Promise.race([evaluation,new Promise(resolve=>{timer=setTimeout(()=>resolve(unavailable()),timeoutMs);})]);}catch{return unavailable();}finally{clearTimeout(timer);}})();
  try{cached=await inflight;until=now()+cacheMs;return structuredClone(cached);}finally{inflight=null;}
 };
}
module.exports={CHECKS,DETAILS,contentHash,reviewedLegal,publicReadiness,createReadinessProbe};
