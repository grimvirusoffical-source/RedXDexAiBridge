'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkPlatformReadiness}=require('../scripts/check-platform-readiness.cjs');
const legal=require('../app/legal-content.cjs');
const ready={ready:true,app:'bridge',issuer:'https://red-xai.com',billingMode:'live',legalVersion:legal.version,checks:{accountAuthority:true,ownerBinding:true,deviceProof:true,legalAcceptance:true,usageEnforcement:true,stripeWebhook:true,redxPersistence:true}};
const request=value=>async()=>({ok:true,json:async()=>value});
test('preview cannot publish a stable release even if the remote service claims readiness',async()=>{
 let contacted=false;await assert.rejects(checkPlatformReadiness({local:{required:false},request:async()=>{contacted=true;return{ok:true,json:async()=>ready};}}),/preview/);assert.equal(contacted,false);
});
test('stable release requires every current production capability and rejects sandbox billing',async()=>{
 assert.equal((await checkPlatformReadiness({local:{required:true},request:request(ready)})).ready,true);
 for(const key of Object.keys(ready.checks))await assert.rejects(checkPlatformReadiness({local:{required:true},request:request({...ready,checks:{...ready.checks,[key]:false}})}),/incomplete/);
 for(const override of [{billingMode:'sandbox'},{legalVersion:'old'},{issuer:'https://example.com'},{app:'vortex'},{ready:false}])await assert.rejects(checkPlatformReadiness({local:{required:true},request:request({...ready,...override})}),/incomplete/);
 await assert.rejects(checkPlatformReadiness({local:{required:true},request:async()=>({ok:false,status:404})}),/unavailable/);
});
