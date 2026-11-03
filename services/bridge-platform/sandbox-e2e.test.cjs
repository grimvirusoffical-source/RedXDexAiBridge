'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ACCOUNT,HOOK,PINNED_API_VERSION,REQUIRED_EVENTS,configShape,readConfig,privateLocation,privateDirectory,checkoutURL,directEndpointURL,webhookOrigin,webhookPath,renewalStateMatches,prepare,assertOwnedCustomer,assertRun,preflight,clientAndSecret,webhookServer,publicStatus,safeError,execute}=require('./sandbox-e2e.cjs');
const catalog=require('./sandbox-catalog.json'),code=value=>error=>error.code===value;
const {recoverAttachedClock,advanceOwnedClock,advanceRenewal,cleanup}=require('./sandbox-e2e.cjs');
function configuration(){const temp=fs.realpathSync(os.tmpdir());return{account:ACCOUNT,mode:'sandbox',scenario:'subscription',apiKeyFile:path.join(temp,'private-rak'),webhookSecretFile:path.join(temp,'private-hook'),runDirectory:path.join(temp,'isolated-bridge-run'),allowSandboxMutations:true};}
async function unusedFixturePort(){const server=http.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
function readonlyClient(){
 const writes=[],reads=[],registry=new Map();
 for(const [sku,item]of Object.entries(catalog.products))registry.set(item.price,{id:item.price,active:true,livemode:false,currency:'usd',unit_amount:item.amountCents??null,product:{id:item.product,active:true},...(sku==='axioms'?{custom_unit_amount:{minimum:501}}:sku==='workflow-checkpoints'?{}:{recurring:{interval:'month',interval_count:1}})});
 const client={bridgeLivemode:false,accounts:{retrieve:async()=>({id:ACCOUNT})},prices:{retrieve:async id=>{reads.push(id);return registry.get(id);}},customers:{create:()=>{writes.push('customer');throw Error('Unexpected provider mutation');}},checkout:{sessions:{create:()=>{writes.push('checkout');throw Error('Unexpected provider mutation');}}}};
 return{client,writes,reads,registry};
}
function directFixture(){
 const c={...configuration(),runId:'d'.repeat(32),webhookEndpointId:'we_fixture'},fixture=readonlyClient(),endpoint={id:c.webhookEndpointId,status:'enabled',livemode:false,api_version:PINNED_API_VERSION,url:directEndpointURL(c.runId),enabled_events:[...REQUIRED_EVENTS],metadata:{redx_e2e:c.runId,redx_app:'bridge'}};
 fixture.client.getApiField=name=>name==='version'?PINNED_API_VERSION:undefined;fixture.client.webhookEndpoints={retrieve:async id=>{fixture.reads.push(id);return endpoint;}};return{...fixture,c,endpoint};
}
test('sandbox command guards reject live accounts, inline secrets, missing private paths and mutation opt-in',()=>{
 for(const change of [{account:'acct_live_other'},{mode:'live'},{scenario:'unknown'},{apiKey:'rk_test_must_not_be_inline'},{webhookSecret:'whsec_must_not_be_inline'},{apiKeyFile:'relative.key'},{allowSandboxMutations:false},{port:0},{waitSeconds:3601}])assert.throws(()=>configShape({...configuration(),...change}));
 assert.equal(configShape(configuration()).port,17784);
});
test('secret loader accepts only a sandbox restricted key and obtains both secrets for the pinned account',async()=>{
 for(const key of ['rk_live_never','sk_test_never','sk_live_never']){let hookReads=0;await assert.rejects(clientAndSecret(configuration(),{readSandboxKey:async()=>key,readWebhookSecret:async()=>{hookReads++;return'whsec_never';}}),code('sandbox_restricted_key_required'));assert.equal(hookReads,0);}
 const calls=[],reader={readSandboxKey:async(file,options)=>{calls.push(['key',file,options]);return'rk_test_'+'fixture'.repeat(4);},readWebhookSecret:async(file,options)=>{calls.push(['hook',file,options]);return'whsec_'+'fixture'.repeat(4);}};
 const result=await clientAndSecret(configuration(),reader);assert.equal(result.client.bridgeLivemode,false);assert.equal(result.secret,'whsec_'+'fixture'.repeat(4));assert.deepEqual(calls.map(c=>c[2]),[{expectedAccount:ACCOUNT},{expectedAccount:ACCOUNT}]);
});
test('preflight validates the actual credential account and provider mode before any mutation',async()=>{
 const wrong=readonlyClient();wrong.client.accounts.retrieve=async()=>({id:'acct_other'});await assert.rejects(preflight(wrong.client),code('sandbox_account_mismatch'));assert.equal(wrong.reads.length,0);assert.equal(wrong.writes.length,0);
 const live=readonlyClient();live.client.bridgeLivemode=true;await assert.rejects(preflight(live.client),code('sandbox_client_required'));assert.equal(live.writes.length,0);
 const bad=readonlyClient();bad.registry.get(catalog.products.gold.price).livemode=true;await assert.rejects(preflight(bad.client));assert.equal(bad.writes.length,0);
 const valid=readonlyClient(),result=await execute('preflight',configuration(),{client:valid.client,secret:'whsec_fixture'});assert.deepEqual(result,{account:ACCOUNT,livemode:false,catalogVerified:true,fixtureIdentity:true,productionReady:false});assert.equal(valid.reads.length,8);assert.equal(valid.writes.length,0);
});
test('direct destination requires an explicit canonical run ID while CLI configuration remains supported',()=>{
 const {c}=directFixture();assert.equal(configShape(c).runId,c.runId);assert.equal(configShape(configuration()).webhookEndpointId,undefined);
 assert.throws(()=>configShape({...configuration(),webhookEndpointId:'we_fixture'}),code('direct_endpoint_run_id_required'));
 for(const runId of [null,[],['d'.repeat(32)],'d'.repeat(31),'D'.repeat(32),'../'+'d'.repeat(32)])assert.throws(()=>configShape({...c,runId}),code('sandbox_run_id_invalid'));
 for(const webhookEndpointId of [null,['we_fixture'],'we_','evt_fixture'])assert.throws(()=>configShape({...c,webhookEndpointId}),code('webhook_endpoint_invalid'));
});
test('direct preflight verifies the exact registered Sandbox destination without claiming secret or delivery proof',async()=>{
 const f=directFixture(),result=await execute('preflight',f.c,{client:f.client,secret:'whsec_fixture'});
 assert.deepEqual(result,{account:ACCOUNT,livemode:false,catalogVerified:true,endpointConfigurationVerified:true,webhookEndpointId:'we_fixture',fixtureIdentity:true,productionReady:false});assert.equal(f.reads.at(-1),'we_fixture');assert.equal(f.writes.length,0);assert.equal(result.signedWebhookVerified,undefined);assert.equal(result.signingSecretFingerprint,undefined);
 // Event order is immaterial; membership must still be exact, without duplicates.
 f.endpoint.enabled_events.reverse();await assert.doesNotReject(preflight(f.client,f.c));
});
test('temporary origins are default-off, require a boolean opt-in and accept only one strict trycloudflare label',()=>{
 const {c}=directFixture(),origin='https://locally-owned-fixture.trycloudflare.com';
 assert.equal(webhookOrigin(c),'https://red-xai.com');assert.equal(webhookOrigin({...c,allowTemporaryTunnel:false}),'https://red-xai.com');
 for(const allowTemporaryTunnel of ['true',1,null,{},[]])assert.throws(()=>configShape({...c,allowTemporaryTunnel,testWebhookOrigin:origin}),code('temporary_tunnel_opt_in_invalid'));
 for(const allowTemporaryTunnel of [undefined,false])assert.throws(()=>configShape({...c,allowTemporaryTunnel,testWebhookOrigin:origin}),code('temporary_tunnel_not_enabled'));
 assert.throws(()=>configShape({...c,allowTemporaryTunnel:true}),code('temporary_tunnel_origin_required'));
 assert.throws(()=>configShape({...configuration(),allowTemporaryTunnel:true,testWebhookOrigin:origin}),code('temporary_tunnel_direct_endpoint_required'));
 for(const testWebhookOrigin of [null,[],['https://fixture.trycloudflare.com'],'https://red-xai.com','http://fixture.trycloudflare.com','https://fixture.trycloudflare.com:443','https://user:password@fixture.trycloudflare.com','https://fixture.trycloudflare.com/','https://fixture.trycloudflare.com/path','https://fixture.trycloudflare.com?','https://fixture.trycloudflare.com#','https://a.b.trycloudflare.com','https://trycloudflare.com','https://fixture.trycloudflare.com.evil.example','https://-fixture.trycloudflare.com','https://fixture-.trycloudflare.com','https://'+'a'.repeat(64)+'.trycloudflare.com','https://测试.trycloudflare.com','HTTPS://fixture.trycloudflare.com','https://Fixture.trycloudflare.com'])assert.throws(()=>configShape({...c,allowTemporaryTunnel:true,testWebhookOrigin}),code('temporary_tunnel_origin_invalid'));
 const temporary={...c,allowTemporaryTunnel:true,testWebhookOrigin:origin};assert.equal(webhookOrigin(configShape(temporary)),origin);assert.equal(directEndpointURL(c.runId,temporary),origin+webhookPath(c));assert.equal(webhookPath(temporary),webhookPath(c));
});
test('temporary origin preflight binds the actual registered endpoint while retaining Sandbox and production-readiness limits',async()=>{
 const f=directFixture();Object.assign(f.c,{allowTemporaryTunnel:true,testWebhookOrigin:'https://locally-owned-fixture.trycloudflare.com'});
 await assert.rejects(preflight(f.client,f.c),code('sandbox_endpoint_configuration_mismatch'));f.endpoint.url=directEndpointURL(f.c.runId,f.c);
 const result=await execute('preflight',f.c,{client:f.client,secret:'whsec_fixture'});assert.equal(result.endpointConfigurationVerified,true);assert.equal(result.livemode,false);assert.equal(result.fixtureIdentity,true);assert.equal(result.productionReady,false);assert.equal(f.writes.length,0);
 f.endpoint.url=f.endpoint.url.replace('locally-owned-fixture','another-fixture');await assert.rejects(preflight(f.client,f.c),code('sandbox_endpoint_configuration_mismatch'));assert.equal(f.writes.length,0);
});
test('direct preflight refuses changed URLs, ownership, mode, status, API versions and event sets',async()=>{
 const base=directFixture(),url=base.endpoint.url;
 const changes=[{id:'we_other'},{status:'disabled'},{livemode:true},{api_version:'2026-09-30.endive'},{metadata:{redx_e2e:'e'.repeat(32),redx_app:'bridge'}},{metadata:{redx_e2e:base.c.runId,redx_app:'other'}},{enabled_events:['*']},{enabled_events:REQUIRED_EVENTS.slice(0,-1)},{enabled_events:[...REQUIRED_EVENTS,'customer.created']},{enabled_events:[...REQUIRED_EVENTS.slice(0,-1),REQUIRED_EVENTS[0]]},...['http://red-xai.com'+new URL(url).pathname,url+'?query=1',url+'#fragment',url.replace('red-xai.com','red-xai.com:443'),url.replace('red-xai.com','user:password@red-xai.com'),url.replace('red-xai.com','other.example'),url.replace(base.c.runId,'e'.repeat(32)),url+'/'].map(url=>({url}))];
 for(const change of changes){const f=directFixture();Object.assign(f.endpoint,change);await assert.rejects(preflight(f.client,f.c),code('sandbox_endpoint_configuration_mismatch'));assert.equal(f.writes.length,0);}
 const wrongSDK=directFixture();wrongSDK.client.getApiField=()=> '2026-09-30.endive';await assert.rejects(preflight(wrongSDK.client,wrongSDK.c),code('sandbox_sdk_api_version_mismatch'));assert.ok(!wrongSDK.reads.includes('we_fixture'));assert.equal(wrongSDK.writes.length,0);
 const missing=directFixture();delete missing.client.webhookEndpoints;await assert.rejects(preflight(missing.client,missing.c),code('sandbox_endpoint_lookup_required'));
});
test('a failed direct endpoint preflight stops before creating fixture files or provider objects',async()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-direct-')),f=directFixture();f.c.runDirectory=path.join(directory,'untouched');f.endpoint.enabled_events=['*'];
 try{await assert.rejects(execute('run',f.c,{client:f.client,secret:'whsec_fixture'}),code('sandbox_endpoint_configuration_mismatch'));assert.equal(fs.existsSync(f.c.runDirectory),false);assert.equal(f.writes.length,0);}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('direct manifests bind both the preassigned run ID and endpoint and cannot resume under another destination',async()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-direct-run-')),f=directFixture(),stop=new Error('fixture_stop_before_provider_write');f.c.runDirectory=directory;f.c.port=await unusedFixturePort();fs.chmodSync(directory,0o700);let attempts=0;
 f.client.customers.create=async()=>{attempts++;throw stop;};
 try{
  await assert.rejects(execute('run',f.c,{client:f.client,secret:'whsec_fixture'}),error=>error===stop);assert.equal(attempts,1);
  const run=JSON.parse(fs.readFileSync(path.join(directory,'run-state.json'),'utf8'));assert.equal(run.id,f.c.runId);assert.equal(run.subject,'sandbox_e2e_'+f.c.runId);assert.equal(run.webhookEndpointId,f.c.webhookEndpointId);assert.equal(run.webhookOrigin,'https://red-xai.com');assert.doesNotThrow(()=>assertRun(run,f.c));
  for(const c of [{...f.c,runId:'e'.repeat(32)},{...f.c,webhookEndpointId:'we_other'},{...f.c,webhookEndpointId:undefined}])assert.throws(()=>assertRun(run,c),code('sandbox_run_mismatch'));
  const wrongRun={...run,id:'e'.repeat(32),subject:'sandbox_e2e_'+'e'.repeat(32)};fs.writeFileSync(path.join(directory,'run-state.json'),JSON.stringify(wrongRun),{mode:0o600});await assert.rejects(execute('run',f.c,{client:f.client,secret:'whsec_fixture'}),code('sandbox_run_mismatch'));assert.equal(attempts,1);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('a new temporary run saves its exact origin and status cannot resume it on a changed or default origin',async()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-tunnel-run-')),f=directFixture(),stop=new Error('fixture_stop_before_provider_write');fs.chmodSync(directory,0o700);Object.assign(f.c,{runDirectory:directory,port:await unusedFixturePort(),allowTemporaryTunnel:true,testWebhookOrigin:'https://locally-owned-fixture.trycloudflare.com'});f.endpoint.url=directEndpointURL(f.c.runId,f.c);f.client.customers.create=async()=>{throw stop;};
 try{
  await assert.rejects(execute('run',f.c,{client:f.client,secret:'whsec_fixture'}),error=>error===stop);const run=JSON.parse(fs.readFileSync(path.join(directory,'run-state.json'),'utf8'));assert.equal(run.webhookOrigin,f.c.testWebhookOrigin);assert.equal((await execute('status',f.c)).productionReady,false);
  await assert.rejects(execute('status',{...f.c,testWebhookOrigin:'https://another-fixture.trycloudflare.com'}),code('sandbox_run_mismatch'));
  await assert.rejects(execute('status',{...f.c,allowTemporaryTunnel:false,testWebhookOrigin:undefined}),code('sandbox_run_mismatch'));
  assert.throws(()=>assertRun({...run,webhookOrigin:undefined},f.c),code('sandbox_run_mismatch'));
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('cleanup ownership rejects unrelated, live, deleted or mismatched fixture customers',()=>{
 const run={id:'a'.repeat(32),customerId:'cus_fixture',subject:'sandbox_e2e_'+'a'.repeat(32)},owned={id:run.customerId,livemode:false,metadata:{redx_e2e:run.id,redx_subject:run.subject}};
 assert.doesNotThrow(()=>assertOwnedCustomer(owned,run));for(const customer of [{...owned,id:'cus_other'},{...owned,livemode:true},{...owned,deleted:true},{...owned,metadata:{redx_e2e:run.id,redx_subject:'other'}},{...owned,metadata:{redx_e2e:'other',redx_subject:run.subject}}])assert.throws(()=>assertOwnedCustomer(customer,run),code('sandbox_customer_ownership_mismatch'));
});
test('cleanup command never deletes an unrelated customer or a clock shared with another customer',async()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-cleanup-'));fs.chmodSync(directory,0o700);
 const c={...configuration(),runDirectory:directory},run={schema:1,id:'b'.repeat(32),subject:'sandbox_e2e_'+'b'.repeat(32),account:ACCOUNT,scenario:'subscription',stage:'created',customerId:'cus_fixture',clockId:'clock_fixture'};
 const file=path.join(directory,'run-state.json'),write=()=>fs.writeFileSync(file,JSON.stringify(run),{mode:0o600});
 let deleted=0;const fixture=readonlyClient();fixture.client.customers.retrieve=async()=>({id:'cus_other',livemode:false,metadata:{redx_e2e:run.id,redx_subject:run.subject}});fixture.client.customers.del=async()=>{deleted++;};
 try{
  write();await assert.rejects(execute('cleanup',c,{client:fixture.client,secret:'whsec_fixture'}),code('sandbox_customer_ownership_mismatch'));assert.equal(deleted,0);
  fixture.client.customers.retrieve=async()=>({id:run.customerId,livemode:false,test_clock:run.clockId,metadata:{redx_e2e:run.id,redx_subject:run.subject}});
  fixture.client.customers.list=async()=>({data:[{id:run.customerId},{id:'cus_unrelated'}],has_more:false});fixture.client.testHelpers={testClocks:{retrieve:async()=>({id:run.clockId,livemode:false,name:'Bridge Sandbox '+run.id}),del:async()=>{deleted++;}}};
  write();await assert.rejects(execute('cleanup',c,{client:fixture.client,secret:'whsec_fixture'}),code('sandbox_clock_has_other_customers'));assert.equal(deleted,0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
function call(port,{method='POST',host='127.0.0.1:'+port,url=HOOK,body=Buffer.from([0xff,0,0x61]),signature='signature-fixture'}={}){
 return new Promise((resolve,reject)=>{const req=http.request({host:'127.0.0.1',port,method,path:url,headers:{host,'stripe-signature':signature,'content-length':body.length}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});req.once('error',reject);req.end(body);});
}
test('loopback listener exposes only the exact webhook route and preserves raw bytes and signature',async()=>{
 const received=[],server=webhookServer({rawWebhook:async(req,res)=>{const bytes=[];for await(const chunk of req)bytes.push(chunk);received.push({raw:Buffer.concat(bytes),signature:req.headers['stripe-signature']});res.writeHead(200);res.end('{}');}},0);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try{for(const options of [{method:'GET'},{host:'untrusted.example'},{url:'/status'},{url:HOOK+'?other=1'},{url:webhookPath(directFixture().c)}])assert.equal(await call(port,options),404);assert.equal(received.length,0);assert.equal(await call(port),200);assert.deepEqual(received,[{raw:Buffer.from([0xff,0,0x61]),signature:'signature-fixture'}]);}finally{await new Promise(resolve=>server.close(resolve));}
});
test('direct listener accepts only its configured preserved path and leaves raw signed bytes unchanged',async()=>{
 const {c}=directFixture(),hook=webhookPath(c),received=[],server=webhookServer({rawWebhook:async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);received.push({url:req.url,raw:Buffer.concat(chunks),signature:req.headers['stripe-signature']});res.writeHead(200);res.end('{}');}},0,c);
 assert.equal(hook,new URL(directEndpointURL(c.runId)).pathname);assert.equal(webhookPath(configuration()),HOOK);assert.throws(()=>webhookServer({},0,{webhookEndpointId:c.webhookEndpointId,runId:'../other'}),code('sandbox_run_id_invalid'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 try{
  for(const options of [{url:HOOK},{url:hook,method:'GET'},{url:hook,host:'red-xai.com'},{url:hook.replace(c.runId,'e'.repeat(32))},{url:hook+'?other=1'},{url:hook+'/'},{url:'/status'},{url:'https://red-xai.com'+hook}])assert.equal(await call(port,options),404);
  assert.equal(received.length,0);assert.equal(await call(port,{url:hook}),200);assert.deepEqual(received,[{url:hook,raw:Buffer.from([0xff,0,0x61]),signature:'signature-fixture'}]);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('status and errors never expose private fields or arbitrary provider strings',()=>{
 const run={stage:'complete',scenario:'subscription',apiKey:'rk_test_private',webhookSecret:'whsec_private',customerEmail:'private@example.invalid',evidence:{grantVerified:true,signedWebhookVerified:true,renewalVerified:true,apiKey:'rk_test_private',signingSecretFingerprint:'a'.repeat(64)}};
 const output=JSON.stringify(publicStatus(run));for(const secret of ['rk_test_private','whsec_private','private@example.invalid'])assert.ok(!output.includes(secret));assert.equal(JSON.parse(output).productionReady,false);assert.equal(safeError({code:'rk_test_private',message:'whsec_private'}),'sandbox_operation_failed');
 assert.throws(()=>publicStatus({...run,stage:'rk_test_private'}),code('sandbox_run_mismatch'));assert.throws(()=>publicStatus({...run,stage:'checkout_pending',sessionId:'cs_test_fixture',checkoutUrl:'https://user:secret@checkout.stripe.com/c/pay/test'}),code('sandbox_checkout_url_invalid'));assert.equal(publicStatus({...run,stage:'checkout_pending',sessionId:'cs_test_fixture',checkoutUrl:'https://checkout.stripe.com/c/pay/cs_test_fixture'}).checkoutUrl,'https://checkout.stripe.com/c/pay/cs_test_fixture');
});
test('configuration requires an absolute private regular file and rejects symlinks',()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-config-')),file=path.join(directory,'config.json');
 try{fs.writeFileSync(file,JSON.stringify(configuration()),{mode:0o600});assert.equal(readConfig(file).account,ACCOUNT);assert.throws(()=>readConfig('relative.json'),code('absolute_private_paths_required'));if(process.platform!=='win32'){fs.chmodSync(file,0o644);assert.throws(()=>readConfig(file),code('private_file_required'));fs.chmodSync(file,0o600);const link=path.join(directory,'linked.json');fs.symlinkSync(file,link);assert.throws(()=>readConfig(link),code('sandbox_reparse_path_forbidden'));}}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('fixture signing material cannot be created inside a Git checkout or worktree',()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-repository-'));try{fs.writeFileSync(path.join(directory,'.git'),'gitdir: fixture-only');const target=path.join(directory,'private-run');assert.throws(()=>privateDirectory(target),code('sandbox_path_outside_git_required'));assert.equal(fs.existsSync(target),false);const config=path.join(directory,'config.json');fs.writeFileSync(config,JSON.stringify(configuration()),{mode:0o600});assert.throws(()=>readConfig(config),code('sandbox_path_outside_git_required'));}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('displayed Checkout must name its saved Sandbox session and can never present a live or foreign session',()=>{
 const id='cs_test_fixture',url='https://checkout.stripe.com/c/pay/'+id;assert.equal(checkoutURL(id,url+'#opaqueStripeFragment'),url+'#opaqueStripeFragment');
 for(const [saved,other]of [[id,'https://checkout.stripe.com/c/pay/cs_live_danger'],['cs_live_danger','https://checkout.stripe.com/c/pay/cs_live_danger'],[id,'https://checkout.stripe.com/c/pay/cs_test_other'],[id,url+'?session_id=cs_live_danger'],[id,'https://checkout.stripe.com:8443/c/pay/'+id],[id,'https://checkout.stripe.com/c/pay/%63s_test_fixture']])assert.throws(()=>checkoutURL(saved,other),code('sandbox_checkout_url_invalid'));
});
test('private config and fixture directories reject reparse ancestors and unverifiable Windows attributes',()=>{
 const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-sandbox-reparse-'));
 try{assert.throws(()=>privateLocation(directory,{platform:'win32',execute:()=>{throw Error('Reparse attribute refusal');}}),code('sandbox_reparse_path_forbidden'));let inspected=false;privateLocation(directory,{platform:'win32',execute:(_command,_args,options)=>{inspected=JSON.parse(options.input).includes(directory);return'OK';}});assert.equal(inspected,true);const actual=path.join(directory,'actual');fs.mkdirSync(actual);const link=path.join(directory,'linked');if(process.platform==='win32')fs.symlinkSync(actual,link,'junction');else fs.symlinkSync(actual,link,'dir');assert.throws(()=>privateDirectory(path.join(link,'run')),code('sandbox_reparse_path_forbidden'));fs.writeFileSync(path.join(actual,'config.json'),JSON.stringify(configuration()),{mode:0o600});assert.throws(()=>readConfig(path.join(link,'config.json')),code('sandbox_reparse_path_forbidden'));}finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('subscription Checkout is created before attaching any test clock',async()=>{
 const run={id:'c'.repeat(32),subject:'sandbox_e2e_'+'c'.repeat(32)},events=[],state={orders:{}},customer={id:'cus_fixture',livemode:false,metadata:{redx_e2e:run.id,redx_subject:run.subject}};
 const client={customers:{create:async params=>{assert.equal(params.test_clock,undefined);events.push('customer_without_clock');return customer;},retrieve:async()=>customer},testHelpers:{testClocks:{create:async()=>{throw Error('Clock must not precede human Checkout');}}}};
 const platform={withBillingState:async fn=>fn(state),dispatch:async()=>({id:'order_fixture'}),getBillingState:async()=>state};const billing={create:async()=>{events.push('checkout');state.orders.order_fixture={sessionId:'cs_test_fixture'};return{url:'https://checkout.stripe.com/c/pay/cs_test_fixture'};}};
 await prepare(client,configuration(),run,platform,{},billing,()=>{});assert.deepEqual(events,['customer_without_clock','checkout']);assert.equal(run.clockId,undefined);assert.equal(run.stage,'checkout_pending');
});
test('a renewal needs the exact new provider period, signed delivery and membership, not an unexpired initial Gold tier',()=>{
 const run={subject:'sandbox_subject',customerId:'cus_fixture',subscriptionId:'sub_fixture',initialPeriodEnd:100,renewalStartedAtMs:500};
 const base={run,expectedEnd:200,binding:{subscriptionId:run.subscriptionId,sub:run.subject,customerId:run.customerId},order:{sub:run.subject,subscriptionId:run.subscriptionId,kind:'subscription',sku:'gold',amountCents:799,periodEndMs:200000},me:{sub:run.subject,tier:'gold',subscriptions:[{providerId:run.subscriptionId,tier:'gold',source:'stripe',untilMs:200000}]},proof:{mode:'sandbox',receivedMs:600}};
 assert.equal(renewalStateMatches(base),true);assert.equal(renewalStateMatches({...base,me:{...base.me,subscriptions:[{providerId:run.subscriptionId,tier:'gold',source:'stripe',untilMs:100000}]}}),false);assert.equal(renewalStateMatches({...base,proof:{mode:'sandbox',receivedMs:400}}),false);assert.equal(renewalStateMatches({...base,proof:null}),false);assert.equal(renewalStateMatches({...base,order:{...base.order,periodEndMs:100000}}),false);assert.equal(renewalStateMatches({...base,binding:{...base.binding,customerId:'cus_other'}}),false);
});

function clockFixture(){
 const run={id:'f'.repeat(32),subject:'sandbox_e2e_'+'f'.repeat(32),customerId:'cus_fixture',sessionId:'cs_test_fixture',scenario:'subscription',stage:'grant_verified',clockStartTime:100};
 const customer={id:run.customerId,livemode:false,test_clock:'clock_fixture',metadata:{redx_e2e:run.id,redx_subject:run.subject}},clock={id:'clock_fixture',livemode:false,name:'Bridge Sandbox '+run.id,frozen_time:100,status:'advancing'},calls=[];
 const client={customers:{retrieve:async()=>customer,list:async()=>({data:[customer],has_more:false}),del:async()=>{calls.push('customer-delete');return{id:run.customerId,deleted:true};}},testHelpers:{testClocks:{retrieve:async()=>clock,create:async()=>{calls.push('clock-create');throw Error('Unexpected create');},del:async()=>{calls.push('clock-delete');return{id:clock.id,deleted:true};}}}};
 return{run,customer,clock,client,calls};
}
test('lost-response recovery reuses the exact attached run clock even when saved start is now stale',async()=>{
 const f=clockFixture();let saved=0;const before=f.run.clockStartTime;assert.equal(await recoverAttachedClock(f.client,f.run,f.customer,()=>saved++),true);assert.equal(f.run.clockId,f.clock.id);assert.equal(f.run.clockStartTime,before);assert.equal(saved,1);assert.deepEqual(f.calls,[]);
});
test('attached clock recovery refuses another run, mode, clock binding or unverifiable saved start',async()=>{
 for(const change of [f=>f.clock.name='Bridge Sandbox other',f=>f.clock.livemode=true,f=>f.clock.id='clock_other',f=>f.customer.metadata.redx_subject='other',f=>f.run.clockId='clock_other',f=>delete f.run.clockStartTime,f=>f.clock.frozen_time=99,f=>f.client.customers.list=async()=>({data:[f.customer,{id:'cus_other'}],has_more:false}),f=>f.client.customers.list=async()=>({data:[f.customer],has_more:true})]){
  const f=clockFixture();change(f);let saved=0;await assert.rejects(recoverAttachedClock(f.client,f.run,f.customer,()=>saved++));assert.equal(saved,0);assert.deepEqual(f.calls,[]);
 }
});
function renewalFixture(){
 const f=clockFixture(),period=Math.floor(Date.now()/1000)+86400;delete f.customer.test_clock;
 const subscription={id:'sub_fixture',livemode:false,customer:f.run.customerId,metadata:{redx_subject:f.run.subject},current_period_end:period};
 f.client.checkout={sessions:{retrieve:async()=>({livemode:false,customer:f.run.customerId,subscription})}};
 return f;
}
test('a stale unattached saved clock start fails closed without changing idempotency arguments',async()=>{
 const f=renewalFixture(),before=f.run.clockStartTime;await assert.rejects(advanceRenewal(f.client,f.run,{}, {},0,()=>{}),code('sandbox_clock_start_stale'));assert.equal(f.run.clockStartTime,before);assert.equal(f.run.clockId,undefined);assert.deepEqual(f.calls,[]);
});
test('renewal resumes after a lost clock-create response without creating another clock or changing saved start',async()=>{
 const f=renewalFixture();delete f.run.clockStartTime;let attempts=0,params,key;
 f.client.testHelpers.testClocks.create=async(value,options)=>{attempts++;params=structuredClone(value);key=options.idempotencyKey;f.customer.test_clock=f.clock.id;f.clock.frozen_time=value.frozen_time;throw Error('Lost create response');};
 await assert.rejects(advanceRenewal(f.client,f.run,{}, {},0,()=>{}),/Lost create response/);assert.equal(f.run.clockId,undefined);const start=f.run.clockStartTime;
 assert.equal(await advanceRenewal(f.client,f.run,{}, {},0,()=>{}),false);assert.equal(attempts,1);assert.equal(f.run.clockId,f.clock.id);assert.equal(f.run.clockStartTime,start);assert.equal(params.frozen_time,start);assert.equal(key,'bridge-e2e-clock:'+f.run.id);
});
test('customer cleanup requires exact delete acknowledgment and a fresh provider tombstone',async()=>{
 for(const variant of ['no-ack','wrong-id','still-present','confirmed']){
  const f=clockFixture();delete f.run.clockStartTime;delete f.run.sessionId;delete f.customer.test_clock;let deleted=false;
  f.client.customers.del=async()=>{deleted=true;return variant==='no-ack'?undefined:{id:variant==='wrong-id'?'cus_other':f.run.customerId,deleted:true};};
  f.client.customers.retrieve=async()=>deleted&&variant==='confirmed'?{id:f.run.customerId,deleted:true}:f.customer;
  if(variant==='confirmed')assert.equal((await cleanup(f.client,f.run,()=>{})).cleaned,true);else{await assert.rejects(cleanup(f.client,f.run,()=>{}),code('sandbox_cleanup_unconfirmed'));assert.notEqual(f.run.cleaned,true);}
 }
});
test('clock cleanup recovers an unsaved attachment and cannot claim success while clock or customer remains',async()=>{
 for(const remaining of ['clock','customer','neither']){
  const f=clockFixture();let deleted=false;f.client.testHelpers.testClocks.del=async()=>{deleted=true;return{id:f.clock.id,deleted:true};};
  f.client.testHelpers.testClocks.retrieve=async()=>{if(deleted&&remaining!=='clock'){const error=Error('Missing');error.statusCode=404;error.code='resource_missing';throw error;}return f.clock;};
  f.client.customers.retrieve=async()=>deleted&&remaining!=='customer'?{id:f.run.customerId,deleted:true}:f.customer;
  if(remaining==='neither'){assert.equal((await cleanup(f.client,f.run,()=>{})).cleaned,true);assert.equal(f.run.clockId,f.clock.id);}else{await assert.rejects(cleanup(f.client,f.run,()=>{}),code('sandbox_cleanup_unconfirmed'));assert.notEqual(f.run.cleaned,true);}
 }
});
test('cleanup resumes a lost delete response only with prior authorization and provider absence proof',async()=>{
 const f=clockFixture();f.run.clockId=f.clock.id;f.run.cleanupAuthorized=f.run.customerId;f.client.customers.retrieve=async()=>({id:f.run.customerId,deleted:true});
 await assert.rejects(cleanup(f.client,f.run,()=>{}),code('sandbox_cleanup_unconfirmed'));assert.notEqual(f.run.cleaned,true);
 f.client.testHelpers.testClocks.retrieve=async()=>{const error=Error('Not authorized');error.statusCode=403;error.code='resource_missing';throw error;};await assert.rejects(cleanup(f.client,f.run,()=>{}));assert.notEqual(f.run.cleaned,true);
 f.client.testHelpers.testClocks.retrieve=async()=>{const error=Error('Missing');error.statusCode=404;error.code='resource_missing';throw error;};assert.equal((await cleanup(f.client,f.run,()=>{})).cleaned,true);assert.deepEqual(f.calls,[]);
 delete f.run.cleanupAuthorized;delete f.run.cleaned;await assert.rejects(cleanup(f.client,f.run,()=>{}),code('sandbox_customer_ownership_mismatch'));assert.notEqual(f.run.cleaned,true);
});
test('lost customer delete response resumes only from an exact prior authorized provider 404',async()=>{
 const f=clockFixture();delete f.customer.test_clock;delete f.run.sessionId;delete f.run.clockStartTime;f.run.cleanupAuthorized=f.run.customerId;
 f.client.customers.retrieve=async()=>{const error=Error('Missing');error.statusCode=404;error.code='resource_missing';throw error;};assert.equal((await cleanup(f.client,f.run,()=>{})).cleaned,true);assert.deepEqual(f.calls,[]);
 delete f.run.cleaned;delete f.run.cleanupAuthorized;await assert.rejects(cleanup(f.client,f.run,()=>{}));assert.notEqual(f.run.cleaned,true);
});
test('an old cleaned flag cannot bypass fresh cleanup verification',async()=>{
 const f=clockFixture();f.run.cleaned=true;f.run.clockId=f.clock.id;f.run.cleanupAuthorized=f.run.customerId;let saved=0;f.client.customers.retrieve=async()=>({id:f.run.customerId,deleted:true});await assert.rejects(cleanup(f.client,f.run,()=>saved++),code('sandbox_cleanup_unconfirmed'));assert.notEqual(f.run.cleaned,true);assert.equal(saved,1);
});
test('clock initialization becomes ready, advances the saved target, then waits for ready-at-target',async()=>{
 const f=clockFixture();f.run.clockId=f.clock.id;f.run.renewalTarget=200;const events=[],deadlines=[];let advanced=false,reads=0;
 f.client.testHelpers.testClocks.retrieve=async()=>{reads++;const phase=advanced?'target':'start';events.push(phase+':'+reads);return{...f.clock,status:reads%2?'advancing':'ready',frozen_time:advanced?200:100};};
 f.client.testHelpers.testClocks.advance=async(id,params,options)=>{events.push('advance');assert.equal(id,f.run.clockId);assert.deepEqual(params,{frozen_time:200});assert.equal(options.idempotencyKey,'bridge-e2e-renewal:'+f.run.id);advanced=true;};
 const wait=async(check,deadline)=>{deadlines.push(deadline);for(let i=0;i<5;i++){const value=await check();if(value)return value;}return null;};
 assert.equal(await advanceOwnedClock(f.client,f.run,300000,{wait,now:()=>1000}),true);assert.deepEqual(events,['start:1','start:2','advance','target:3','target:4']);assert.deepEqual(deadlines,[121000,121000]);assert.equal(f.run.renewalTarget,200);
});
test('clock resume after a lost advance response reuses the same clock and never advances past the saved target',async()=>{
 const f=clockFixture();f.run.clockId=f.clock.id;f.run.renewalTarget=200;let phase='start',advances=0;const options={now:()=>1000,wait:async check=>{for(let i=0;i<5;i++){const current=await check();if(current)return current;}return null;}};
 f.client.testHelpers.testClocks.retrieve=async()=>({...f.clock,status:phase==='busy'?'advancing':'ready',frozen_time:phase==='start'?100:200});
 f.client.testHelpers.testClocks.advance=async()=>{advances++;phase='busy';throw Error('Lost advance response');};
 await assert.rejects(advanceOwnedClock(f.client,f.run,300000,options),/Lost advance response/);phase='done';assert.equal(await advanceOwnedClock(f.client,f.run,300000,options),true);assert.equal(advances,1);assert.equal(f.run.clockId,f.clock.id);assert.equal(f.run.renewalTarget,200);
});
test('clock initialization timeout does not advance or claim renewal proof',async()=>{
 const f=clockFixture();f.run.clockId=f.clock.id;f.run.renewalTarget=200;let advances=0;f.client.testHelpers.testClocks.advance=async()=>{advances++;};
 assert.equal(await advanceOwnedClock(f.client,f.run,2000,{now:()=>1000,wait:async(check,deadline)=>{assert.equal(deadline,2000);assert.equal(await check(),null);return null;}}),false);assert.equal(advances,0);assert.equal(f.run.evidence,undefined);
});
test('every clock readiness poll rechecks exact ownership and mode before accepting progress',async()=>{
 for(const change of [clock=>clock.id='clock_other',clock=>clock.livemode=true,clock=>clock.name='Bridge Sandbox other']){
  const f=clockFixture();f.run.clockId=f.clock.id;f.run.renewalTarget=200;let reads=0,advances=0;f.client.testHelpers.testClocks.retrieve=async()=>{const value={...f.clock,status:'ready',frozen_time:reads++?200:100};if(reads===2)change(value);return value;};f.client.testHelpers.testClocks.advance=async()=>{advances++;};
  await assert.rejects(advanceOwnedClock(f.client,f.run,300000,{now:()=>1000,wait:async check=>check()}),code('sandbox_clock_ownership_mismatch'));assert.equal(advances,1);assert.equal(f.run.evidence,undefined);
 }
});
