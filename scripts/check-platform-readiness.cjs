'use strict';
const config=require('../app/platform-config.cjs');
const legal=require('../app/legal-content.cjs');
const {CHECKS:REQUIRED,reviewedLegal}=require('../services/bridge-platform/readiness.cjs');
const {releaseProfile,createPlatformIPC}=require('../app/platform-release.cjs');
async function checkDesktopPreview(local){
 if(releaseProfile(local)!=='desktop-preview')throw Error('An explicit inactive desktop preview profile is required');
 let invoked=false;const forbidden=()=>{invoked=true;throw Error('A desktop preview invoked an account-platform dependency');};
 const handlers=createPlatformIPC({config:local,status:forbidden,request:forbidden,checkout:forbidden});
 const snapshot=await handlers['platform:status']();
 if(snapshot.mode!=='desktop-preview'||snapshot.available!==false||snapshot.catalog?.planned!==true||!Array.isArray(snapshot.catalog.tiers)||snapshot.catalog.tiers.length!==7||!Array.isArray(snapshot.catalog.plugins)||snapshot.catalog.plugins.length!==4||['sub','role','creditsCents','availableCreditsCents','accepted','ownerBenefits'].some(key=>Object.hasOwn(snapshot,key)))throw Error('Desktop preview must expose only its planned public catalog');
 for(const [name,args]of [['platform:request',['/catalog']],['platform:request',['/checkout/quote',{kind:'subscription',tier:'gold'}]],['platform:request',['/plugins/run',{pluginId:'workflow-checkpoints'}]],['platform:request',['/account/delete',{scope:'global'}]],['platform:request',['/admin/users']],['platform:checkout',[{kind:'portal'}]],['platform:checkout',[{kind:'subscription',tier:'gold'}]]]){
  let denied=false;try{await handlers[name](...args);}catch(error){denied=error.code==='shop_coming_soon';}if(!denied)throw Error('Desktop preview account-platform operations must be disabled');
 }
 if(invoked)throw Error('Desktop preview invoked an account-platform dependency');
 return{ready:true,app:'bridge',releaseProfile:'desktop-preview',shopEnabled:false};
}
async function checkPlatformReadiness({local=config,documents=legal,request=globalThis.fetch}={}){
 if(local.releaseProfile==='desktop-preview')return checkDesktopPreview(local);
 releaseProfile(local);
 if(local.required!==true)throw Error('Production platform enforcement is not enabled. Keep this candidate in preview.');
 if(!reviewedLegal(documents))throw Error('Current agreements and business details have not been reviewed and approved.');
 const response=await request('https://red-xai.com/redxai-bridge/api/readiness',{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000),headers:{accept:'application/json'}});
 if(!response.ok)throw Error('Production platform readiness is unavailable.');
 const status=await response.json();
 if(status.ready!==true||status.app!=='bridge'||status.issuer!=='https://red-xai.com'||status.billingMode!=='live'||status.legalVersion!==documents.version||REQUIRED.some(key=>status.checks?.[key]!==true))throw Error('Production account, billing, agreement or usage verification is incomplete.');
 return{ready:true,app:'bridge',legalVersion:documents.version};
}
if(require.main===module)checkPlatformReadiness().then(value=>console.log(value.releaseProfile==='desktop-preview'?'Desktop preview release checks passed: shop inactive; production activation requires a later verified update.':'Production platform release checks passed')).catch(e=>{console.error('RELEASE BLOCKED: '+e.message);process.exitCode=1;});
module.exports={checkPlatformReadiness,checkDesktopPreview};
