'use strict';
const crypto=require('node:crypto');
const TEN_MINUTES=600000;
// Planning is available while the business policy is a draft. Execution is not.
const PROPOSED_POLICY=Object.freeze({version:'bridge-retention-proposal-2026-11-v1',status:'draft',requiresReview:true,recoveryMonths:13});
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const time=v=>Number.isSafeInteger(v)&&v>=0&&v<=8640000000000000;
function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(plain(value))return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
 return value;
}
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function validatePolicy(policy){if(!plain(policy)||typeof policy.version!=='string'||!/^[-A-Za-z0-9_.]{1,100}$/.test(policy.version)||!['draft','approved','published'].includes(policy.status)||typeof policy.requiresReview!=='boolean'||!Number.isSafeInteger(policy.recoveryMonths)||policy.recoveryMonths<13||policy.recoveryMonths>120)throw Error('Invalid retention policy');}
function validateState(state){if(!plain(state)||state.schema!==1||!Number.isSafeInteger(state.revision)||state.revision<0||state.revision>=Number.MAX_SAFE_INTEGER||!plain(state.members)||!plain(state.sessions)||!plain(state.nonces)||!Array.isArray(state.audit))throw Error('Invalid platform retention state');}
function monthsBefore(ms,months){const d=new Date(ms),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.getTime();}
function activeHolds(holds,now){
 if(!Array.isArray(holds))throw Error('Invalid retention holds');
 for(const hold of holds)if(!plain(hold)||typeof hold.id!=='string'||!hold.id||!(hold.sub===null||typeof hold.sub==='string'&&hold.sub.length>0)||!(hold.untilMs===null||time(hold.untilMs)))throw Error('Invalid retention hold');
 return holds.filter(hold=>hold.untilMs===null||hold.untilMs>now);
}
function auditChainValid(audit){if(!Array.isArray(audit))return false;let previous='';for(const entry of audit){if(!plain(entry)||entry.previous!==previous||typeof entry.hash!=='string')return false;const body={...entry};delete body.hash;if(crypto.createHash('sha256').update(previous+JSON.stringify(body)).digest('hex')!==entry.hash)return false;previous=entry.hash;}return true;}
function planRetention(state,{now=Date.now(),policy=PROPOSED_POLICY,holds=[]}={}){
 validateState(state);validatePolicy(policy);if(!time(now)||now>8640000000000000-TEN_MINUTES)throw Error('Invalid retention time');
 const active=activeHolds(holds,now),operations=[],blocked={heldRecords:0,invalidTimestamps:0,unknownNonceKinds:0,ipAssociationMetadata:0,deletedMemberMetadata:0};
 const identified=sub=>typeof sub==='string'&&sub.length>0&&sub.length<=200&&!/[\s\p{Cc}]/u.test(sub)&&!(sub in Object.prototype);
 const held=sub=>active.some(hold=>hold.sub===null||hold.sub===sub||!identified(sub));
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
 const recoveryCutoffMs=monthsBefore(now,policy.recoveryMonths);
 for(const [sub,member] of Object.entries(state.members)){
  if(!plain(member))throw Error('Invalid platform member');
  blocked.ipAssociationMetadata+=Array.isArray(member.ipHashes)?member.ipHashes.length:0;
  if(member.deleted===true&&!time(member.deletedAtMs))blocked.deletedMemberMetadata++;
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
 const counts={expiredNonces:0,expiredWorkLeases:0,expiredRecoveryEvents:0};
 for(const operation of operations)if(operation.kind==='expiredNonce')counts.expiredNonces++;else if(operation.kind==='expiredWorkLease')counts.expiredWorkLeases++;else counts.expiredRecoveryEvents+=operation.indexes.length;
 const plan={schema:1,plannedAtMs:now,validUntilMs:now+TEN_MINUTES,sourceRevision:state.revision,sourceSha256:digest(state),policySha256:digest(policy),holdsSha256:digest(holds),policyVersion:policy.version,recoveryCutoffMs,operations,counts,blocked,
  executionBlocked:policy.requiresReview||!['approved','published'].includes(policy.status),
  unresolved:['IP expiry needs per-association timestamps and ban history.','Audit expiry needs a verified archive/checkpoint and preserved financial audit.','Deleted-account cleanup needs an explicit data inventory and independently confirmed deletion scope.','Raw security logs, support tickets and backup copies are managed outside this scoped state.','Financial/provider records, balances, entitlements and dispute history are never purged by this planner.']};
 return{...plan,planSha256:digest(plan)};
}
function summarizePlan(plan){return{schema:plan.schema,policyVersion:plan.policyVersion,plannedAtMs:plan.plannedAtMs,validUntilMs:plan.validUntilMs,sourceRevision:plan.sourceRevision,planSha256:plan.planSha256,executionBlocked:plan.executionBlocked,counts:structuredClone(plan.counts),blocked:structuredClone(plan.blocked),unresolved:[...plan.unresolved]};}
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
  else {const indexes=new Set(operation.indexes);next.members[operation.sub].recoveries=next.members[operation.sub].recoveries.filter((_event,index)=>!indexes.has(index));}
 }
 if(!expected.operations.length)return{state:next,changed:false,summary:summarizePlan(expected)};
 const entry={id:'retention_'+expected.planSha256.slice(0,40),atMs:now,actor:'retention-job',action:'retention.applied',target:'bridge-platform',detail:{policyVersion:policy.version,policySha256:expected.policySha256,planSha256:expected.planSha256,counts:expected.counts},previous:next.audit.at(-1)?.hash||''};
 entry.hash=crypto.createHash('sha256').update(entry.previous+JSON.stringify(entry)).digest('hex');next.audit.push(entry);next.revision++;
 return{state:next,changed:true,summary:summarizePlan(expected)};
}
module.exports={PROPOSED_POLICY,planRetention,applyRetentionPlan,summarizePlan,policyHash:policy=>{validatePolicy(policy);return digest(policy);},auditChainValid};
