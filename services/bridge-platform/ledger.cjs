'use strict';
// AX is a non-transferable closed-loop balance, represented as integer hundredths.
function addCredits(m,amount,lotId){m.creditLots??=[];m.creditsDebtCents??=0;const repay=Math.min(amount,m.creditsDebtCents);m.creditsDebtCents-=repay;const available=amount-repay;m.creditsCents+=available;m.creditLots.push({id:lotId,creditedCents:amount,availableCents:available});if(!m.creditsDebtCents)for(const grant of Object.values(m.grants))grant.suspended=false;}
function availableCredits(m){return(m.creditLots||[]).reduce((sum,lot)=>sum+Math.max(0,lot.availableCents-(lot.heldCents||0)),0);}
function spendCredits(m,amount){if(m.creditsDebtCents>0||availableCredits(m)<amount)throw Error('Insufficient available AX');m.creditLots??=[];let left=amount;const funding=[];for(const lot of m.creditLots){const take=Math.min(left,Math.max(0,lot.availableCents-(lot.heldCents||0)));if(take){lot.availableCents-=take;left-=take;funding.push({lotId:lot.id,amountCents:take});}if(!left)break;}if(left)throw Error('Credit ledger and balance differ');m.creditsCents-=amount;return funding;}
const paymentFor=(s,receipt)=>Object.values(s.payments).find(p=>p.checkoutSessionId===receipt&&p.orderId);

