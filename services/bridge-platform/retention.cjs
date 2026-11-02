'use strict';
const crypto=require('node:crypto');
const {plain,timestamp:time,ipDigest,shiftedMonths,confirmedBridgeDeletion}=require('./retention-metadata.cjs');
const TEN_MINUTES=600000,DAY=86400000;
// Planning is available while the business policy is a draft. Execution is not.
function policyFromDecisions(decisions){
 if(!plain(decisions)||decisions.status!=='approved-for-implementation'||!/^\d{4}-\d{2}-\d{2}$/.test(decisions.approvedDate||'')||!plain(decisions.retention))throw Error('Approved business-policy decisions required');
 const windows=decisions.retention;
 const policy={version:'bridge-retention-2026-11-v2',status:'draft',requiresReview:true,recoveryMonths:windows.recoveryMonths,ipAssociationDays:windows.hashedIpAssociationDays,endedBanDays:windows.endedBanDays,deletedBridgeProfileDays:windows.verifiedAccountDeletionDays,permanentBanReviewMonths:windows.permanentBanReviewMonths,businessDecision:{status:decisions.status,approvedDate:decisions.approvedDate,scope:'retention-windows-only'}};
 validatePolicy(policy);return policy;
}
const PROPOSED_POLICY=Object.freeze(policyFromDecisions(require('../../app/legal-content.cjs').policyDecisions));
const identified=sub=>typeof sub==='string'&&sub.length>0&&sub.length<=200&&!/[\s\p{Cc}]/u.test(sub)&&!(sub in Object.prototype);
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function validatePolicy(policy){
 if(!plain(policy)||typeof policy.version!=='string'||!/^[-A-Za-z0-9_.]{1,100}$/.test(policy.version)||!['draft','approved','published'].includes(policy.status)||typeof policy.requiresReview!=='boolean'||!Number.isSafeInteger(policy.recoveryMonths)||policy.recoveryMonths<13||policy.recoveryMonths>120)throw Error('Invalid retention policy');
 for(const [key,min,max]of [['ipAssociationDays',90,3650],['endedBanDays',90,3650],['deletedBridgeProfileDays',30,3650],['permanentBanReviewMonths',1,12]])if(policy[key]!==undefined&&(!Number.isSafeInteger(policy[key])||policy[key]<min||policy[key]>max))throw Error('Invalid retention policy');
}
function validateState(state){if(!plain(state)||state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||state.revision>=Number.MAX_SAFE_INTEGER||!plain(state.members)||!plain(state.sessions)||!plain(state.nonces)||!Array.isArray(state.audit)||!Array.isArray(state.bans)||(state.banHistory!==undefined&&!Array.isArray(state.banHistory)))throw Error('Invalid platform retention state');}
function relatedBan(ban,sub,ip){if(!plain(ban))return true;if(ban.sub===sub)return true;if(Array.isArray(ban.ipHashes))return ban.ipHashes.includes(ip);return ban.scope!=='bridge';}
function banProtectsIP(state,sub,ip,now,days){
 for(const ban of state.bans)if(relatedBan(ban,sub,ip)&&(!time(ban.untilMs)||ban.untilMs+days*DAY>=now))return true;
 for(const ban of state.banHistory||[])if(relatedBan(ban,sub,ip)&&(!time(ban.endedAtMs)||ban.endedAtMs+days*DAY>=now))return true;
 return false;
}
function financialHolds(state){
 const subjects=new Set();let unresolved=false;
 for(const key of ['orders','payments','disputes','fraudWarnings'])if(state[key]!==undefined&&!plain(state[key]))throw Error('Invalid financial retention binding');
 const bindOrder=orderId=>{const sub=state.orders?.[orderId]?.sub;if(identified(sub))subjects.add(sub);else unresolved=true;};
 for(const dispute of Object.values(state.disputes||{})){
  if(plain(dispute)&&['won','lost','warning_closed','prevented'].includes(dispute.status))continue;
  const payment=Object.values(state.payments||{}).find(value=>value.checkoutSessionId===dispute?.checkoutSessionId&&value.orderId);
  if(payment)bindOrder(payment.orderId);else unresolved=true;
 }
 for(const warning of Object.values(state.fraudWarnings||{})){
  if(!plain(warning)){unresolved=true;continue;}
  if(warning.reviewStatus==='reviewed')continue;
  if(!Array.isArray(warning.orderIds)||!warning.orderIds.length)unresolved=true;else warning.orderIds.forEach(bindOrder);
 }
 return{subjects,unresolved};
}
function activeHolds(holds,now){
 if(!Array.isArray(holds))throw Error('Invalid retention holds');
 for(const hold of holds)if(!plain(hold)||typeof hold.id!=='string'||!hold.id||!(hold.sub===null||typeof hold.sub==='string'&&hold.sub.length>0)||!(hold.untilMs===null||time(hold.untilMs)))throw Error('Invalid retention hold');
 return holds.filter(hold=>hold.untilMs===null||hold.untilMs>now);
}
function auditChainValid(audit){if(!Array.isArray(audit))return false;let previous='';for(const entry of audit){if(!plain(entry)||entry.previous!==previous||typeof entry.hash!=='string')return false;const body={...entry};delete body.hash;if(crypto.createHash('sha256').update(previous+JSON.stringify(body)).digest('hex')!==entry.hash)return false;previous=entry.hash;}return true;}
function planIPs(state,{now,policy,held,operations,blocked}){
 for(const [sub,member]of Object.entries(state.members)){
  const hashes=Array.isArray(member.ipHashes)?[...new Set(member.ipHashes)]:[];
  if(!Array.isArray(member.ipHashes))blocked.ipAssociationMetadata++;
  const metadata=plain(member.ipAssociations)?member.ipAssociations:{},remove=[];
  for(const hash of hashes){
   const entry=metadata[hash];
   if(!ipDigest(hash)||!plain(entry)||entry.version!==1||!time(entry.firstObservedMs)||!time(entry.lastSeenMs)||entry.firstObservedMs>entry.lastSeenMs||entry.lastSeenMs>now){blocked.ipAssociationMetadata++;continue;}
   if(policy.ipAssociationDays===undefined||entry.lastSeenMs>=now-policy.ipAssociationDays*DAY)continue;
   if(held(sub)){blocked.heldRecords++;continue;}
   if(banProtectsIP(state,sub,hash,now,policy.endedBanDays??90)){blocked.activeBanProtection++;continue;}
   remove.push(hash);
  }
  for(const hash of Object.keys(metadata))if(!hashes.includes(hash))blocked.ipAssociationMetadata++;
  if(remove.length)operations.push({kind:'expiredIpAssociations',sub,hashes:remove});
 }
}
function planDeletedProfiles(state,{now,policy,held,operations,blocked}){
 for(const [sub,member]of Object.entries(state.members)){
  if(member.deleted!==true)continue;
  if(!confirmedBridgeDeletion(member,sub,now)){blocked.deletedMemberMetadata++;continue;}
  if(policy.deletedBridgeProfileDays===undefined||member.deletedAtMs>=now-policy.deletedBridgeProfileDays*DAY)continue;
  const fields=[];let malformed=false;
  for(const key of ['username','email','devices','legal']){
   const value=member[key];if(value===undefined)continue;
   if(['username','email'].includes(key)){if(typeof value!=='string')malformed=true;else if(value.length)fields.push(key);}
   else if(!plain(value))malformed=true;else if(Object.keys(value).length)fields.push(key);
  }
  if(malformed){blocked.deletedMemberMetadata++;continue;}
  if(!fields.length)continue;
  if(held(sub)||Object.values(state.sessions).some(session=>session.sub===sub&&(!time(session.leaseUntilMs)||session.leaseUntilMs>=now))){blocked.heldRecords++;continue;}
  operations.push({kind:'deletedBridgeProfile',sub,fields});
 }
}
function planBanHistory(state,{now,policy,active,held,operations,blocked}){
 const expired=[],reviews=[];
 for(const [index,ban]of (state.banHistory||[]).entries()){
  if(!plain(ban)||ban.archiveVersion!==1||!identified(ban.sub)||typeof ban.id!=='string'||!ban.id||!['bridge','ip'].includes(ban.scope)||!['expired','replaced','unbanned'].includes(ban.endReason)||!time(ban.endedAtMs)||!time(ban.archiveRecordedAtMs)||ban.endedAtMs>ban.archiveRecordedAtMs||ban.archiveRecordedAtMs>now||!Array.isArray(ban.ipHashes)||ban.ipHashes.some(hash=>!ipDigest(hash))){blocked.banHistoryMetadata++;continue;}
  if(policy.endedBanDays===undefined||ban.endedAtMs>=now-policy.endedBanDays*DAY)continue;
  const sharedHold=active.some(hold=>hold.sub===null)||Object.entries(state.members).some(([sub,member])=>held(sub)&&Array.isArray(member.ipHashes)&&member.ipHashes.some(hash=>ban.ipHashes.includes(hash)));
  if(held(ban.sub)||sharedHold){blocked.heldRecords++;continue;}
  expired.push(index);
 }
 if(expired.length)operations.push({kind:'expiredBanHistory',indexes:expired});
 for(const ban of state.bans){
  if(!plain(ban)||ban.untilMs!==null||policy.permanentBanReviewMonths===undefined)continue;
  const review=ban.review;
  const valid=plain(review)&&time(review.lastReviewedAtMs)&&review.lastReviewedAtMs<=now&&time(review.nextReviewAtMs)&&review.nextReviewAtMs>review.lastReviewedAtMs&&review.nextReviewAtMs<=shiftedMonths(review.lastReviewedAtMs,policy.permanentBanReviewMonths);
  if(!valid){blocked.banReviewMetadata++;reviews.push({id:ban.id,sub:ban.sub,scope:ban.scope,dueAtMs:null,needsMetadata:true});}
  else if(review.nextReviewAtMs<=now)reviews.push({id:ban.id,sub:ban.sub,scope:ban.scope,dueAtMs:review.nextReviewAtMs,needsMetadata:false});
 }
 return reviews;
}
function planRetention(state,{now=Date.now(),policy=PROPOSED_POLICY,holds=[]}={}){
 validateState(state);validatePolicy(policy);if(!time(now)||now>8640000000000000-TEN_MINUTES)throw Error('Invalid retention time');
 const active=activeHolds(holds,now),financial=financialHolds(state),operations=[],blocked={heldRecords:0,invalidTimestamps:0,unknownNonceKinds:0,ipAssociationMetadata:0,deletedMemberMetadata:0,activeBanProtection:0,banHistoryMetadata:0,banReviewMetadata:0};
 const held=sub=>financial.unresolved||financial.subjects.has(sub)||(!identified(sub)&&(active.length>0||financial.subjects.size>0))||active.some(hold=>hold.sub===null||hold.sub===sub);
 for(const [key,nonce] of Object.entries(state.nonces)){
  if(!plain(nonce)||!['enroll','legal','request'].includes(nonce.kind)){blocked.unknownNonceKinds++;continue;}
  if(!time(nonce.untilMs)){blocked.invalidTimestamps++;continue;}
  // Future clock skew can make a request signature valid at exact expiry.
  if(nonce.untilMs>now||(nonce.kind==='request'&&nonce.untilMs===now))continue;
  if(held(nonce.sub)){blocked.heldRecords++;continue;}
  operations.push({kind:'expiredNonce',key});
 }
 for(const [key,session] of Object.entries(state.sessions)){
  if(!plain(session)||!time(session.leaseUntilMs)){blocked.invalidTimestamps++;continue;}
  // A lease is still accepted by meter.cjs at exact equality.
  if(session.leaseUntilMs>=now)continue;
  if(held(session.sub)){blocked.heldRecords++;continue;}
  operations.push({kind:'expiredWorkLease',key});
 }
 const recoveryCutoffMs=shiftedMonths(now,-policy.recoveryMonths);
 for(const [sub,member] of Object.entries(state.members)){
  if(!plain(member))throw Error('Invalid platform member');
  if(member.recoveries!==undefined&&!Array.isArray(member.recoveries))throw Error('Invalid recovery history');
  const remove=[];
  for(const [index,event] of (member.recoveries||[]).entries()){
   if(!plain(event)||!time(event.atMs)){blocked.invalidTimestamps++;continue;}
   if(event.atMs>=recoveryCutoffMs)continue;
   if(held(sub)){blocked.heldRecords++;continue;}
   remove.push(index);
  }
  if(remove.length)operations.push({kind:'expiredRecoveryEvents',sub,indexes:remove});
 }
 const context={now,policy,active,held,operations,blocked};planIPs(state,context);planDeletedProfiles(state,context);const permanentBanReviews=planBanHistory(state,context);
 const counts={expiredNonces:0,expiredWorkLeases:0,expiredRecoveryEvents:0,expiredIpAssociations:0,expiredBanHistory:0,deletedBridgeProfiles:0};
 for(const operation of operations){if(operation.kind==='expiredNonce')counts.expiredNonces++;else if(operation.kind==='expiredWorkLease')counts.expiredWorkLeases++;else if(operation.kind==='expiredRecoveryEvents')counts.expiredRecoveryEvents+=operation.indexes.length;else if(operation.kind==='expiredIpAssociations')counts.expiredIpAssociations+=operation.hashes.length;else if(operation.kind==='expiredBanHistory')counts.expiredBanHistory+=operation.indexes.length;else if(operation.kind==='deletedBridgeProfile')counts.deletedBridgeProfiles++;}
 const plan={schema:1,plannedAtMs:now,validUntilMs:now+TEN_MINUTES,sourceRevision:state.revision,sourceSha256:digest(state),policySha256:digest(policy),holdsSha256:digest(holds),policyVersion:policy.version,recoveryCutoffMs,operations,counts,blocked,permanentBanReviews,
  executionBlocked:policy.requiresReview||!['approved','published'].includes(policy.status),
  unresolved:['Untimestamped legacy IP associations and unknown ban/deletion metadata remain retained for review.','Permanent bans require a human review; a due date does not automatically lift a ban.','Audit expiry needs a verified archive/checkpoint and preserved financial audit.','Only independently confirmed Bridge-only deletion permits allowlisted local profile cleanup; global deletion remains unverified.','Raw security logs, support tickets and backup copies are managed outside this scoped state.','Financial/provider records, balances, entitlements and dispute history are never purged by this planner.']};
 return{...plan,planSha256:digest(plan)};
}
function summarizePlan(plan){return{schema:plan.schema,policyVersion:plan.policyVersion,plannedAtMs:plan.plannedAtMs,validUntilMs:plan.validUntilMs,sourceRevision:plan.sourceRevision,planSha256:plan.planSha256,executionBlocked:plan.executionBlocked,counts:structuredClone(plan.counts),blocked:structuredClone(plan.blocked),permanentBansDueReview:plan.permanentBanReviews.length,unresolved:[...plan.unresolved]};}
function applyRetentionPlan(state,plan,{now=Date.now(),policy=PROPOSED_POLICY,holds=[],approval}={}){
 validateState(state);validatePolicy(policy);
 if(!time(now)||!plain(plan)||!time(plan.plannedAtMs)||now<plan.plannedAtMs||now>plan.validUntilMs)throw Error('Retention plan expired or invalid');
 if(policy.requiresReview||!['approved','published'].includes(policy.status)||approval?.approved!==true||approval.policySha256!==digest(policy)||approval.version!==policy.version||!time(approval.reviewedAtMs)||approval.reviewedAtMs>now)throw Error('Reviewed retention policy required');
 if(state.revision!==plan.sourceRevision||digest(state)!==plan.sourceSha256)throw Error('Retention source changed; plan again');
 const expected=planRetention(state,{now:plan.plannedAtMs,policy,holds});
 if(digest(expected)!==digest(plan))throw Error('Retention plan changed; plan again');
 if(!auditChainValid(state.audit))throw Error('Invalid audit chain; no retention applied');
 const next=structuredClone(state);
 for(const operation of expected.operations){
  if(operation.kind==='expiredNonce')delete next.nonces[operation.key];
  else if(operation.kind==='expiredWorkLease')delete next.sessions[operation.key];
  else if(operation.kind==='expiredRecoveryEvents'){const indexes=new Set(operation.indexes);next.members[operation.sub].recoveries=next.members[operation.sub].recoveries.filter((_event,index)=>!indexes.has(index));}
  else if(operation.kind==='expiredIpAssociations'){const member=next.members[operation.sub],hashes=new Set(operation.hashes);member.ipHashes=member.ipHashes.filter(hash=>!hashes.has(hash));for(const hash of hashes)delete member.ipAssociations[hash];}
  else if(operation.kind==='expiredBanHistory'){const indexes=new Set(operation.indexes);next.banHistory=next.banHistory.filter((_ban,index)=>!indexes.has(index));}
  else if(operation.kind==='deletedBridgeProfile'){const member=next.members[operation.sub];for(const field of operation.fields)member[field]=['username','email'].includes(field)?'':{};member.deletion.profilePurgedAtMs=now;}
  else throw Error('Unsupported retention operation');
 }
 if(!expected.operations.length)return{state:next,changed:false,summary:summarizePlan(expected)};
 const entry={id:'retention_'+expected.planSha256.slice(0,40),atMs:now,actor:'retention-job',action:'retention.applied',target:'bridge-platform',detail:{policyVersion:policy.version,policySha256:expected.policySha256,planSha256:expected.planSha256,counts:expected.counts},previous:next.audit.at(-1)?.hash||''};
 entry.hash=crypto.createHash('sha256').update(entry.previous+JSON.stringify(entry)).digest('hex');next.audit.push(entry);next.revision++;
 return{state:next,changed:true,summary:summarizePlan(expected)};
}
module.exports={PROPOSED_POLICY,policyFromDecisions,planRetention,applyRetentionPlan,summarizePlan,policyHash:policy=>{validatePolicy(policy);return digest(policy);},auditChainValid};
