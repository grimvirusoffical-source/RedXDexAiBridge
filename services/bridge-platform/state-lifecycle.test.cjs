'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createPlatform}=require('./index.cjs'),{MemoryStore}=require('./store.cjs');
const {auditChainValid}=require('./retention.cjs');
const DAY=86400000;
test('new Bridge deletions reject legacy or incomplete receipts without local changes',async()=>{
 for(const change of [value=>{const next={...value};delete next.completed;return next;},value=>({...value,completed:false}),value=>{const next={...value};delete next.requestId;return next;},value=>({...value,requestId:'stale_operation'})]){
  const f=fixture({authority:{deleteBridgeMembership:async(actor,options)=>change(receipt('bridge',actor,options))}}),user=await onboard(f,f.actor('person')),before=await f.store.load();
  await assert.rejects(f.api.dispatch(user,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT'}),rejected('bridge_membership_deletion_unconfirmed'));assert.deepEqual(await f.store.load(),before);
 }
});
test('a first deletion receipt cannot delete a rejoined Bridge membership',async()=>{
 let firstReceipt;const operations=[],canonical={bridge:true},f=fixture({authority:{deleteBridgeMembership:async(actor,options)=>{operations.push({...options});if(!firstReceipt){canonical.bridge=false;firstReceipt=receipt('bridge',actor,options);}return structuredClone(firstReceipt);}}});
 const user=await onboard(f,f.actor('person')),firstGeneration=(await f.store.load()).members.person.membershipGeneration;
 await f.api.dispatch(user,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT'});assert.equal(canonical.bridge,false);
 canonical.bridge=true;await f.api.dispatch({...user,freshLoginVerified:true},'/account/join');const current=await onboard(f,f.actor('person')),before=await f.store.load();assert.notEqual(before.members.person.membershipGeneration,firstGeneration);
 await assert.rejects(f.api.dispatch(current,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT',requestId:firstReceipt.requestId}),rejected('bridge_membership_deletion_unconfirmed'));
 assert.equal(canonical.bridge,true);assert.notEqual(operations[1].requestId,firstReceipt.requestId);assert.deepEqual(await f.store.load(),before);
});
test('an in-flight confirmed deletion cannot clear a newer membership generation',async()=>{
 let calls=0,releaseFirst,entered;const began=new Promise(resolve=>{entered=resolve;});
 const f=fixture({authority:{deleteBridgeMembership:async(actor,options)=>{const result=receipt('bridge',actor,options);if(++calls===1){entered();return new Promise(resolve=>{releaseFirst=()=>resolve(result);});}return result;}}}),user=await onboard(f,f.actor('person'));
 const first=f.api.dispatch(user,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT'});await began;
 await f.api.dispatch(user,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT'});await f.api.dispatch({...user,freshLoginVerified:true},'/account/join');await onboard(f,f.actor('person'));const before=await f.store.load();
 releaseFirst();await assert.rejects(first,rejected('bridge_membership_changed'));assert.deepEqual(await f.store.load(),before);assert.equal(before.members.person.deleted,false);
});
async function paidSubscription(f,user){
 const order=await f.api.dispatch(user,'/checkout/quote',{kind:'subscription',tier:'gold'});
 await f.api.applyPayment({verified:true,paid:true,eventId:'evt_paid_subscription',checkoutSessionId:'cs_paid_subscription',orderId:order.id,sub:user.sub,deviceId:user.deviceId,amountCents:799,currency:'usd',subscriptionId:'sub_paid_fixture',periodEndMs:f.now()+DAY});return order;
}
test('unconfirmed cancellation cannot remove subscriptions or proceed to global account deletion',async()=>{
 const changes=[()=>undefined,()=>({ok:false}),value=>({...value,verified:false}),value=>({...value,completed:false}),value=>({...value,status:'active'}),value=>({...value,sub:'other-account'}),value=>({...value,subscriptionId:'sub_wrong'}),value=>({...value,requestId:'wrong_request'})];
 for(const operation of ['remove','delete'])for(const change of changes){
  let deleted=0;const f=fixture({authority:{cancelSubscription:async(actor,options)=>change(receipt('cancel',actor,options)),deleteAccount:async(actor,options)=>{deleted++;return receipt('delete',actor,options);}}}),user=await onboard(f,f.actor('person')),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));await paidSubscription(f,user);const before=await f.store.load();
  const request=operation==='remove'?f.api.dispatch(owner,'/admin/gift',{target:user.sub,kind:'subscription',remove:true}):f.api.dispatch(user,'/account/delete',{scope:'global',confirm:'DELETE RED-XAI ACCOUNT'});
  await assert.rejects(request,rejected('subscription_cancellation_unconfirmed'));assert.equal(deleted,0);assert.deepEqual(await f.store.load(),before);
 }
});
test('verified cancellation receipts permit removal and global deletion without deleting payment history',async()=>{
 for(const operation of ['remove','delete']){
  const canceled=[],f=fixture({authority:{cancelSubscription:async(actor,options)=>{canceled.push(options);return receipt('cancel',actor,options);},deleteAccount:async(actor,options)=>receipt('delete',actor,options)}}),user=await onboard(f,f.actor('person')),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));await paidSubscription(f,user);const before=await f.store.load();
  const result=operation==='remove'?await f.api.dispatch(owner,'/admin/gift',{target:user.sub,kind:'subscription',remove:true}):await f.api.dispatch(user,'/account/delete',{scope:'global',confirm:'DELETE RED-XAI ACCOUNT'});
  assert.equal(canceled.length,1);assert.equal(canceled[0].sub,user.sub);assert.equal(canceled[0].subscriptionId,'sub_paid_fixture');assert.match(canceled[0].requestId,/^[A-Za-z0-9_-]{3,128}$/);
  const after=await f.store.load();assert.deepEqual(after.members.person.subscriptions,[]);assert.deepEqual(after.payments,before.payments);assert.deepEqual(after.orders,before.orders);assert.equal(auditChainValid(after.audit),true);
  if(operation==='delete'){assert.equal(result.deleted,true);assert.equal(after.members.person.deleted,true);assert.equal(after.members.person.deletion.scope,'global');}else assert.equal(result.ok,true);
 }
});
test('a paid deletion password string cannot cancel billing before recent authoritative reauthentication',async()=>{
 let canceled=0,deleted=0;const f=fixture({authority:{cancelSubscription:async(actor,options)=>{canceled++;return receipt('cancel',actor,options);},deleteAccount:async(actor,options)=>{deleted++;return receipt('delete',actor,options);}}}),user=await onboard(f,f.actor('person'));await paidSubscription(f,user);f.tick(600001);const before=await f.store.load();
 await assert.rejects(f.api.dispatch(user,'/account/delete',{scope:'global',confirm:'DELETE RED-XAI ACCOUNT',password:'unverified-input'}),rejected('recent_reauthentication_required'));assert.equal(canceled,0);assert.equal(deleted,0);assert.deepEqual(await f.store.load(),before);
});
test('a concurrently added recurring plan is never cleared as though its cancellation was confirmed',async()=>{
 for(const operation of ['remove','delete']){
  let deleted=0,f;f=fixture({authority:{cancelSubscription:async(actor,options)=>{f.store.value.members.person.subscriptions.push({tier:'silver',untilMs:f.now()+DAY,source:'stripe',providerId:'sub_new_concurrent'});return receipt('cancel',actor,options);},deleteAccount:async(actor,options)=>{deleted++;return receipt('delete',actor,options);}}});
  const user=await onboard(f,f.actor('person')),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));await paidSubscription(f,user);
  const request=operation==='remove'?f.api.dispatch(owner,'/admin/gift',{target:user.sub,kind:'subscription',remove:true}):f.api.dispatch(user,'/account/delete',{scope:'global',confirm:'DELETE RED-XAI ACCOUNT'});
  await assert.rejects(request,rejected('subscription_changed_during_removal'));const state=await f.store.load();assert.equal(deleted,0);assert.equal(state.members.person.deleted,false);assert.equal(state.members.person.subscriptions.length,2);assert.equal(state.audit.some(entry=>entry.action==='subscription.removed'),false);
 }
});
test('confirmed Bridge deletion stores only scoped receipt metadata and preserves security associations and finance',async()=>{
 const f=fixture({authority:{deleteBridgeMembership:async(actor,options)=>({...options,verified:true,completed:true,sub:actor.sub,scope:'bridge',clientId:'bridge',appNumber:6,membershipRemoved:true,sessionsRevoked:true,unrelated:'must-not-persist'})}}),user=await onboard(f,f.actor('person'));
 const before=await f.store.load();await f.api.dispatch(user,'/account/delete',{scope:'bridge',confirm:'DELETE BRIDGE ACCOUNT'});const after=await f.store.load(),member=after.members.person;
 assert.equal(member.deletedAtMs,f.now());assert.equal(member.deletion.scope,'bridge');assert.equal(member.deletion.verification,'confirmed-authority-adapter');assert.equal(member.deletion.globalAccountDeleted,false);assert.equal(member.deletion.canonicalMembershipRemoved,true);assert.ok(!JSON.stringify(after).includes('must-not-persist'));
 for(const key of ['ipHashes','ipAssociations','grants','subscriptions','creditsCents','creditLots','recoveries','usage'])assert.deepEqual(member[key],before.members.person[key]);
 assert.equal(member.username,'');assert.equal(member.email,'');assert.deepEqual(member.devices,{});assert.deepEqual(member.legal,{});
 const rejoined=await f.api.dispatch({...user,freshLoginVerified:true},'/account/join');assert.equal(rejoined.accepted,false);assert.equal((await f.store.load()).members.person.deleted,false);
});
test('rolling-year recovery limit does not silently erase thirteen-month retention or hold evidence',async()=>{
 const f=fixture(),first=await onboard(f,f.actor('person',{recoveryVerified:true}));await f.api.dispatch(first,'/plugins/acquire',{pluginId:'workspace-snapshot'});
 const historical={atMs:f.now()-366*DAY,pluginId:'workspace-snapshot',oldDeviceId:'old_device',newDeviceId:first.deviceId};f.store.value.members.person.recoveries.push(historical);
 const replacement=await onboard(f,f.actor('person',{recoveryVerified:true}));await f.api.dispatch(replacement,'/plugins/recover',{pluginId:'workspace-snapshot',oldDeviceId:first.deviceId,newDeviceId:replacement.deviceId});
 const events=(await f.store.load()).members.person.recoveries;assert.equal(events.length,2);assert.deepEqual(events[0],historical);assert.equal(events[1].atMs,f.now());
});
test('provider fraud-warning queue is immutable in binding and never changes money or entitlements',async()=>{
 const f=fixture(),user=await onboard(f,f.actor('person')),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));
 const order=await f.api.dispatch(user,'/checkout/quote',{kind:'credits',amountCents:501});
 await f.api.applyPayment({verified:true,paid:true,eventId:'evt_paid_fixture',checkoutSessionId:'cs_paid_fixture',orderId:order.id,sub:user.sub,deviceId:user.deviceId,amountCents:501,currency:'usd'});
 const before=await f.store.load(),warning={verified:true,eventId:'evt_early_warning',warningId:'issfr_fixture',chargeId:'ch_fixture',paymentIntentId:'pi_fixture',orderIds:[order.id],actionable:true,createdAtMs:f.now(),rawProvider:{email:'must-not-store@example.invalid'}};
 assert.deepEqual(await f.api.recordFraudWarning(warning),{reviewRecorded:true,warningId:warning.warningId});const recorded=await f.store.load();
 for(const field of ['members','orders','payments','billing'])assert.deepEqual(recorded[field],before[field]);assert.ok(!JSON.stringify(recorded).includes('must-not-store'));
 f.tick(1000);assert.deepEqual(await f.api.recordFraudWarning(warning),{duplicate:true,warningId:warning.warningId});assert.deepEqual(await f.store.load(),recorded);
 await f.api.recordFraudWarning({...warning,actionable:false});const refreshed=await f.store.load();assert.equal(refreshed.fraudWarnings.issfr_fixture.actionable,false);assert.equal(refreshed.fraudWarnings.issfr_fixture.reviewStatus,'pending');assert.equal(refreshed.fraudWarnings.issfr_fixture.firstSeenMs,recorded.fraudWarnings.issfr_fixture.firstSeenMs);assert.equal(refreshed.fraudWarnings.issfr_fixture.lastSeenMs,f.now());assert.equal(refreshed.audit.length,recorded.audit.length+1);
 for(const changed of [{chargeId:'ch_other'},{paymentIntentId:'pi_other'},{createdAtMs:warning.createdAtMs-1}])await assert.rejects(f.api.recordFraudWarning({...warning,...changed}),rejected('fraud_warning_binding_changed'));
 const queue=await f.api.dispatch(owner,'/admin/fraud-warnings');assert.equal(queue.total,1);assert.equal(queue.warnings[0].actionable,false);assert.deepEqual(Object.keys(queue.warnings[0]).sort(),['actionable','chargeId','createdAtMs','firstSeenMs','lastSeenMs','orderIds','paymentIntentId','warningId'].sort());
 await assert.rejects(f.api.dispatch(user,'/admin/fraud-warnings'),rejected('owner_recent_mfa_required'));
 await assert.rejects(f.api.dispatch({...owner,deviceVerified:false},'/admin/fraud-warnings'),rejected('device_proof_required'));
 await assert.rejects(f.api.dispatch(owner,'/fraud-warning',{...warning}),rejected('not_found'));
 assert.equal(auditChainValid((await f.store.load()).audit),true);
});
test('fraud-warning provider proof, processing fence, existing-order binding and bounded queue fail closed',async()=>{
 const f=fixture(),user=await onboard(f,f.actor('person')),order=await f.api.dispatch(user,'/checkout/quote',{kind:'credits',amountCents:501});
 const warning={verified:true,eventId:'evt_warning_guard',warningId:'issfr_guard',chargeId:'ch_guard',paymentIntentId:'pi_guard',orderIds:[order.id],actionable:true,createdAtMs:f.now()};
 for(const invalid of [{verified:false},{actionable:'true'},{warningId:'not_provider_warning'},{orderIds:[]},{orderIds:Array(101).fill(order.id)},{createdAtMs:f.now()+30001}]){const before=await f.store.load();await assert.rejects(f.api.recordFraudWarning({...warning,...invalid}));assert.deepEqual(await f.store.load(),before);}
 await assert.rejects(f.api.recordFraudWarning(warning),rejected('fraud_warning_order_unavailable'));
 await f.api.applyPayment({verified:true,paid:true,eventId:'evt_guard_paid',checkoutSessionId:'cs_guard_paid',orderId:order.id,sub:user.sub,deviceId:user.deviceId,amountCents:501,currency:'usd'});
 f.store.value.billing={processing:{token:'current_fence',untilMs:f.now()+1000}};
 await assert.rejects(f.api.recordFraudWarning({...warning,billingFence:'stale_fence'}),rejected('payment_processing_fence_expired'));
 await f.api.recordFraudWarning({...warning,billingFence:'current_fence'});
 for(let index=1;index<1000;index++)f.store.value.fraudWarnings['issfr_'+index]={...f.store.value.fraudWarnings.issfr_guard,warningId:'issfr_'+index};
 const full=await f.store.load();await assert.rejects(f.api.recordFraudWarning({...warning,warningId:'issfr_overflow',billingFence:'current_fence'}),rejected('fraud_warning_review_queue_full'));assert.deepEqual(await f.store.load(),full);
});
test('owner fraud review is paginated and requires current MFA and legal acceptance',async()=>{
 const f=fixture(),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));
 f.store.value.fraudWarnings=Object.fromEntries(Array.from({length:12},(_,index)=>['issfr_'+index,{warningId:'issfr_'+index,chargeId:'ch_fixture',paymentIntentId:'pi_fixture',orderIds:['order_fixture'],actionable:true,createdAtMs:f.now(),firstSeenMs:f.now()+index,lastSeenMs:f.now()+index,reviewStatus:'pending'}]));
 let queue=await f.api.dispatch(owner,'/admin/fraud-warnings');assert.equal(queue.warnings.length,10);assert.equal(queue.total,12);assert.equal(queue.totalPages,2);queue=await f.api.dispatch(owner,'/admin/fraud-warnings',{page:2});assert.equal(queue.page,2);assert.equal(queue.warnings.length,2);
 delete f.store.value.members.owner.legal[owner.deviceId];await assert.rejects(f.api.dispatch(owner,'/admin/fraud-warnings'),rejected('legal_acceptance_required'));
 f.tick(600001);await assert.rejects(f.api.dispatch(owner,'/admin/fraud-warnings'),rejected('owner_recent_mfa_required'));
});
const rejected=code=>error=>error.code===code;
function receipt(kind,actor,operation){
 if(kind==='bridge')return{...operation,verified:true,completed:true,sub:actor.sub,scope:'bridge',membershipRemoved:true,sessionsRevoked:true};
 if(kind==='cancel')return{...operation,verified:true,completed:true,ok:true,scope:'bridge',action:'cancel-subscription',status:'canceled'};
 if(kind==='reset')return{...operation,verified:true,completed:true,sub:actor.sub,action:'revoke',scope:'bridge',sessionsRevoked:true};
 if(kind==='delete')return{verified:true,completed:true,sub:actor.sub,action:'delete',scope:'global',requestId:operation.requestId,accountDeleted:true,sessionsRevoked:true};
 return{...operation,sub:operation.target,verified:true,completed:true,banned:operation.action==='ban',...(operation.action==='ban'?{sessionsRevoked:true}:{})};
}
function fixture({authority:overrides={},...options}={}){
 let clock=Date.UTC(2026,10,2,12);const store=new MemoryStore(),keys=crypto.generateKeyPairSync('ed25519');
 const authority={revokeBridgeSession:async(actor,operation)=>receipt('reset',actor,operation),...overrides};
 const api=createPlatform({store,authority,ownerSubjects:['owner'],licensePrivateKey:keys.privateKey,ipHashKey:'test-only-hash-key-with-at-least-32-characters',legalDocuments:['terms','privacy','agreement'].map(id=>({id,title:id,content:'Fixture document.'})),now:()=>clock,...options});
 const actor=(sub,extra={})=>({verified:true,sub,username:sub,email:sub+'@test.invalid',remoteIP:sub==='owner'?'192.0.2.1':'192.0.2.2',mfaUsed:true,reauthAtMs:clock,...extra});
 return{api,store,actor,now:()=>clock,tick:ms=>{clock+=ms;}};
}
async function onboard(f,actor){
 const keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString(),challenge=await f.api.dispatch(actor,'/device/challenge');
 const enrolled=await f.api.dispatch(actor,'/device/enroll',{nonce:challenge.nonce,publicKey,signature:crypto.sign(null,Buffer.from('bridge-enroll:'+challenge.nonce),keys.privateKey).toString('base64url'),label:'Fixture'});
 actor={...actor,deviceId:enrolled.deviceId,deviceVerified:true};const read=await f.api.dispatch(actor,'/legal/read',{version:f.api.legalVersion});await f.api.dispatch(actor,'/legal/accept',{grant:read.grant,read:true,agree:true});return actor;
}
test('false or unconfirmed authority results cannot mutate reset, deletion or global moderation state',async()=>{
 const changes=[()=>undefined,()=>null,()=>({ok:false}),value=>({...value,verified:false}),value=>({...value,completed:false}),value=>({...value,requestId:'wrong_request'}),value=>({...value,sub:'other-account'}),value=>({...value,sessionsRevoked:false})];
 for(const kind of ['reset','delete','moderate'])for(const change of changes){
  const adapter=async(actor,operation)=>change(receipt(kind,actor,operation));
  const f=fixture({authority:{revokeBridgeSession:adapter,deleteAccount:adapter,moderate:adapter}}),user=await onboard(f,f.actor('person')),owner=await onboard(f,f.actor('owner',{ownerVerified:true})),before=await f.store.load();
  const request=kind==='reset'?f.api.dispatch(user,'/account/reset'):kind==='delete'?f.api.dispatch(user,'/account/delete',{scope:'global',confirm:'DELETE RED-XAI ACCOUNT'}):f.api.dispatch(owner,'/admin/moderate',{target:user.sub,scope:'global',action:'ban',untilMs:null,reason:'Fixture'});
  await assert.rejects(request,rejected(kind==='reset'?'bridge_session_revocation_unconfirmed':kind==='delete'?'global_account_deletion_unconfirmed':'central_moderation_unconfirmed'));
  assert.deepEqual(await f.store.load(),before,kind+' must preserve local state');
 }
});
test('global moderation validates action and expiry locally and binds server-issued completion IDs',async()=>{
 const calls=[],f=fixture({authority:{moderate:async(actor,operation)=>{calls.push(operation);return receipt('moderate',actor,operation);}}}),owner=await onboard(f,f.actor('owner',{ownerVerified:true}));await f.api.dispatch(f.actor('person'),'/me');
 for(const body of [{action:'delete',untilMs:null},{action:'ban',untilMs:f.now()-1},{action:'unban',untilMs:42}]){
  const before=await f.store.load();await assert.rejects(f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'global',reason:'Fixture',...body}));assert.deepEqual(await f.store.load(),before);
 }
 assert.equal(calls.length,0);
 await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'global',action:'ban',untilMs:null,reason:'Fixture',requestId:'client_chosen_request'});
 assert.equal(calls.length,1);assert.notEqual(calls[0].requestId,'client_chosen_request');assert.equal((await f.store.load()).audit.at(-1).detail.requestId,calls[0].requestId);
 await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'global',action:'unban'});assert.equal(calls[1].untilMs,0);
});
test('timestamped IP observations never date unrelated legacy associations or store raw IPs',async()=>{
 const f=fixture(),actor=f.actor('person');await f.api.dispatch(actor,'/me');const first=await f.store.load(),hash=first.members.person.ipHashes[0];
 assert.deepEqual(first.members.person.ipAssociations[hash],{version:1,firstObservedMs:f.now(),lastSeenMs:f.now()});
 const legacy='f'.repeat(64);f.store.value.members.person.ipHashes.push(legacy);delete f.store.value.members.person.ipAssociations[hash];f.store.value.members.person.lastSeenMs=1;f.tick(1000);
 await f.api.dispatch(actor,'/me');const next=await f.store.load();assert.equal(next.members.person.ipAssociations[hash].firstObservedMs,f.now());assert.equal(next.members.person.ipAssociations[legacy],undefined);
 f.tick(1000);await f.api.dispatch(actor,'/me');const again=await f.store.load();assert.equal(again.members.person.ipAssociations[hash].firstObservedMs,f.now()-1000);assert.equal(again.members.person.ipAssociations[hash].lastSeenMs,f.now());assert.ok(!JSON.stringify(again).includes(actor.remoteIP));
});
test('ended and replaced bans retain history and permanent bans carry a human-review due date',async()=>{
 const f=fixture(),owner=f.actor('owner',{ownerVerified:true});await f.api.dispatch(owner,'/me');await f.api.dispatch(f.actor('person'),'/me');
 await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'bridge',action:'ban',untilMs:null,reason:'First'});let state=await f.store.load();assert.equal(state.bans[0].review.lastReviewedAtMs,f.now());assert.equal(state.bans[0].review.nextReviewAtMs,Date.UTC(2027,10,2,12));
 f.tick(1000);await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'bridge',action:'ban',untilMs:f.now()+1000,reason:'Replacement'});state=await f.store.load();assert.equal(state.banHistory[0].endReason,'replaced');assert.equal(state.banHistory[0].endedAtMs,f.now());
 f.tick(1000);await f.api.dispatch(owner,'/admin/users');state=await f.store.load();assert.equal(state.bans.length,0);assert.equal(state.banHistory[1].endReason,'expired');assert.equal(state.banHistory[1].endedAtMs,f.now());
 await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'bridge',action:'ban',untilMs:null,reason:'Third'});await f.api.dispatch(owner,'/admin/moderate',{target:'person',scope:'bridge',action:'unban'});state=await f.store.load();assert.equal(state.banHistory[2].endReason,'unbanned');assert.equal(auditChainValid(state.audit),true);
});
