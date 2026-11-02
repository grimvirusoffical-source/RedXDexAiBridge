'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {CrawlManager}=require('../app/crawl-jobs.cjs');
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
test('a late final-page response cannot publish a page or turn a cancelled crawl into completed',async()=>{
 const page=deferred(),calls=[];let now=1000;
 const manager=new CrawlManager({clock:()=>now,request:async url=>{calls.push(url);return url.endsWith('/robots.txt')?{status:404,text:'',url}:page.promise;}});
 const job=manager.start({url:'https://docs.example.org/page',maxPages:1},'fixture');await flush();assert.equal(calls.length,2);
 now=2000;manager.stopAll();now=9000;page.resolve({status:200,url:'https://docs.example.org/page',text:'<title>Late page</title><a href="/next">Next</a>'});await flush();
 const result=manager.results(job.id,'fixture');assert.equal(result.status,'cancelled');assert.equal(result.pages.length,0);assert.equal(result.finishedAt,2000);assert.equal(calls.length,2);
});
test('a late robots response after cancellation cannot start a page fetch',async()=>{
 const robots=deferred(),calls=[];
 const manager=new CrawlManager({request:async url=>{calls.push(url);return robots.promise;}});
 const job=manager.start({url:'https://docs.example.org/page'},'fixture');await flush();manager.stop(job.id,'fixture');robots.resolve({status:200,text:'User-agent: *\nAllow: /',url:'https://docs.example.org/robots.txt'});await flush();
 assert.equal(manager.status(job.id,'fixture').status,'cancelled');assert.equal(calls.length,1);assert.equal(manager.results(job.id,'fixture').pages.length,0);
});
test('revocation while a failed page response is in flight cannot falsely complete an empty crawl',async()=>{
 const page=deferred();let active=true;
 const manager=new CrawlManager({request:async url=>url.endsWith('/robots.txt')?{status:404,text:'',url}:page.promise});
 const job=manager.start({url:'https://docs.example.org/page',maxPages:1},'fixture',{check:()=>active});await flush();active=false;page.reject(Error('fixture transport error'));await flush();
 assert.equal(manager.status(job.id,'fixture').status,'cancelled');assert.equal(manager.results(job.id,'fixture').pages.length,0);
});
test('cancelling a queued crawl never restarts it in its scheduled microtask',async()=>{
 let requests=0;
 const manager=new CrawlManager({request:async()=>{requests++;throw Error('A cancelled queued job must not fetch');},clock:()=>42});
 const job=manager.start({url:'https://docs.example.org/page'},'fixture');manager.stop(job.id,'fixture');await flush();
 const result=manager.status(job.id,'fixture');assert.equal(result.status,'cancelled');assert.equal(result.startedAt,null);assert.equal(result.finishedAt,42);assert.equal(requests,0);
});
test('cancellation while page allowance is pending cannot start an unmetered fetch',async()=>{
 const allowance=deferred(),calls=[];
 const manager=new CrawlManager({request:async url=>{calls.push(url);return{status:404,text:'',url};}});
 const job=manager.start({url:'https://docs.example.org/page'},'fixture',{beforePage:()=>allowance.promise});await flush();manager.stopAll();allowance.resolve();await flush();
 assert.equal(manager.status(job.id,'fixture').status,'cancelled');assert.equal(calls.length,1);
});
