'use strict';
// Operator-run integration test. Fixture identity/file storage never establishes
// production account, legal, device-attestation or RedX readiness.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),http=require('node:http'),cp=require('node:child_process');
const {FileStore}=require('./store.cjs'),{createPlatform}=require('./index.cjs'),{createStripeBilling}=require('./stripe.cjs');
const catalog=require('./sandbox-catalog.json');
const ACCOUNT='acct_1USFfGEKYCPRlM5G',HOOK='/redxai-bridge/api/stripe/webhook';
const SAFE_ERROR=Symbol('sandbox-safe-error');
const fail=code=>{const e=new Error(code);e.code=code;e[SAFE_ERROR]=true;throw e;};
const safeError=error=>error?.[SAFE_ERROR]===true?error.code:'sandbox_operation_failed';
function configShape(c){
 if(!c||c.account!==ACCOUNT||c.mode!=='sandbox')fail('sandbox_account_required');
 if(!['subscription','plugin','credits'].includes(c.scenario))fail('sandbox_scenario_required');
 for(const key of ['apiKeyFile','webhookSecretFile','runDirectory'])if(!path.isAbsolute(c[key]||''))fail('absolute_private_paths_required');
 if(['key','apiKey','secret','webhookSecret'].some(key=>key in c))fail('inline_secrets_forbidden');
 if(c.allowSandboxMutations!==true)fail('sandbox_mutations_not_enabled');
 const port=c.port??17784,waitSeconds=c.waitSeconds??1800;
 if(!Number.isSafeInteger(port)||port<1024||port>65535||!Number.isSafeInteger(waitSeconds)||waitSeconds<5||waitSeconds>3600)fail('sandbox_limits_invalid');
 if(c.webhookEndpointId!==undefined&&!/^we_[A-Za-z0-9]+$/.test(c.webhookEndpointId))fail('webhook_endpoint_invalid');
 return{...c,port,waitSeconds};
}
function privateRead(file){const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>1024*1024||(process.platform!=='win32'&&(st.mode&0o077)))fail('private_file_required');return fs.readFileSync(file,'utf8');}
const REPARSE_CHECK="$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($item in $paths) { if ([IO.File]::GetAttributes($item) -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse path refused' } }; [Console]::Out.Write('OK')";
function privateLocation(target,{platform=process.platform,execute=cp.execFileSync}={}){
 if(!path.isAbsolute(target||'')||target.includes('\0'))fail('absolute_private_paths_required');const existing=[];
 for(let current=target;;){
  if(fs.existsSync(path.join(current,'.git')))fail('sandbox_path_outside_git_required');
  let st;try{st=fs.lstatSync(current);}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))fail('sandbox_path_unverifiable');}
  if(st){if(st.isSymbolicLink())fail('sandbox_reparse_path_forbidden');existing.push(current);}
  const parent=path.dirname(current);if(parent===current)break;current=parent;
 }
 if(platform==='win32'){try{const checked=execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',REPARSE_CHECK],{input:JSON.stringify(existing),encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024,stdio:['pipe','pipe','pipe']});if(checked!=='OK')throw Error();}catch{fail('sandbox_reparse_path_forbidden');}}
}
function readConfig(file){privateLocation(file);return configShape(JSON.parse(privateRead(file)));}
function atomicJSON(file,value){const temp=file+'.'+crypto.randomUUID()+'.tmp',fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,file);}
function privateDirectory(directory){privateLocation(directory);fs.mkdirSync(directory,{recursive:true,mode:0o700});const st=fs.lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||(process.platform!=='win32'&&(st.mode&0o077)))fail('private_directory_required');privateLocation(directory);}
function lockRun(directory){const file=path.join(directory,'run.lock');let fd;try{fd=fs.openSync(file,'wx',0o600);}catch(e){if(e.code==='EEXIST')fail('sandbox_run_already_locked');throw e;}fs.writeFileSync(fd,JSON.stringify({pid:process.pid,startedUtc:new Date().toISOString()}));return()=>{fs.closeSync(fd);fs.unlinkSync(file);};}
function assertOwnedCustomer(customer,run){if(customer?.deleted||customer?.livemode!==false||customer.id!==run.customerId||customer.metadata?.redx_e2e!==run.id||customer.metadata?.redx_subject!==run.subject)fail('sandbox_customer_ownership_mismatch');}
function assertRun(run,c){if(run?.schema!==1||run.account!==ACCOUNT||run.scenario!==c.scenario||!/^[a-f0-9]{32}$/.test(run.id)||run.subject!=='sandbox_e2e_'+run.id||run.sessionId!==undefined&&!/^cs_test_[A-Za-z0-9]+$/.test(run.sessionId))fail('sandbox_run_mismatch');}
function checkoutURL(sessionId,value){let url;try{url=new URL(value);}catch{fail('sandbox_checkout_url_invalid');}if(!/^cs_test_[A-Za-z0-9]+$/.test(sessionId||'')||url.protocol!=='https:'||url.host!=='checkout.stripe.com'||url.username||url.password||url.search||url.pathname!=='/c/pay/'+sessionId||url.href.includes('cs_live_'))fail('sandbox_checkout_url_invalid');return url.href;}
async function preflight(client){
 if(client.bridgeLivemode!==false)fail('sandbox_client_required');
 const account=await client.accounts.retrieve();if(account.id!==ACCOUNT)fail('sandbox_account_mismatch');
 const verifier=require('./stripe-prices.cjs').createPriceVerifier({client,prices:catalog.products,livemode:false});
 const {TIERS}=require('./catalog.cjs');for(const tier of TIERS.filter(t=>t.monthlyCents))await verifier.prepare({kind:'subscription',sku:tier.id,amountCents:tier.monthlyCents});
 await verifier.prepare({kind:'plugin',sku:'workflow-checkpoints',amountCents:399});await verifier.prepare({kind:'credits',sku:'credits',amountCents:523});
 return{account:ACCOUNT,livemode:false,catalogVerified:true};
}
async function clientAndSecret(c,reader){
 reader??=require('./protected-secret.cjs');
 const key=await reader.readSandboxKey(c.apiKeyFile,{expectedAccount:ACCOUNT});
 if(typeof key!=='string'||!/^rk_test_[A-Za-z0-9]{16,512}$/.test(key))fail('sandbox_restricted_key_required');
 if(typeof reader.readWebhookSecret!=='function')fail('protected_webhook_reader_required');
 const secret=await reader.readWebhookSecret(c.webhookSecretFile,{expectedAccount:ACCOUNT});
 if(typeof secret!=='string'||!/^whsec_[A-Za-z0-9]{16,512}$/.test(secret))fail('sandbox_webhook_secret_required');
 const StripeClient=require('stripe'),client=new StripeClient(key,{maxNetworkRetries:2});Object.defineProperty(client,'bridgeLivemode',{value:false});
 return{client,secret};
}
async function openFixture(c,run){
 const keyFile=path.join(c.runDirectory,'fixture-license.pem');
 if(!fs.existsSync(keyFile)){const pair=crypto.generateKeyPairSync('ed25519');fs.writeFileSync(keyFile,pair.privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600,flag:'wx'});}
 const store=new FileStore(path.join(c.runDirectory,'fixture-ledger.json'),{development:true});
 const platform=createPlatform({store,production:false,ownerSubjects:['sandbox_unused_owner'],licensePrivateKey:privateRead(keyFile),ipHashKey:'sandbox-fixture-ip-hmac-'+run.id,legalVersion:'sandbox-fixture-v1',legalDocuments:['terms','privacy','agreement'].map(id=>({id,title:'Sandbox fixture '+id,content:'Integration-test fixture only. Not customer agreements.'}))});
 const actor={sub:run.subject,username:'Sandbox fixture',email:'sandbox-fixture@example.invalid',verified:true,ownerVerified:false,mfaUsed:false,reauthAtMs:0};
 if(!run.deviceId){const keys=crypto.generateKeyPairSync('ed25519'),challenge=await platform.dispatch(actor,'/device/challenge');const enrolled=await platform.dispatch(actor,'/device/enroll',{nonce:challenge.nonce,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),signature:crypto.sign(null,Buffer.from('bridge-enroll:'+challenge.nonce),keys.privateKey).toString('base64url'),label:'Isolated Sandbox billing fixture'});run.deviceId=enrolled.deviceId;}
 Object.assign(actor,{deviceId:run.deviceId,deviceVerified:true});
 const me=await platform.dispatch(actor,'/me');if(!me.accepted){const grant=await platform.dispatch(actor,'/legal/read',{version:platform.legalVersion});await platform.dispatch(actor,'/legal/accept',{grant:grant.grant,read:true,agree:true});}
 return{store,platform,actor};
}
function webhookServer(billing,port){
 const server=http.createServer((req,res)=>{const actualPort=server.address()?.port??port,hosts=new Set(['127.0.0.1:'+actualPort,'localhost:'+actualPort]);if(!hosts.has(req.headers.host)||req.method!=='POST'||req.url!==HOOK){res.writeHead(404);res.end();return;}void billing.rawWebhook(req,res);});return server;
}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitUntil(check,deadline){while(Date.now()<deadline){const result=await check();if(result)return result;await pause(1500);}return null;}
const checkoutRequest=scenario=>scenario==='subscription'?{kind:'subscription',tier:'gold'}:scenario==='plugin'?{kind:'plugin',pluginId:'workflow-checkpoints'}:{kind:'credits',amountCents:523};
function publicStatus(run){
 if(!['created','checkout_pending','grant_verified','renewal_pending','refund_pending','complete'].includes(run.stage)||!['subscription','plugin','credits'].includes(run.scenario))fail('sandbox_run_mismatch');
 const status={stage:run.stage,account:ACCOUNT,livemode:false,scenario:run.scenario,fixtureIdentity:true,productionReady:false};
 if(run.stage==='checkout_pending')status.checkoutUrl=checkoutURL(run.sessionId,run.checkoutUrl);
 if(run.evidence){status.evidence={};for(const key of ['grantVerified','signedWebhookVerified','renewalVerified','refundVerified','entitlementRevoked','providerCancellationVerified'])if(run.evidence[key]===true)status.evidence[key]=true;for(const [key,pattern]of [['endpointId',/^we_[A-Za-z0-9]+$/],['signingSecretFingerprint',/^[a-f0-9]{64}$/],['renewalInvoiceId',/^in_[A-Za-z0-9]+$/],['renewalReceiptId',/^inpay_[A-Za-z0-9]+$/]])if(run.evidence[key]!=null){if(!pattern.test(run.evidence[key]))fail('sandbox_evidence_invalid');status.evidence[key]=run.evidence[key];}}
 if(run.cleaned)status.cleaned=true;return status;
}
async function prepare(client,c,run,platform,actor,billing,save){
 if(!run.customerId){
  const customer=await client.customers.create({metadata:{redx_e2e:run.id,redx_subject:run.subject,redx_app:'bridge'}},{idempotencyKey:'bridge-e2e-customer:'+run.id});run.customerId=customer.id;assertOwnedCustomer(customer,run);save();
 }
 const customer=await client.customers.retrieve(run.customerId);assertOwnedCustomer(customer,run);if(run.clockId&&customer.test_clock!==run.clockId)fail('sandbox_clock_ownership_mismatch');
 await platform.withBillingState(b=>{b.customers??={};const old=b.customers[run.subject];if(old&&old!==run.customerId)fail('sandbox_customer_binding_changed');b.customers[run.subject]=run.customerId;});
 if(!run.orderId){const order=await platform.dispatch(actor,'/checkout/quote',checkoutRequest(c.scenario));run.orderId=order.id;save();}
 if(!run.sessionId){const result=await billing.create(actor,run.orderId);const bound=(await platform.getBillingState()).orders[run.orderId];if(!bound?.sessionId)fail('sandbox_session_binding_missing');run.sessionId=bound.sessionId;run.checkoutUrl=checkoutURL(run.sessionId,result.url);run.stage='checkout_pending';save();}
}
async function verifyGrant(platform,actor,run){
 const order=await platform.getOrder(run.orderId),proof=(await platform.getBillingState()).webhookProof;if(!order?.fulfilled||proof?.mode!=='sandbox')return false;
 const me=await platform.dispatch(actor,'/me');if(me.ownerBenefits||me.role!=='user')fail('sandbox_fixture_privilege_changed');
 if(run.scenario==='subscription'&&me.tier!=='gold')return false;
 if(run.scenario==='credits'&&(me.availableCreditsCents!==523||me.creditsDebtCents!==0))return false;
 if(run.scenario==='plugin'){try{await platform.dispatch(actor,'/plugins/license',{pluginId:'workflow-checkpoints'});}catch{return false;}}
 return{grantVerified:true,signedWebhookVerified:true,endpointId:proof.endpointId,signingSecretFingerprint:proof.fingerprint};
}
function renewalStateMatches({run,expectedEnd,binding,order,me,proof}){
 return Number.isSafeInteger(expectedEnd)&&expectedEnd>run.initialPeriodEnd&&Number.isSafeInteger(proof?.receivedMs)&&proof.receivedMs>=run.renewalStartedAtMs&&proof.mode==='sandbox'&&binding?.subscriptionId===run.subscriptionId&&binding.sub===run.subject&&binding.customerId===run.customerId&&order?.sub===run.subject&&order.subscriptionId===run.subscriptionId&&order.kind==='subscription'&&order.sku==='gold'&&order.amountCents===799&&order.periodEndMs===expectedEnd*1000&&me?.sub===run.subject&&me.tier==='gold'&&Array.isArray(me.subscriptions)&&me.subscriptions.some(item=>item.providerId===run.subscriptionId&&item.tier==='gold'&&item.source==='stripe'&&item.untilMs===expectedEnd*1000);
}
async function advanceRenewal(client,run,platform,actor,deadline,save){
 const session=await client.checkout.sessions.retrieve(run.sessionId,{expand:['subscription']});const subscription=typeof session.subscription==='string'?await client.subscriptions.retrieve(session.subscription):session.subscription;
 if(session.livemode!==false||session.customer!==run.customerId||!subscription||subscription.livemode!==false||subscription.customer!==run.customerId||subscription.metadata?.redx_subject!==run.subject)fail('sandbox_subscription_binding_mismatch');
 run.subscriptionId=subscription.id;
 run.initialPeriodEnd??=subscription.current_period_end??subscription.items?.data?.[0]?.current_period_end;if(!Number.isSafeInteger(run.initialPeriodEnd))fail('sandbox_subscription_period_missing');
 run.renewalTarget??=run.initialPeriodEnd+3600;run.renewalStartedAtMs??=Date.now();run.stage='renewal_pending';save();
 if(!run.clockId){
  const customer=await client.customers.retrieve(run.customerId);assertOwnedCustomer(customer,run);
  run.clockStartTime??=Math.floor(Date.now()/1000)+60;if(run.clockStartTime>=run.initialPeriodEnd)fail('sandbox_initial_period_expired');save();
  const clock=await client.testHelpers.testClocks.create({customer:run.customerId,frozen_time:run.clockStartTime,name:'Bridge Sandbox '+run.id},{idempotencyKey:'bridge-e2e-clock:'+run.id});if(clock.livemode!==false)fail('sandbox_provider_mode_mismatch');run.clockId=clock.id;save();
  const attached=await client.customers.retrieve(run.customerId);assertOwnedCustomer(attached,run);if(attached.test_clock!==run.clockId)fail('sandbox_clock_ownership_mismatch');
 }
 let clock=await client.testHelpers.testClocks.retrieve(run.clockId);if(clock.id!==run.clockId||clock.livemode!==false||clock.name!=='Bridge Sandbox '+run.id)fail('sandbox_clock_ownership_mismatch');
 if(clock.status==='ready'&&clock.frozen_time<run.renewalTarget)await client.testHelpers.testClocks.advance(run.clockId,{frozen_time:run.renewalTarget},{idempotencyKey:'bridge-e2e-renewal:'+run.id});
 const ready=await waitUntil(async()=>{const current=await client.testHelpers.testClocks.retrieve(run.clockId);return current.status==='ready'&&current.frozen_time>=run.renewalTarget;},Math.min(deadline,Date.now()+120000));if(!ready)return false;
 const current=await client.subscriptions.retrieve(run.subscriptionId),expectedEnd=current.current_period_end??current.items?.data?.[0]?.current_period_end;if(current.livemode!==false||current.customer!==run.customerId||current.metadata?.redx_subject!==run.subject||current.status!=='active'||!Number.isSafeInteger(expectedEnd)||expectedEnd<=run.initialPeriodEnd)return false;
 const receipt=await waitUntil(async()=>{const state=await platform.getBillingState();for(const binding of Object.values(state.invoiceReceipts||{})){if(binding.subscriptionId!==run.subscriptionId)continue;const order=await platform.getOrder(binding.orderId),me=await platform.dispatch(actor,'/me');if(renewalStateMatches({run,expectedEnd,binding,order,me,proof:state.webhookProof}))return binding;}return null;},deadline);
 if(!receipt)return false;run.refundPaymentIntent=receipt.paymentIntent;run.evidence={...run.evidence,renewalVerified:true,renewalInvoiceId:receipt.invoiceId,renewalReceiptId:receipt.orderId};save();return true;
}
async function refund(client,run,platform,actor,deadline,save){
 if(!run.refundPaymentIntent){const session=await client.checkout.sessions.retrieve(run.sessionId);if(session.livemode!==false||session.customer!==run.customerId||session.client_reference_id!==run.orderId||session.payment_status!=='paid'||typeof session.payment_intent!=='string')fail('sandbox_paid_session_required');run.refundPaymentIntent=session.payment_intent;save();}
 const order=await platform.getOrder(run.orderId),amount=run.scenario==='subscription'?799:order.amountCents;
 const payment=await client.paymentIntents.retrieve(run.refundPaymentIntent);if(payment.id!==run.refundPaymentIntent||payment.livemode!==false||payment.customer!==run.customerId||payment.status!=='succeeded'||payment.amount_received<amount)fail('sandbox_refund_payment_mismatch');
 if(!run.refundId){const result=await client.refunds.create({payment_intent:run.refundPaymentIntent,amount,metadata:{redx_e2e:run.id}},{idempotencyKey:'bridge-e2e-refund:'+run.id});if(result.payment_intent!==run.refundPaymentIntent||result.amount!==amount)fail('sandbox_refund_binding_mismatch');run.refundId=result.id;save();}
 run.stage='refund_pending';save();
 const revoked=await waitUntil(async()=>{const me=await platform.dispatch(actor,'/me');if(run.scenario==='subscription')return me.tier==='free';if(run.scenario==='credits')return me.creditsCents===0&&me.availableCreditsCents===0&&me.creditsDebtCents===0;try{await platform.dispatch(actor,'/plugins/license',{pluginId:'workflow-checkpoints'});return false;}catch(e){return e.code==='device_license_required';}},deadline);
 if(!revoked)return false;
 const currentRefund=await client.refunds.retrieve(run.refundId);if(currentRefund.id!==run.refundId||currentRefund.payment_intent!==run.refundPaymentIntent||currentRefund.amount!==amount||currentRefund.metadata?.redx_e2e!==run.id)fail('sandbox_refund_binding_mismatch');if(['failed','canceled'].includes(currentRefund.status))fail('sandbox_refund_failed');if(currentRefund.status!=='succeeded')return false;
 if(run.subscriptionId){const current=await client.subscriptions.retrieve(run.subscriptionId);if(current.livemode!==false||current.customer!==run.customerId||current.status!=='canceled')fail('sandbox_cancellation_unconfirmed');}
 run.evidence={...run.evidence,refundVerified:true,entitlementRevoked:true,...(run.subscriptionId?{providerCancellationVerified:true}:{})};run.stage='complete';save();return true;
}
async function cleanup(client,run,save){
 const customer=await client.customers.retrieve(run.customerId);
 if(customer.deleted===true&&customer.id===run.customerId&&run.cleanupAuthorized===run.customerId){run.cleaned=true;save();return publicStatus(run);}
 assertOwnedCustomer(customer,run);
 run.cleanupAuthorized=run.customerId;save();
 if(run.clockId){if(customer.test_clock!==run.clockId)fail('sandbox_clock_ownership_mismatch');const clock=await client.testHelpers.testClocks.retrieve(run.clockId);if(clock.id!==run.clockId||clock.livemode!==false||clock.name!=='Bridge Sandbox '+run.id)fail('sandbox_clock_ownership_mismatch');const customers=await client.customers.list({test_clock:run.clockId,limit:100});if(customers.has_more||customers.data?.length!==1||customers.data[0].id!==run.customerId)fail('sandbox_clock_has_other_customers');await client.testHelpers.testClocks.del(run.clockId);}
 else{if(run.sessionId){const session=await client.checkout.sessions.retrieve(run.sessionId);if(session.livemode!==false||session.customer!==run.customerId)fail('sandbox_session_ownership_mismatch');if(session.status==='open')await client.checkout.sessions.expire(run.sessionId);}await client.customers.del(run.customerId);}
 run.cleaned=true;save();return publicStatus(run);
}
async function execute(command,c,{client,secret,output=value=>console.log(JSON.stringify(value))}={}){
 if(!['preflight','run','status','cleanup'].includes(command))fail('sandbox_command_invalid');
 c=configShape(c);
 privateLocation(c.runDirectory);
 const file=path.join(c.runDirectory,'run-state.json');
 if(command==='status'){const run=JSON.parse(privateRead(file));assertRun(run,c);return publicStatus(run);}
 if(!client){({client,secret}=await clientAndSecret(c));}
 const checked=await preflight(client);if(command==='preflight')return{...checked,fixtureIdentity:true,productionReady:false};
 privateDirectory(c.runDirectory);const unlock=lockRun(c.runDirectory);let server;
 try{
  let run;if(fs.existsSync(file))run=JSON.parse(privateRead(file));else{const id=crypto.randomBytes(16).toString('hex');run={schema:1,id,subject:'sandbox_e2e_'+id,account:ACCOUNT,scenario:c.scenario,stage:'created'};}
  assertRun(run,c);const save=()=>atomicJSON(file,run);save();
  if(command==='cleanup'){if(run.cleaned)return publicStatus(run);return cleanup(client,run,save);}
  if(run.cleaned)fail('sandbox_run_already_cleaned');if(run.stage==='complete')return publicStatus(run);
  const {platform,actor}=await openFixture(c,run);save();
  const billing=createStripeBilling({client,platform,webhookSecret:secret,webhookEndpointId:c.webhookEndpointId,livemode:false,prices:catalog.products,portalConfiguration:catalog.portalConfiguration});
  server=webhookServer(billing,c.port);server.headersTimeout=10000;server.requestTimeout=30000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(c.port,'127.0.0.1',resolve);});
  await prepare(client,c,run,platform,actor,billing,save);
  output({...publicStatus(run),listener:'http://127.0.0.1:'+c.port+HOOK,waitingFor:'Genuine signed Stripe delivery after a human completes Sandbox Checkout. Never bypass Checkout security challenges.'});
  const deadline=Date.now()+c.waitSeconds*1000;
  if(!run.evidence?.grantVerified){const grant=await waitUntil(()=>verifyGrant(platform,actor,run),deadline);if(!grant)return publicStatus(run);run.evidence=grant;run.stage='grant_verified';save();}
  if(c.scenario==='subscription'&&!run.evidence?.renewalVerified){if(!await advanceRenewal(client,run,platform,actor,deadline,save))return publicStatus(run);}
  if(!await refund(client,run,platform,actor,deadline,save))return publicStatus(run);
  return publicStatus(run);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));unlock();}
}
if(require.main===module){Promise.resolve().then(()=>execute(process.argv[2],readConfig(process.argv[3]))).then(result=>{console.log(JSON.stringify(result));if(!['complete'].includes(result.stage)&&process.argv[2]==='run')process.exitCode=2;}).catch(error=>{console.error(JSON.stringify({error:safeError(error),livemode:false,productionReady:false}));process.exitCode=1;});}
module.exports={ACCOUNT,HOOK,configShape,readConfig,privateLocation,privateDirectory,checkoutURL,renewalStateMatches,prepare,assertOwnedCustomer,assertRun,preflight,clientAndSecret,webhookServer,publicStatus,safeError,execute};
