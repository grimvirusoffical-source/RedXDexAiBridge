'use strict';
const crypto=require('node:crypto');
const {normalizeTarget,fetchPublicPage,robotsRules,pageText,pageLinks}=require('./crawl-net.cjs');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const done=new Set(['completed','failed','cancelled','interrupted']);
class CrawlManager {
 constructor({request=fetchPublicPage,sleep=pause,clock=Date.now}={}){
  this.request=request;this.sleep=sleep;this.clock=clock;this.jobs=new Map();
 }
 _require(id,clientId){
  const job=this.jobs.get(id);
  if(!job||job.clientId!==clientId)throw Error('Crawl job not found for this client');
  return job;
 }
 _public(job){
  return {id:job.id,url:job.url,status:job.status,startedAt:job.startedAt,finishedAt:job.finishedAt,
   maxPages:job.maxPages,maxDepth:job.maxDepth,pagesFound:job.pages.length,skippedByRobots:job.skippedByRobots,
   errors:job.errors.slice(-8)};
 }
 list(clientId){return [...this.jobs.values()].filter(x=>x.clientId===clientId).map(x=>this._public(x));}
 status(id,clientId){return this._public(this._require(id,clientId));}
 results(id,clientId){
  const job=this._require(id,clientId);
  return {...this._public(job),pages:job.pages.map(x=>({...x}))};
 }
 start({url,maxPages=5,maxDepth=1}={},clientId='local',{check=()=>true,beforePage=async()=>{}}={}){
  const target=normalizeTarget(url);
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>20)throw Error('maxPages must be between 1 and 20');
  if(!Number.isSafeInteger(maxDepth)||maxDepth<0||maxDepth>3)throw Error('maxDepth must be between 0 and 3');
  const active=[...this.jobs.values()].filter(x=>!done.has(x.status));
  if(active.length>=3)throw Error('Maximum three concurrent crawl jobs; finish or stop one first');
  if(active.filter(x=>x.clientId===clientId).length>=2)throw Error('Maximum two crawl jobs per client');
  while(this.jobs.size>=40){
   const first=[...this.jobs.entries()].find(([,j])=>done.has(j.status));
   if(!first)throw Error('Crawl job history is full');
   this.jobs.delete(first[0]);
  }
  const job={id:crypto.randomUUID(),clientId,url:target.href,maxPages,maxDepth,status:'queued',
   startedAt:null,finishedAt:null,pages:[],errors:[],skippedByRobots:0,controller:new AbortController(),check,beforePage};
  this.jobs.set(job.id,job);
  queueMicrotask(()=>{this._run(job).catch(error=>{
   if(done.has(job.status))return;
   job.status=job.controller.signal.aborted?'cancelled':'failed';
   job.errors.push(String(error.message||error).slice(0,240));
   job.finishedAt=this.clock();
  });});
  return this._public(job);
 }
 _check(job){
  if(job.controller.signal.aborted)throw Error('Crawl was cancelled');
  if(!job.check()){job.controller.abort();throw Error('Crawl stopped by client revocation or emergency stop');}
 }
 async _run(job){
  if(done.has(job.status)||job.controller.signal.aborted)return;
  job.status='running';job.startedAt=this.clock();
  const timer=setTimeout(()=>job.controller.abort(),180000);timer.unref?.();
  try{
   const root=normalizeTarget(job.url);
   this._check(job);
   const robots=await this.request(root.origin+'/robots.txt',{signal:job.controller.signal,maxBytes:65536});
   this._check(job);
   if(robots.status!==200&&robots.status!==404)throw Error('Unable to verify robots.txt (HTTP '+robots.status+'); refusing to crawl');
   const rules=robots.status===200?robotsRules(robots.text):robotsRules('');
   const queue=[{url:root.href,depth:0}],seen=new Set(),queued=new Set([root.href]);
   let lastFetch=0;
   while(queue.length&&job.pages.length<job.maxPages){
    this._check(job);
    const next=queue.shift();queued.delete(next.url);
    if(seen.has(next.url))continue;
    seen.add(next.url);
    const requested=normalizeTarget(next.url);
    if(requested.origin!==root.origin)continue;
    if(!rules.allowed(requested.pathname+requested.search)){job.skippedByRobots++;continue;}
    const ms=Math.max(0,Math.max(200,rules.delayMs)-(this.clock()-lastFetch));
    if(lastFetch&&ms)await this.sleep(ms);
    this._check(job);
    await job.beforePage();
    this._check(job);
    let response;
    try{response=await this.request(requested.href,{signal:job.controller.signal,maxBytes:384*1024});this._check(job);}
    catch(error){
     if(job.controller.signal.aborted)throw error;
     this._check(job);
     job.errors.push(('Page failed: '+requested.pathname+' ('+String(error.message||error)+')').slice(0,240));
     if(job.errors.length>12)job.errors.shift();
     continue;
    }
    lastFetch=this.clock();
    if(response.status!==200){job.errors.push(('HTTP '+response.status+' at '+requested.pathname).slice(0,240));continue;}
    const final=normalizeTarget(response.url||requested.href);
    if(final.origin!==root.origin)throw Error('The requested page left the approved website');
    if(!rules.allowed(final.pathname+final.search)){job.skippedByRobots++;continue;}
    const page=pageText(response.text);
    this._check(job);
    job.pages.push({url:final.href,depth:next.depth,title:page.title,text:page.text});
    if(next.depth>=job.maxDepth)continue;
    for(const href of pageLinks(response.text,final.href,root.origin)){
     if(queue.length>=150||seen.has(href)||queued.has(href))continue;
     const target=normalizeTarget(href);
     if(!rules.allowed(target.pathname+target.search)){job.skippedByRobots++;continue;}
     queued.add(href);queue.push({url:href,depth:next.depth+1});
    }
   }
   this._check(job);job.status='completed';job.finishedAt=this.clock();
  }catch(error){
   job.status=job.controller.signal.aborted?'cancelled':'failed';
   job.errors.push(String(error.message||error).slice(0,240));if(job.finishedAt===null)job.finishedAt=this.clock();
  }finally{clearTimeout(timer);}
 }
 stop(id,clientId){
  const job=this._require(id,clientId);
  if(!done.has(job.status)){job.controller.abort();job.status='cancelled';job.finishedAt=this.clock();}
  return this._public(job);
 }
 stopClient(clientId){for(const job of this.jobs.values())if(job.clientId===clientId&&!done.has(job.status))this.stop(job.id,clientId);}
 stopAll(){for(const job of this.jobs.values())if(!done.has(job.status))this.stop(job.id,job.clientId);}
}
module.exports={CrawlManager};
