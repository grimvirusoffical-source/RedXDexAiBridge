'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const net=require('../app/crawl-net.cjs');
const {CrawlManager}=require('../app/crawl-jobs.cjs');
const core=require('../app/core.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function finished(manager,id,client='owner'){
 for(let i=0;i<100;i++){const job=manager.status(id,client);if(['completed','failed','cancelled'].includes(job.status))return job;await wait(10);}
 throw Error('Crawl did not finish in test time');
}
test('crawler rejects network-local, privileged, nonstandard port and non-HTTP URLs',()=>{
 for(const s of ['http://127.0.0.1/','http://169.254.169.254/latest/meta-data/','http://10.0.0.1/',
 'http://[::1]/','http://localhost/','http://internal.local/','http://server.home.arpa/',
 'https://public.example.org:8443/','ftp://public.example.org/', 'https://user:password@public.example.org/']){
  assert.throws(()=>net.normalizeTarget(s),/public|private|HTTP|port|website|allowed|hostname|local/i,s);
 }
 const parsed=net.normalizeTarget('https://docs.example.org/guide#section');
 assert.equal(parsed.href,'https://docs.example.org/guide');
});
test('DNS pinning requires all records to be public; mixed private DNS is rejected',async()=>{
 assert.equal(net.publicAddress('8.8.8.8'),true);
 assert.equal(net.publicAddress('93.184.216.34'),true);
 assert.equal(net.publicAddress('169.254.169.254'),false);
 assert.equal(net.publicAddress('192.168.1.5'),false);
 assert.equal(net.publicAddress('100.100.100.200'),false);
 assert.equal(net.publicAddress('::1'),false);
 assert.equal(net.publicAddress('2606:4700::1111'),true);
 const u=net.normalizeTarget('https://docs.example.org/');
 await assert.rejects(net.pinnedAddress(u,async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}]),/private|reserved/);
 assert.equal((await net.pinnedAddress(u,async()=>[{address:'93.184.216.34',family:4}])).address,'93.184.216.34');
});
test('robots directives select a matching agent, longest path wins, and delay is capped',()=>{
 const file='User-agent: *\nDisallow: /blocked\nUser-agent: RedXDexAiBridge\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 9\n';
 const rules=net.robotsRules(file);
 assert.equal(rules.allowed('/private/secret'),false);
 assert.equal(rules.allowed('/private/public/article'),true);
 assert.equal(rules.allowed('/blocked'),true);
 assert.equal(rules.delayMs,9000);
 assert.throws(()=>net.robotsRules('User-agent: *\nCrawl-delay: 120'),/safe 30-second/);
 const common=net.robotsRules('User-agent: *\nDisallow: /\n');
 assert.equal(common.allowed('/index'),false);
});
test('page extraction strips scripts and keeps only same-origin links',()=>{
 const html='<title>Research &amp; Projects</title><script>bad()</script><a href="/one">One</a><a href="https://docs.example.org/two?x=1&amp;y=2">Two</a><a href="http://127.0.0.1/">no</a><a href="https://evil.example.net/">no</a>';
 const data=net.pageText(html);
 assert.equal(data.title,'Research & Projects');
 assert.doesNotMatch(data.text,/bad\(\)/);
 assert.deepEqual(net.pageLinks(html,'https://docs.example.org/start','https://docs.example.org'),['https://docs.example.org/one','https://docs.example.org/two?x=1&y=2']);
});
test('crawl runs independently, honors robots and returns pages to only its owner',async()=>{
 const requests=[];
 const request=async(url)=>{
  requests.push(url);
  if(url.endsWith('/robots.txt'))return {status:200,text:'User-agent: *\nDisallow: /private\n',url};
  if(url.endsWith('/start'))return {status:200,text:'<title>Start</title><a href="/next">Next</a><a href="/private">No</a>',url};
  if(url.endsWith('/next'))return {status:200,text:'<title>Next</title><p>Result text</p>',url};
  throw Error('Unexpected URL '+url);
 };
 const manager=new CrawlManager({request,sleep:async()=>{}});
 const job=manager.start({url:'https://docs.example.org/start',maxPages:5,maxDepth:2},'owner');
 assert.equal(job.status,'queued');
 assert.throws(()=>manager.status(job.id,'attacker'),/not found/);
 const result=await finished(manager,job.id);
 assert.equal(result.status,'completed');
 assert.equal(result.pagesFound,2);
 assert.ok(result.skippedByRobots>=1);
 assert.equal(manager.results(job.id,'owner').pages[1].title,'Next');
 assert.equal(requests.includes('https://docs.example.org/private'),false);
 assert.equal(manager.list('attacker').length,0);
});
test('crawl is cancellable, scoped per client, and never silently restarts',async()=>{
 let entered=false;
 const manager=new CrawlManager({request:async(url,{signal}={})=>{
  if(url.endsWith('/robots.txt'))return {status:200,text:'User-agent: *\nAllow: /',url};
  entered=true;
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('stopped')),{once:true}));
 }});
 const a=manager.start({url:'https://docs.example.org/start'},'owner');
 for(let i=0;i<50&&!entered;i++)await wait(10);
 assert.equal(entered,true);
 assert.throws(()=>manager.stop(a.id,'other'),/not found/);
 const stopped=manager.stop(a.id,'owner');
 assert.equal(stopped.status,'cancelled');
 assert.equal((await finished(manager,a.id)).status,'cancelled');
 const b=manager.start({url:'https://docs.example.org/next'},'different-client',{check:()=>false});
 const after=await finished(manager,b.id,'different-client');
 assert.equal(after.status,'cancelled');
 manager.stopAll();
});
test('new crawl tool has independent default-deny permission and UI controls',async()=>{
 assert.equal(core.settings().permissions.crawl,false);
 await assert.rejects(core.perform('crawl_start',{url:'https://docs.example.org/'},{clientId:'unpaired'}),/Permission disabled: crawl/);
 for(const name of ['crawl_start','crawl_list','crawl_status','crawl_results','crawl_stop']){
  const tool=core.definitions.find(t=>t.name===name);
  assert.ok(tool,name+' must be discoverable');
  assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['bridge:tools']}]);
 }
 const html=fs.readFileSync(path.join(__dirname,'..','app','index.html'),'utf8');
 const ui=fs.readFileSync(path.join(__dirname,'..','app','ui.js'),'utf8');
 for(const id of ['crawl-url','crawl-pages','crawl-depth','crawl-start','crawl-status','crawl-results','crawl-stop']){
  assert.ok(html.includes('id="'+id+'"'));
 }
 assert.match(ui,/api\.tool\('crawl_start'/);
});
