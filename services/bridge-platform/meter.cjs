'use strict';
function meter({route,actor,body,state,member,tier,usage,now,random,integer,fail}){
 const t=tier(member),u=usage(member);
 const allowance=mode=>Math.min(15000,t.weeklyMinutes===null?15000:Math.max(0,t.weeklyMinutes*60000-u.activeMs),mode==='terminal'&&t.weeklyTerminalMinutes!==null?Math.max(0,t.weeklyTerminalMinutes*60000-u.terminalMs):15000);
 const reserve=(mode,ms)=>{u.activeMs+=ms;if(mode==='terminal')u.terminalMs+=ms;};
 if(route==='/usage/crawler'){const pages=integer(body.pages,1,1000);if(u.crawlerPages+pages>t.weeklyCrawlerPages)fail('weekly_crawler_limit',402);u.crawlerPages+=pages;return{usedPages:u.crawlerPages,limitPages:t.weeklyCrawlerPages};}
 if(route==='/usage/start'){
  if(!['bridge','terminal','crawler'].includes(body.mode))fail('invalid_usage_mode');
  if(!member.owner&&Object.values(state.sessions).some(v=>v.sub===actor.sub&&v.leaseUntilMs>now()))fail('one_active_work_session',409);
  const reservedMs=allowance(body.mode);if(!reservedMs)fail('weekly_time_limit',402);reserve(body.mode,reservedMs);
  const sessionId=random();state.sessions[sessionId]={sub:actor.sub,deviceId:actor.deviceId,mode:body.mode,lastMs:now(),leaseUntilMs:now()+reservedMs,lastSequence:0,weekStartMs:u.weekStartMs,reservedMs};
  return{sessionId,heartbeatSeconds:10,leaseUntilMs:now()+reservedMs,reservedMs,usage:structuredClone(u)};
 }
 const session=state.sessions[body.sessionId];if(!session||session.sub!==actor.sub||session.deviceId!==actor.deviceId)fail('work_session_not_found',404);
 if(session.leaseUntilMs<now())fail('work_session_expired',409);
 if(integer(body.sequence,1)!==session.lastSequence+1)fail('heartbeat_replayed_or_out_of_order',409);
 const elapsed=Math.min(session.reservedMs,Math.max(0,now()-session.lastMs));
 if(session.weekStartMs===u.weekStartMs){const refund=session.reservedMs-elapsed;u.activeMs=Math.max(0,u.activeMs-refund);if(session.mode==='terminal')u.terminalMs=Math.max(0,u.terminalMs-refund);}else{
  // A lease can span Monday's reset. Its old reservation disappeared with the
  // old week, but work performed in the new week still consumes that allowance.
  const currentWeekElapsed=Math.max(0,session.lastMs+elapsed-Math.max(session.lastMs,u.weekStartMs));
  u.activeMs+=currentWeekElapsed;if(session.mode==='terminal')u.terminalMs+=currentWeekElapsed;
 }
 const reservedMs=route==='/usage/stop'||body.working!==true?0:allowance(session.mode);
 if(!reservedMs)delete state.sessions[body.sessionId];else{reserve(session.mode,reservedMs);session.lastSequence=body.sequence;session.lastMs=now();session.leaseUntilMs=now()+reservedMs;session.weekStartMs=u.weekStartMs;session.reservedMs=reservedMs;}
 return{usage:structuredClone(u),chargedMs:elapsed,reservedMs,leaseUntilMs:reservedMs?now()+reservedMs:now(),stopped:reservedMs===0};
}
module.exports={meter};
