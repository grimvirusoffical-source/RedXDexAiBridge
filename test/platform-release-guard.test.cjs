'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {checkPlatformReadiness}=require('../scripts/check-platform-readiness.cjs');
const legal=require('../app/legal-content.cjs');
const {CHECKS,DETAILS,contentHash}=require('../services/bridge-platform/readiness.cjs');
const reviewed={version:legal.version,status:'approved',requiresReview:false,documents:['terms','privacy','agreement'].map(id=>({id,content:'Reviewed fixture '+id})),businessDetails:Object.fromEntries(DETAILS.map(key=>[key,'Reviewed fixture detail']))};reviewed.review={approved:true,businessDetailsReviewed:true,version:reviewed.version,reviewedAtMs:1,contentSha256:contentHash(reviewed)};
const ready={ready:true,app:'bridge',issuer:'https://red-xai.com',billingMode:'live',legalVersion:legal.version,checks:Object.fromEntries(CHECKS.map(key=>[key,true]))};
const request=value=>async()=>({ok:true,json:async()=>value});
test('preview cannot publish a stable release even if the remote service claims readiness',async()=>{
 let contacted=false;await assert.rejects(checkPlatformReadiness({local:{required:false},request:async()=>{contacted=true;return{ok:true,json:async()=>ready};}}),/preview/);assert.equal(contacted,false);
});
test('stable release requires every current production capability and rejects sandbox billing',async()=>{
 assert.equal((await checkPlatformReadiness({local:{required:true},documents:reviewed,request:request(ready)})).ready,true);
 for(const key of Object.keys(ready.checks))await assert.rejects(checkPlatformReadiness({local:{required:true},documents:reviewed,request:request({...ready,checks:{...ready.checks,[key]:false}})}),/incomplete/);
 for(const override of [{billingMode:'sandbox'},{legalVersion:'old'},{issuer:'https://example.com'},{app:'vortex'},{ready:false}])await assert.rejects(checkPlatformReadiness({local:{required:true},documents:reviewed,request:request({...ready,...override})}),/incomplete/);
 await assert.rejects(checkPlatformReadiness({local:{required:true},documents:reviewed,request:async()=>({ok:false,status:404})}),/unavailable/);
});
test('unreviewed current draft or changed business text blocks release before contacting production',async()=>{for(const documents of [legal,{...reviewed,requiresReview:true},{...reviewed,review:{...reviewed.review,businessDetailsReviewed:false}},{...reviewed,businessDetails:{...reviewed.businessDetails,retentionPeriods:''}}]){let contacted=false;await assert.rejects(checkPlatformReadiness({local:{required:true},documents,request:async()=>{contacted=true;return{ok:true,json:async()=>ready};}}),/reviewed and approved/);assert.equal(contacted,false);}});
