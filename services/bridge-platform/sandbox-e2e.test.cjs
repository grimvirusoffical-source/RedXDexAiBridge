'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ACCOUNT,HOOK,configShape,readConfig,privateLocation,privateDirectory,checkoutURL,renewalStateMatches,prepare,assertOwnedCustomer,preflight,clientAndSecret,webhookServer,publicStatus,safeError,execute}=require('./sandbox-e2e.cjs');
const catalog=require('./sandbox-catalog.json'),code=value=>error=>error.code===value;
function configuration(){const temp=fs.realpathSync(os.tmpdir());return{account:ACCOUNT,mode:'sandbox',scenario:'subscription',apiKeyFile:path.join(temp,'private-rak'),webhookSecretFile:path.join(temp,'private-hook'),runDirectory:path.join(temp,'isolated-bridge-run'),allowSandboxMutations:true};}
function readonlyClient(){
 const writes=[],reads=[],registry=new Map();
 for(const [sku,item]of Object.entries(catalog.products))registry.set(item.price,{id:item.price,active:true,livemode:false,currency:'usd',unit_amount:item.amountCents??null,product:{id:item.product,active:true},...(sku==='axioms'?{custom_unit_amount:{minimum:501}}:sku==='workflow-checkpoints'?{}:{recurring:{interval:'month',interval_count:1}})});
 const client={bridgeLivemode:false,accounts:{retrieve:async()=>({id:ACCOUNT})},prices:{retrieve:async id=>{reads.push(id);return registry.get(id);}},customers:{create:()=>{writes.push('customer');throw Error('Unexpected provider mutation');}},checkout:{sessions:{create:()=>{writes.push('checkout');throw Error('Unexpected provider mutation');}}}};
 return{client,writes,reads,registry};
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
 try{for(const options of [{method:'GET'},{host:'untrusted.example'},{url:'/status'},{url:HOOK+'?other=1'}])assert.equal(await call(port,options),404);assert.equal(received.length,0);assert.equal(await call(port),200);assert.deepEqual(received,[{raw:Buffer.from([0xff,0,0x61]),signature:'signature-fixture'}]);}finally{await new Promise(resolve=>server.close(resolve));}
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
