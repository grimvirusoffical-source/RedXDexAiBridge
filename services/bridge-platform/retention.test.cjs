'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {empty}=require('./store.cjs');
const {PROPOSED_POLICY,planRetention,applyRetentionPlan,summarizePlan,policyHash,auditChainValid}=require('./retention.cjs');
const NOW=Date.UTC(2026,10,2,12),DAY=86400000;
function fixture(){
 const state=empty();state.revision=4;
 state.members.person={sub:'person',ipHashes:['historical-ip-hash'],recoveries:[{atMs:Date.UTC(2025,8,1),pluginId:'old'},{atMs:Date.UTC(2025,9,2,12),pluginId:'boundary'},{atMs:NOW-365*DAY,pluginId:'within-year'},{atMs:NOW,pluginId:'recent'},{pluginId:'missing-time'}],devices:{keep:{publicKey:'device-key'}},legal:{keep:{version:'v1'}},grants:{paid:{paymentRef:'cs_paid'}},subscriptions:[{tier:'gold',untilMs:NOW+DAY}],creditLots:[{source:'cs_paid',totalCents:1000}],creditsCents:1000};
 state.nonces={old:{kind:'legal',sub:'person',untilMs:NOW},current:{kind:'enroll',sub:'person',untilMs:NOW+1},request:{kind:'request',untilMs:NOW-1},requestBoundary:{kind:'request',untilMs:NOW},futureKind:{kind:'future',untilMs:NOW-1},malformed:{kind:'legal',untilMs:'yesterday'}};
 state.sessions={old:{sub:'person',leaseUntilMs:NOW-1,reservedMs:15000},boundary:{sub:'person',leaseUntilMs:NOW},current:{sub:'person',leaseUntilMs:NOW+1}};
 state.orders={paid:{sub:'person',fulfilled:true,createdMs:1,amountCents:1000},unpaid:{fulfilled:false,expiresMs:1}};state.payments={evt:{checkoutSessionId:'cs_paid',atMs:1}};state.billing={webhookReceipts:{evt:{verified:true}}};state.bans=[{sub:'person',untilMs:null,ipHashes:['historical-ip-hash']}];
 const event={id:'audit-old',atMs:1,actor:'staff',action:'payment.fulfilled',target:'person',detail:{amountCents:1000},previous:''};event.hash=crypto.createHash('sha256').update(JSON.stringify(event)).digest('hex');state.audit.push(event);
 return state;
}
const approved=()=>({...PROPOSED_POLICY,status:'approved',requiresReview:false});
function execute(state,{now=NOW,policy=approved(),holds=[]}={}){const plan=planRetention(state,{now,policy,holds});return applyRetentionPlan(state,plan,{now,policy,holds,approval:{approved:true,version:policy.version,policySha256:policyHash(policy),reviewedAtMs:NOW-1}});}
test('dry-run is nonmutating, retains one-year recovery limit and exposes unresolved categories without identifiers',()=>{
 const state=fixture(),before=structuredClone(state),plan=planRetention(state,{now:NOW});assert.deepEqual(state,before);assert.equal(plan.executionBlocked,true);assert.deepEqual(plan.counts,{expiredNonces:2,expiredWorkLeases:1,expiredRecoveryEvents:1});assert.equal(plan.blocked.invalidTimestamps,2);assert.equal(plan.blocked.ipAssociationMetadata,1);
 const summary=JSON.stringify(summarizePlan(plan));assert.ok(!summary.includes('historical-ip-hash'));assert.ok(!summary.includes('person'));assert.ok(!summary.includes('cs_paid'));
 assert.throws(()=>applyRetentionPlan(state,plan,{now:NOW}),/Reviewed retention policy/);
});
test('reviewed cleanup preserves all finance, entitlements, quotas, bans and old audit entries',()=>{
 const state=fixture(),before=structuredClone(state);state.members.person.usage={weekStartMs:NOW-1000,activeMs:15000,crawlerPages:250};const result=execute(state),next=result.state;
 assert.equal(result.changed,true);assert.equal(next.revision,state.revision+1);assert.equal(next.nonces.old,undefined);assert.equal(next.nonces.request,undefined);assert.ok(next.nonces.current);assert.ok(next.nonces.requestBoundary);assert.ok(next.nonces.futureKind);assert.ok(next.nonces.malformed);assert.equal(next.sessions.old,undefined);assert.ok(next.sessions.boundary);assert.ok(next.sessions.current);
 assert.deepEqual(next.members.person.recoveries.map(v=>v.pluginId),['boundary','within-year','recent','missing-time']);
 for(const key of ['orders','payments','billing','bans'])assert.deepEqual(next[key],state[key]);for(const key of ['devices','legal','grants','subscriptions','creditLots','creditsCents','usage','ipHashes'])assert.deepEqual(next.members.person[key],state.members.person[key]);
 assert.deepEqual(next.audit.slice(0,-1),state.audit);assert.equal(next.audit.at(-1).action,'retention.applied');assert.equal(auditChainValid(next.audit),true);assert.deepEqual(before.audit,state.audit);
});
test('legal holds preserve matching and unidentifiable records; changed holds invalidate a reviewed plan',()=>{
 const state=fixture(),holds=[{id:'reviewed-hold',sub:'person',untilMs:null}],policy=approved(),plan=planRetention(state,{now:NOW,policy,holds});assert.equal(plan.operations.length,0);assert.equal(plan.blocked.heldRecords,4);
 assert.equal(execute(state,{holds}).changed,false);
 assert.equal(planRetention(state,{now:NOW,policy,holds:[{id:'expired',sub:'person',untilMs:NOW}]}).operations.length,4);
 assert.equal(planRetention(state,{now:NOW,policy,holds:[{id:'global',sub:null,untilMs:null}]}).operations.length,0);
 assert.throws(()=>applyRetentionPlan(state,plan,{now:NOW,policy,holds:[],approval:{approved:true,version:policy.version,policySha256:policyHash(policy),reviewedAtMs:NOW-1}}),/plan changed/);
});
test('active subject holds conservatively preserve expired records with malformed or absent subjects',()=>{
 const state=empty(),subjects=[undefined,null,'',' ',{},12,'control\u0000subject','x'.repeat(201),'constructor'];
 subjects.forEach((sub,index)=>{state.nonces['nonce_'+index]={kind:'legal',sub,untilMs:NOW-1};state.sessions['lease_'+index]={sub,leaseUntilMs:NOW-1};});
 state.nonces.other={kind:'legal',sub:'other-person',untilMs:NOW-1};state.sessions.other={sub:'other-person',leaseUntilMs:NOW-1};
 const holds=[{id:'reviewed-hold',sub:'person',untilMs:null}],policy=approved(),plan=planRetention(state,{now:NOW,policy,holds});
 assert.deepEqual(plan.counts,{expiredNonces:1,expiredWorkLeases:1,expiredRecoveryEvents:0});assert.equal(plan.blocked.heldRecords,subjects.length*2);
 const next=execute(state,{policy,holds}).state;assert.equal(next.nonces.other,undefined);assert.equal(next.sessions.other,undefined);
 subjects.forEach((_sub,index)=>{assert.deepEqual(next.nonces['nonce_'+index],state.nonces['nonce_'+index]);assert.deepEqual(next.sessions['lease_'+index],state.sessions['lease_'+index]);});
 const withoutHolds=planRetention(state,{now:NOW,policy});assert.equal(withoutHolds.counts.expiredNonces,subjects.length+1);assert.equal(withoutHolds.counts.expiredWorkLeases,subjects.length+1);
});
test('stale, tampered, future, expired and incorrectly approved plans cannot delete anything',()=>{
 const state=fixture(),policy=approved(),plan=planRetention(state,{now:NOW,policy}),options={now:NOW,policy,approval:{approved:true,version:policy.version,policySha256:policyHash(policy),reviewedAtMs:NOW-1}};
 const changed=structuredClone(state);changed.members.person.creditsCents++;assert.throws(()=>applyRetentionPlan(changed,plan,options),/source changed/);
 const revision=structuredClone(state);revision.revision++;assert.throws(()=>applyRetentionPlan(revision,plan,options),/source changed/);
 const tampered=structuredClone(plan);tampered.operations.push({kind:'deleteFinance',key:'orders'});assert.throws(()=>applyRetentionPlan(state,tampered,options),/plan changed/);
 assert.throws(()=>applyRetentionPlan(state,plan,{...options,now:NOW-1}),/expired or invalid/);assert.throws(()=>applyRetentionPlan(state,plan,{...options,now:NOW+600001}),/expired or invalid/);
 for(const approval of [{...options.approval,approved:false},{...options.approval,policySha256:'wrong'},{...options.approval,version:'old'},{...options.approval,reviewedAtMs:NOW+1}])assert.throws(()=>applyRetentionPlan(state,plan,{...options,approval}),/Reviewed retention policy/);
 assert.throws(()=>applyRetentionPlan(state,plan,{...options,policy:{...policy,recoveryMonths:14}}),/Reviewed retention policy/);
 const invalid=fixture();invalid.audit[0].detail.amountCents=1;const invalidPlan=planRetention(invalid,{now:NOW,policy});assert.throws(()=>applyRetentionPlan(invalid,invalidPlan,options),/Invalid audit chain/);
});
test('cleanup has a bounded no-op result and calendar-month cutoff at month end',()=>{
 const state=empty(),result=execute(state);assert.equal(result.changed,false);assert.equal(result.state.revision,state.revision);assert.deepEqual(result.state.audit,[]);
 const plan=planRetention(state,{now:Date.UTC(2026,2,31,12)});assert.equal(plan.recoveryCutoffMs,Date.UTC(2025,1,28,12));
 for(const now of [NaN,-1,'today'])assert.throws(()=>planRetention(state,{now}),/Invalid retention time/);
 assert.throws(()=>planRetention(state,{now:NOW,policy:{...PROPOSED_POLICY,recoveryMonths:12}}),/Invalid retention policy/);
});
test('cleanup preserves the replay marker until an actual signed request falls outside its clock window',async()=>{
 const {MemoryStore}=require('./store.cjs'),{createPlatform}=require('./index.cjs'),keys=crypto.generateKeyPairSync('ed25519');
 const publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString(),deviceId=crypto.createHash('sha256').update(publicKey).digest('hex'),nonce='signed-replay-boundary-123456',key=crypto.createHash('sha256').update(deviceId+':'+nonce).digest('hex');
 const request={method:'POST',path:'/redxai-bridge/api/me',bodyHash:crypto.createHash('sha256').update('{}').digest('hex'),deviceId,timeMs:NOW-120000,nonce};
 request.signature=crypto.sign(null,Buffer.from([request.method,request.path,request.bodyHash,String(request.timeMs),nonce].join('\n')),keys.privateKey).toString('base64url');
 const state=fixture();state.members.person.devices={[deviceId]:{publicKey,createdMs:NOW-150000,revoked:false}};state.nonces[key]={kind:'request',untilMs:NOW};
 const retained=execute(state).state;assert.ok(retained.nonces[key]);const store=new MemoryStore();store.value=retained;let clock=NOW;
 const api=createPlatform({store,ipHashKey:'x'.repeat(32),now:()=>clock});
 await assert.rejects(api.verifyDeviceProof({verified:true,sub:'person'},request),error=>error.code==='device_proof_replayed');
 clock++;await assert.rejects(api.verifyDeviceProof({verified:true,sub:'person'},request),error=>error.code==='invalid_amount');
 const after=execute(retained,{now:clock}).state;assert.equal(after.nonces[key],undefined);
});