function reconcileReversal(s,paid,o,m,event,{audit,now}){
 const total=Math.min(o.amountCents,(paid.cashRefundedCents||0)+(paid.disputeLostCents||0)),prior=paid.refundedCents||0,delta=total-prior;
 if(!delta)return{duplicate:true};
 if(o.kind==='credits'){
  const lot=(m.creditLots||[]).find(v=>v.id===paid.checkoutSessionId);if(!lot)throw Error('Credit ledger missing');
  if(delta>0){const unspent=Math.min(delta,lot.availableCents);lot.availableCents-=unspent;lot.heldCents=Math.min(lot.heldCents||0,lot.availableCents);m.creditsCents-=unspent;const spent=delta-unspent;m.creditsDebtCents=(m.creditsDebtCents||0)+spent;if(spent)for(const grant of Object.values(m.grants))if(grant.funding?.some(f=>f.lotId===lot.id))grant.suspended=true;}
  else {
   // Restore chargeback debt first; keep the remainder in its original lot so
   // a genuine reopened dispute can hold the original funding again.
   const amount=-delta,repay=Math.min(amount,m.creditsDebtCents||0);m.creditsDebtCents=(m.creditsDebtCents||0)-repay;lot.availableCents+=amount-repay;m.creditsCents+=amount-repay;if(!m.creditsDebtCents)for(const grant of Object.values(m.grants))grant.suspended=false;
  }
 }else if(o.kind==='plugin'){
  for(const grant of Object.values(m.grants))if(grant.paymentRef===paid.checkoutSessionId){
   if(total===o.amountCents){if(!grant.revoked||grant.paymentRevoked){grant.paymentRevoked=true;grant.revoked=true;}}
   else if(prior===o.amountCents&&grant.paymentRevoked){grant.paymentRevoked=false;if(!grant.recoveryRevoked)grant.revoked=false;}
  }
 }else if(o.kind==='subscription'&&o.subscriptionId){
  const restoredId='restored_'+o.id;
  if(total===o.amountCents)m.subscriptions=m.subscriptions.filter(v=>v.providerId!==restoredId&&(v.providerId!==o.subscriptionId||o.periodEndMs&&v.untilMs>o.periodEndMs));
  else if(prior===o.amountCents&&o.periodEndMs>now()){
   // Restore only the purchased period, without restarting recurring billing.
   m.subscriptions=m.subscriptions.filter(v=>v.providerId!==restoredId);m.subscriptions.push({tier:o.sku,untilMs:o.periodEndMs,source:'dispute_reinstatement',providerId:restoredId,originalProviderId:o.subscriptionId,paymentRef:paid.checkoutSessionId});
  }
 }
 paid.refundedCents=total;
 audit(s,null,delta>0?'payment.refunded':'payment.dispute_reinstated',m.sub,{eventId:event.eventId,orderId:o.id,amountCents:Math.abs(delta),totalRefundedCents:total});
 return delta>0?{refunded:true,amountCents:delta}:{reinstated:true,amountCents:-delta};
}
function applyRefund(s,event,env){
 const {integer,fail,now}=env;if(event?.verified!==true)fail('verified_payment_required',403);if(s.payments[event.eventId])return{duplicate:true};
 const paid=paymentFor(s,event.checkoutSessionId);if(!paid)fail('payment_not_found',404);const o=s.orders[paid.orderId],incoming=integer(event.totalRefundedCents,0,o.amountCents),m=s.members[o.sub];if(!m)fail('membership_unavailable',409);
 // Actual refunds are cumulative and can never be undone by a dispute appeal.
 if(event.source==='dispute')fail('dispute_state_required',403);
 paid.cashRefundedCents=Math.max(paid.cashRefundedCents||0,incoming);
 const result=reconcileReversal(s,paid,o,m,event,env);s.payments[event.eventId]={kind:'refund',checkoutSessionId:event.checkoutSessionId,totalRefundedCents:paid.refundedCents||0,atMs:now()};return result;
}
function applyDispute(s,event,env){
 const {integer,fail,audit,now}=env;if(event?.verified!==true)fail('verified_payment_required',403);if(s.payments[event.eventId])return{duplicate:true};
 const paid=paymentFor(s,event.checkoutSessionId);if(!paid)fail('payment_not_found',404);const o=s.orders[paid.orderId],m=s.members[o.sub];if(!m)fail('membership_unavailable',409);
 const amountCents=integer(event.amountCents,0,o.amountCents),open=['needs_response','under_review','warning_needs_response','warning_under_review','appeal_needs_response','appeal_under_review'],closed=['won','lost','warning_closed','prevented'];if(!open.includes(event.status)&&!closed.includes(event.status))fail('dispute_status_unsupported',409);
 s.disputes??={};const prior=s.disputes[event.disputeId];if(prior&&prior.checkoutSessionId!==event.checkoutSessionId)fail('dispute_payment_changed',409);
 // The adapter retrieves current provider state. Appeals may change closed
 // results; a pending appeal retains a previously realized loss until won.
 const loss=event.status==='lost'||open.includes(event.status)&&prior?.lossApplied===true;
 s.disputes[event.disputeId]={checkoutSessionId:event.checkoutSessionId,status:event.status,amountCents,lossApplied:loss,updatedMs:now()};
 paid.disputeLostCents=Math.min(o.amountCents,Object.values(s.disputes).filter(d=>d.checkoutSessionId===event.checkoutSessionId&&d.lossApplied).reduce((sum,d)=>sum+d.amountCents,0));
 const result=reconcileReversal(s,paid,o,m,event,env);
 for(const lot of m.creditLots||[])lot.heldCents=0;for(const g of Object.values(m.grants))g.disputeHeld=false;m.subscriptionHolds=[];
 for(const d of Object.values(s.disputes).filter(d=>d.amountCents>0&&(open.includes(d.status)||d.status==='lost'))){
  const payment=paymentFor(s,d.checkoutSessionId),order=payment?s.orders[payment.orderId]:null;if(!order||order.sub!==m.sub)continue;if(d.lossApplied&&order.kind!=='subscription')continue;
  if(order.kind==='credits'){const lot=(m.creditLots||[]).find(v=>v.id===d.checkoutSessionId);if(lot)lot.heldCents=Math.min(lot.availableCents,(lot.heldCents||0)+d.amountCents);for(const g of Object.values(m.grants))if(g.funding?.some(f=>f.lotId===d.checkoutSessionId))g.disputeHeld=true;}
  else if(order.kind==='plugin'){for(const g of Object.values(m.grants))if(g.paymentRef===d.checkoutSessionId)g.disputeHeld=true;}
  else if(order.kind==='subscription'&&order.subscriptionId){m.subscriptionHolds.push(order.subscriptionId);for(const grant of m.subscriptions)if(grant.originalProviderId===order.subscriptionId)m.subscriptionHolds.push(grant.providerId);}
 }
 s.payments[event.eventId]={kind:'dispute',disputeId:event.disputeId,status:event.status,atMs:now()};audit(s,null,'payment.dispute_synchronized',m.sub,{eventId:event.eventId,disputeId:event.disputeId,status:event.status,amountCents});return{ok:true,status:event.status,...result};
}
module.exports={addCredits,spendCredits,availableCredits,applyRefund,applyDispute};
