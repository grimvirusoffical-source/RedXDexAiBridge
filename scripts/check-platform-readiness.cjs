'use strict';
const config=require('../app/platform-config.cjs');
const legal=require('../app/legal-content.cjs');
const REQUIRED=['accountAuthority','ownerBinding','deviceProof','legalAcceptance','usageEnforcement','stripeWebhook','redxPersistence'];
async function checkPlatformReadiness({local=config,request=globalThis.fetch}={}){
 if(local.required!==true)throw Error('Production platform enforcement is not enabled. Keep this candidate in preview.');
 const response=await request('https://red-xai.com/redxai-bridge/api/readiness',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Production platform readiness is unavailable.');
 const status=await response.json();
 if(status.ready!==true||status.app!=='bridge'||status.issuer!=='https://red-xai.com'||status.billingMode!=='live'||status.legalVersion!==legal.version||REQUIRED.some(key=>status.checks?.[key]!==true))throw Error('Production account, billing, agreement or usage verification is incomplete.');
 return{ready:true,app:'bridge',legalVersion:status.legalVersion};
}
if(require.main===module)checkPlatformReadiness().then(()=>console.log('Production platform release checks passed')).catch(e=>{console.error('RELEASE BLOCKED: '+e.message);process.exitCode=1;});
module.exports={checkPlatformReadiness};
