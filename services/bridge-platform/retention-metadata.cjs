'use strict';
// Scoped platform metadata only. Nothing here calls an account authority or
// removes financial records. Existing schema-1 documents remain readable.
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const timestamp=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const ipDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function shiftedMonths(ms,months){
 const date=new Date(ms),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+months);
 const last=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,last));return date.getTime();
}
function observeHashedIP(member,hash,now){
 if(!ipDigest(hash)||!timestamp(now)||!Array.isArray(member.ipHashes))throw Error('Invalid hashed-IP observation');
 if(!member.ipHashes.includes(hash))member.ipHashes.push(hash);
 if(member.ipAssociations===undefined)member.ipAssociations={};
 if(!plain(member.ipAssociations))throw Error('Invalid hashed-IP metadata');
 const prior=member.ipAssociations[hash];
 // A legacy string gets a date only after this actual authenticated observation.
 // Never infer an IP's earlier history from the account's lastSeenMs.
 if(prior===undefined)member.ipAssociations[hash]={version:1,firstObservedMs:now,lastSeenMs:now};
 else if(plain(prior)&&prior.version===1&&timestamp(prior.firstObservedMs)&&timestamp(prior.lastSeenMs)&&prior.firstObservedMs<=prior.lastSeenMs)prior.lastSeenMs=Math.max(prior.lastSeenMs,now);
 // Unknown or malformed existing metadata stays available for operator review.
}
function archiveBan(state,ban,{endedAtMs,recordedAtMs,reason,actor=null}){
 if(!timestamp(endedAtMs)||!timestamp(recordedAtMs)||endedAtMs>recordedAtMs)throw Error('Invalid ended-ban time');
 if(state.banHistory===undefined)state.banHistory=[];
 if(!Array.isArray(state.banHistory))throw Error('Invalid ended-ban history');
 state.banHistory.push({...structuredClone(ban),archiveVersion:1,endedAtMs,archiveRecordedAtMs:recordedAtMs,endReason:reason,endedBy:actor});
}
function archiveExpiredBans(state,now){
 if(!Array.isArray(state.bans)||!timestamp(now))throw Error('Invalid ban state');
 let count=0;
 state.bans=state.bans.filter(ban=>{
  if(!plain(ban)||!timestamp(ban.untilMs)||ban.untilMs>now)return true;
  archiveBan(state,ban,{endedAtMs:ban.untilMs,recordedAtMs:now,reason:'expired'});count++;return false;
 });
 return count;
}
function endMatchingBans(state,sub,scope,{now,reason,actor}){
 if(!['unbanned','replaced'].includes(reason))throw Error('Invalid ended-ban reason');
 let count=0;
 state.bans=state.bans.filter(ban=>{
  if(ban.sub!==sub||ban.scope!==scope)return true;
  archiveBan(state,ban,{endedAtMs:now,recordedAtMs:now,reason,actor});count++;return false;
 });
 return count;
}
function initialPermanentReview(now,actor){return{lastReviewedAtMs:now,reviewedBy:actor,nextReviewAtMs:shiftedMonths(now,12)};}
function bridgeDeletionReceiptConfirmed(receipt,sub,requestId){
 try{
  if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(requestId)||requestId in Object.prototype)return false;
  if(!plain(receipt)||![Object.prototype,null].includes(Object.getPrototypeOf(receipt)))return false;
  for(const [key,value]of Object.entries({verified:true,completed:true,requestId,sub,scope:'bridge',clientId:'bridge',appNumber:6,membershipRemoved:true,sessionsRevoked:true})){
   const field=Object.getOwnPropertyDescriptor(receipt,key);if(!field||!Object.hasOwn(field,'value')||field.value!==value)return false;
  }
  for(const [key,value]of [['ok',true],['success',true],['globalAccountDeleted',false]]){const field=Object.getOwnPropertyDescriptor(receipt,key);if(field&&(!Object.hasOwn(field,'value')||field.value!==value))return false;}
  return true;
 }catch{return false;}
}
function recordBridgeDeletion(member,sub,confirmation,now,requestId){
 if(!bridgeDeletionReceiptConfirmed(confirmation,sub,requestId)||!timestamp(now))throw Error('Verified Bridge-only deletion confirmation required');
 member.deletedAtMs=now;
 // This records the trusted adapter's result, never a global deletion claim.
 member.deletion={version:1,scope:'bridge',verification:'confirmed-authority-adapter',sub,clientId:'bridge',appNumber:6,observedAtMs:now,requestId,completed:true,membershipGeneration:member.membershipGeneration??null,canonicalMembershipRemoved:true,sessionsRevoked:true,globalAccountDeleted:false};
}
function confirmedBridgeDeletion(member,sub,now){
 const receipt=member.deletion;
 return member.deleted===true&&plain(receipt)&&receipt.version===1&&receipt.scope==='bridge'&&receipt.verification==='confirmed-authority-adapter'&&receipt.sub===sub&&receipt.clientId==='bridge'&&receipt.appNumber===6&&receipt.canonicalMembershipRemoved===true&&receipt.sessionsRevoked===true&&receipt.globalAccountDeleted===false&&(!Object.hasOwn(receipt,'membershipGeneration')||receipt.membershipGeneration===(member.membershipGeneration??null))&&timestamp(member.deletedAtMs)&&receipt.observedAtMs===member.deletedAtMs&&member.deletedAtMs<=now;
}
module.exports={plain,timestamp,ipDigest,shiftedMonths,observeHashedIP,archiveExpiredBans,endMatchingBans,initialPermanentReview,bridgeDeletionReceiptConfirmed,recordBridgeDeletion,confirmedBridgeDeletion};
