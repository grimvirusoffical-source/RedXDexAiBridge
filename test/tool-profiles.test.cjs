'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
assert.ok(process.env.REDXDEX_DATA_DIR&&path.resolve(process.env.REDXDEX_DATA_DIR)!==path.join(os.homedir(),'.redxdex-ai-bridge'),'Tool profile HTTP tests require isolated REDXDEX_DATA_DIR');
const core=require('../app/core.cjs'),{ClientStore}=require('../app/clients.cjs'),{OAuthService}=require('../app/oauth.cjs'),{startServer}=require('../app/http-mcp.cjs');
const {profileAllowed,restrictTools,assertProfile}=require('../app/tool-profiles.cjs');
async function fixture(run){
 const before=core.settings(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-tool-profile-'));
 const clients=new ClientStore(path.join(dir,'clients.json')),terminal=clients.createProfile('Terminal fixture','terminal'),crawler=clients.createProfile('Crawler fixture','crawler'),full=clients.create('Full fixture');
 const canary=path.join(dir,'canary.txt');fs.writeFileSync(canary,'scope-canary');
 core.saveSettings({...before,directories:[dir],emergencyStop:false,backgroundOnly:true,permissions:{...before.permissions,read:true,terminal:true,crawl:true},clientPolicies:Object.fromEntries([terminal,crawler,full].map(c=>[c.id,{read:'always',terminal:'always',crawl:'always'}]))});
 const servers=[];
 const server=async options=>{const result=await startServer({clients,...options});servers.push(result);return result;};
 try{await run({dir,clients,terminal,crawler,full,canary,server});}
 finally{for(const s of servers)await s.stop();core.saveSettings(before);fs.rmSync(dir,{recursive:true,force:true});}
}
async function rpc(gateway,token,route='/mcp',method='tools/list',params={},extra={}){
 const url=new URL(gateway.url);url.pathname=route;
 const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json',...(extra.headers||{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params,...(extra.message||{})})});
 return{status:response.status,body:await response.json()};
}
const names=result=>result.body.result.tools.map(t=>t.name);
function blocked(result){assert.equal(result.status,200);assert.equal(result.body.result.isError,true);assert.match(result.body.result.content[0].text,/does not allow that tool/);}
test('profile helpers reject unknown or malformed restrictions even for an empty tool list',()=>{
 assert.equal(profileAllowed('run_command','terminal'),true);assert.equal(profileAllowed('crawl_start','terminal'),false);
 for(const bad of ['owner','',null,{},['terminal']])assert.throws(()=>profileAllowed('get_profile',bad),/Unknown/);
 assert.throws(()=>restrictTools([],['owner']),/Unknown/);assert.throws(()=>assertProfile('get_profile','terminal'),/Unknown/);
});
test('restricted clients are saved atomically with a profile; missing/unknown profiles never become full Bridge',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-client-profile-'));
 try{
  const clients=new ClientStore(path.join(dir,'clients.json'));let saves=0;const save=clients.save.bind(clients);clients.save=()=>{saves++;save();};
  const c=clients.createProfile('Terminal','terminal');assert.equal(saves,1);assert.equal(new ClientStore(clients.file).verify(c.token).toolProfile,'terminal');
  assert.throws(()=>clients.create('Incomplete','restricted'),/require/);assert.throws(()=>clients.createProfile('Bad','owner'),/terminal or crawler/);
  delete clients.entries[c.id].toolProfile;assert.equal(clients.verify(c.token),null);assert.equal(clients.exists(c.id),false);
  clients.entries[c.id].toolProfile='owner';assert.equal(clients.verify(c.token),null);
  clients.entries[c.id].toolProfile='bridge';assert.equal(clients.verify(c.token),null,'a malformed restricted record must never become a full Bridge credential');
  assert.equal(clients.exists('__proto__'),false);assert.throws(()=>clients.create('Reserved','local','__proto__'),/Invalid/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('terminal bearer remains terminal-only on both its narrow endpoint and /mcp',async()=>fixture(async({terminal,crawler,canary,server})=>{
 const g=await server();
 for(const route of ['/mcp','/terminal/mcp']){
  const listed=await rpc(g,terminal.token,route);assert.equal(listed.status,200);assert.ok(names(listed).includes('process_start'));assert.ok(!names(listed).includes('read_text_file'));assert.ok(!names(listed).includes('crawl_start'));
  blocked(await rpc(g,terminal.token,route,'tools/call',{name:'read_text_file',arguments:{path:canary}}));
  const allowed=await rpc(g,terminal.token,route,'tools/call',{name:'process_list',arguments:{}});assert.equal(allowed.body.result.isError,undefined);
 }
 const other=await rpc(g,terminal.token,'/crawler/mcp');assert.deepEqual(names(other).sort(),['bridge_status','get_profile']);
 blocked(await rpc(g,terminal.token,'/crawler/mcp','tools/call',{name:'process_list',arguments:{}}));
 const crawlers=await rpc(g,crawler.token);assert.ok(names(crawlers).includes('crawl_start'));assert.ok(!names(crawlers).includes('process_start'));
}));
test('full bearer is narrowed by the chosen endpoint, and body/header profile spoofing cannot widen it',async()=>fixture(async({full,terminal,canary,server})=>{
 const g=await server();assert.ok(names(await rpc(g,full.token)).includes('read_text_file'));
 const fullRead=await rpc(g,full.token,'/mcp','tools/call',{name:'read_text_file',arguments:{path:canary}});assert.equal(fullRead.body.result.content[0].text,'scope-canary');
 assert.ok(!names(await rpc(g,full.token,'/terminal/mcp')).includes('crawl_start'));
 blocked(await rpc(g,full.token,'/terminal/mcp','tools/call',{name:'read_text_file',arguments:{path:canary}}));
 assert.ok(!names(await rpc(g,full.token,'/crawler/mcp')).includes('process_start'));
 blocked(await rpc(g,terminal.token,'/mcp','tools/call',{name:'read_text_file',arguments:{path:canary,toolProfile:'bridge',clientId:full.id}},{headers:{'x-tool-profile':'bridge'},message:{toolProfiles:['bridge'],clientId:full.id}}));
 assert.equal((await rpc(g,full.token,'/owner/mcp')).status,404);
}));
test('OAuth credentials inherit their immutable local profile even when OAuth verify omits it',async()=>fixture(async({dir,clients,terminal,canary,server})=>{
 const oauth=new OAuthService({file:path.join(dir,'oauth.json'),clients,approvals:{request:()=>Promise.reject(Error('No pairing requested'))}});oauth.setOrigin('https://bridge.example');
 const registration=oauth.register({client_name:'OAuth fixture',redirect_uris:['https://client.example/callback']});
 const granted=oauth.issue(registration.client_id,terminal.id);
 assert.equal(oauth.verify(granted.access_token).toolProfile,undefined,'fixture exercises the legacy verifier contract');
 const g=await server({oauth});const list=await rpc(g,granted.access_token);assert.equal(list.status,200);assert.ok(names(list).includes('process_start'));assert.ok(!names(list).includes('read_text_file'));
 blocked(await rpc(g,granted.access_token,'/mcp','tools/call',{name:'read_text_file',arguments:{path:canary}}));
 clients.revoke(terminal.id);assert.equal((await rpc(g,granted.access_token)).status,401);
}));
test('unknown profiles are denied at HTTP authentication and cannot fall back to a legacy full token',async()=>fixture(async({clients,terminal,server})=>{
 clients.entries[terminal.id].toolProfile='owner';
 const g=await server({token:terminal.token});assert.equal((await rpc(g,terminal.token)).status,401);
 const orphan=await startServer({oauth:{origin:'https://bridge.example',verify:()=>({id:'missing',name:'Unregistered',kind:'oauth'})}});
 try{assert.equal((await rpc(orphan,'not-a-registry-token')).status,401);}finally{await orphan.stop();}
}));
test('trusted context restrictions intersect with token and path restrictions instead of being replaced',async()=>fixture(async({full,server})=>{
 const g=await server({contextFor:()=>({toolProfiles:['crawler'],transport:'stdio',interactive:true})});
 assert.deepEqual(names(await rpc(g,full.token,'/terminal/mcp')).sort(),['bridge_status','get_profile']);
 blocked(await rpc(g,full.token,'/terminal/mcp','tools/call',{name:'process_list',arguments:{}}));
 const invalid=await server({contextFor:()=>({toolProfiles:['unknown']})});assert.equal((await rpc(invalid,full.token)).status,400);
}));
