'use strict';
const POLLING=new Set(['process_list','process_output','process_stop','crawl_list','crawl_status','crawl_results','crawl_stop']);
const MAX_LEASE_MS=15000;
class PlatformMeter {
 constructor({client,stopWork,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
  if(typeof client?.call!=='function')throw Error('An authenticated usage client is required');
  Object.assign(this,{client,stopWork,now,setTimer,clearTimer});
  this.tasks=new Map();this.lease=null;this.serial=Promise.resolve();this.timer=null;this.expiry=null;this.next=0;this.failed=null;this.generation=0;
 }
 enqueue(fn){const operation=this.serial.then(fn);this.serial=operation.catch(()=>{});return operation;}
 clearTimers(){if(this.timer!==null)this.clearTimer(this.timer);if(this.expiry!==null)this.clearTimer(this.expiry);this.timer=null;this.expiry=null;}
 invokeStop(){try{this.stopWork?.()?.catch?.(()=>{});}catch{}}
 fail(error){
  if(this.failed)return;
  this.failed=error instanceof Error?error:Error('The active-work allowance could not be renewed');
  this.generation++;this.clearTimers();this.lease=null;this.tasks.clear();this.invokeStop();
 }
 validateLease(value,requestedAt){
  if(!value||typeof value.sessionId!=='string'||!value.sessionId||!Number.isFinite(value.leaseUntilMs)||value.leaseUntilMs<=this.now())throw Error('The service did not grant a valid active-work lease');
  // Every current server reservation is at most 15 seconds. A malformed future
  // timestamp must never turn a disconnected app into unlimited offline work.
  return {...value,leaseUntilMs:Math.min(value.leaseUntilMs,requestedAt+MAX_LEASE_MS)};
 }
 arm(){
  this.clearTimers();const lease=this.lease,generation=this.generation;if(!lease)return;
  const remaining=lease.leaseUntilMs-this.now();
  if(remaining<=0){this.fail(Error('The active-work allowance expired'));return;}
  this.expiry=this.setTimer(()=>{if(this.generation===generation&&this.lease===lease)this.fail(Error('The active-work allowance could not be renewed'));},remaining);
  this.expiry?.unref?.();
  this.timer=this.setTimer(()=>{
   this.timer=null;
   this.enqueue(()=>this._renew(lease,generation)).catch(error=>{if(this.generation===generation)this.fail(error);});
  },Math.max(1,Math.min(5000,Math.floor(remaining/2))));
  this.timer?.unref?.();
 }
 assertActive(){
  if(this.failed)throw this.failed;
  if(!this.lease||!this.tasks.size)throw Error('There is no active work allowance');
  if(this.lease.leaseUntilMs<=this.now()){this.fail(Error('The active-work allowance expired'));throw this.failed;}
  return true;
 }
 async begin(name,context={}){
  if(POLLING.has(name))return async()=>{};
  if(this.failed)throw this.failed;
  const generation=this.generation;
  return this.enqueue(async()=>{
   if(this.failed)throw this.failed;
   if(generation!==this.generation)throw Error('Work was cancelled before it started');
   if(context.isActive&&!context.isActive())throw Error('Client access has been revoked');
   if(!this.lease){
    const requestedAt=this.now();
    try{
     // All current tiers use the same terminal and shared active-time budget.
     // One bridge lease covers the UNION of every AI/tool's active work. Do not
     // switch leases when a terminal or crawler joins an already active task.
     const result=await this.client.call('/usage/start',{mode:'bridge'});
     if(generation!==this.generation){
      // An owner disconnect during initial authorization must not leave an
      // acknowledged but never-used reservation alive until its full expiry.
      if(result?.sessionId){try{await this.client.call('/usage/stop',{sessionId:result.sessionId,sequence:1,working:false});}catch{}}
      throw Error('Work was cancelled before it started');
     }
     this.lease={...this.validateLease(result,requestedAt),mode:'bridge',sequence:0};
     this.arm();
    }catch(error){if(generation===this.generation)this.fail(error);throw error;}
   }
   if(this.failed)throw this.failed;
   if(this.lease.leaseUntilMs<=this.now()){this.fail(Error('The active-work allowance expired'));throw this.failed;}
   if(context.isActive&&!context.isActive()){
    if(!this.tasks.size)await this.closeLease();
    throw Error('Client access has been revoked');
   }
   const key=++this.next;this.tasks.set(key,{name,context});let ended=false;
   return async()=>{
    if(ended)return;ended=true;
    return this.enqueue(async()=>{
     if(generation!==this.generation)return;
     this.tasks.delete(key);
     if(!this.tasks.size)await this.closeLease();
     // Joining/leaving concurrent work must never postpone the heartbeat.
    });
   };
  });
 }
 async closeLease(){
  const lease=this.lease,generation=this.generation;this.lease=null;this.clearTimers();if(!lease)return;
  try{await this.client.call('/usage/stop',{sessionId:lease.sessionId,sequence:lease.sequence+1,working:false});}
  catch(error){if(generation===this.generation)this.fail(error);throw error;}
 }
 async _renew(lease,generation){
  if(generation!==this.generation||this.lease!==lease||!this.tasks.size)return;
  this.assertActive();const requestedAt=this.now();
  const result=await this.client.call('/usage/heartbeat',{sessionId:lease.sessionId,sequence:lease.sequence+1,working:true});
  if(!result||result.stopped!==true&&result.stopped!==false||result.sessionId!==undefined&&result.sessionId!==lease.sessionId||!Number.isFinite(result.leaseUntilMs))throw Error('The service returned an invalid work-lease acknowledgement');
  if(generation!==this.generation||this.lease!==lease){
   // stop() may be queued behind this in-flight heartbeat. Remember a confirmed
   // acknowledgement for settlement only; never re-arm or resume local work.
   if(this.lease===lease&&!this.tasks.size&&!result?.stopped)this.lease={...lease,...result,sequence:lease.sequence+1};
   return;
  }
  // The old absolute expiry remains armed while HTTP is in flight. A late
  // response cannot resurrect expired or explicitly disconnected work.
  this.assertActive();
  if(result?.stopped)throw Error('Weekly active-work allowance has been reached');
  this.lease={...lease,...this.validateLease({...lease,...result},requestedAt),sequence:lease.sequence+1};this.arm();
 }
 async renew(){const lease=this.lease,generation=this.generation;return this.enqueue(()=>this._renew(lease,generation)).catch(error=>{if(generation===this.generation)this.fail(error);throw error;});}
 async crawlerPage(){
  this.assertActive();const generation=this.generation;
  try{
   const result=await this.client.call('/usage/crawler',{pages:1});
   if(generation!==this.generation)throw Error('Crawler work was cancelled');
   this.assertActive();return result;
  }catch(error){
   // A page quota refuses this crawl before fetching another page. It does not
   // revoke an unrelated terminal task that still has a shared time allowance.
   if(generation===this.generation&&error.code!=='weekly_crawler_limit')this.fail(error);
   throw error;
  }
 }
 async stop(){
  const active=this.tasks.size>0;this.generation++;this.tasks.clear();this.clearTimers();this.failed=null;
  if(active)this.invokeStop();
  return this.enqueue(async()=>{await this.closeLease().catch(()=>{});this.failed=null;});
 }
}

// Ownership of a background task outlives its initiating MCP response. Process
// exit can be observed directly; crawler completion uses bounded local polling.
function trackBackgroundWork({finish,isRunning,subscribe,setTimer=setTimeout,clearTimer=clearTimeout,intervalMs=250}){
 let ended=false,timer=null,unsubscribe=null;
 const settle=()=>{
  if(ended)return;ended=true;if(timer!==null)clearTimer(timer);unsubscribe?.();
  Promise.resolve().then(finish).catch(()=>{});
 };
 const check=()=>{
  if(ended)return;if(timer!==null){clearTimer(timer);timer=null;}
  let running=false;try{running=isRunning();}catch{}
  if(!running){settle();return;}
  timer=setTimer(check,intervalMs);timer?.unref?.();
 };
 if(subscribe){try{const cleanup=subscribe(check);if(typeof cleanup==='function'){if(ended)cleanup();else unsubscribe=cleanup;}}catch{/* Completion polling remains active if event subscription fails. */}}
 check();return{check,settle};
}
module.exports={PlatformMeter,POLLING,trackBackgroundWork,MAX_LEASE_MS};
