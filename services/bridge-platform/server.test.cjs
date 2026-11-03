'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const {createRequire}=require('node:module'),{MemoryStore,bridgeDatabaseName}=require('./store.cjs'),billingModule=require('./stripe.cjs');
const {DETAILS,contentHash}=require('./readiness.cjs');
const sourceFile=path.join(__dirname,'server.cjs'),source=fs.readFileSync(sourceFile,'utf8'),nodeRequire=createRequire(sourceFile);
const legalFixture=()=>{
 const legal={version:'factory-fixture-v1',status:'approved',requiresReview:false,documents:['terms','privacy','agreement'].map(id=>({id,title:id,content:'Reviewed test fixture only.'})),businessDetails:Object.fromEntries(DETAILS.map(key=>[key,'Test fixture detail']))};
 legal.review={approved:true,businessDetailsReviewed:true,version:legal.version,reviewedAtMs:Date.now()-1,contentSha256:contentHash(legal)};return legal;
};
function fixture({missingAuthorityMethod,providerMismatch=false,actualDraft=false,database='bridge_platform_v1',missingDatabase=false}={}){
 const scratch=fs.realpathSync(os.tmpdir()),directory=fs.mkdtempSync(path.join(scratch,'redx-platform-factory-')),legal=actualDraft?require('../../app/legal-content.cjs'):legalFixture(),files={};
 function write(name,value){const file=path.join(directory,name);fs.writeFileSync(file,value,{mode:0o600});return file;}
 const keys=crypto.generateKeyPairSync('ed25519'),calls=[],current={id:'sub_factory_fixture',livemode:false,customer:'cus_factory_fixture',status:'active',current_period_end:Math.floor(Date.now()/1000)+86400};
 const client={bridgeLivemode:false,subscriptions:{
  retrieve:async id=>{assert.equal(id,current.id);calls.push('retrieve');return structuredClone(current);},
  cancel:async(id,options)=>{assert.equal(id,current.id);assert.deepEqual(options,{invoice_now:false,prorate:false});calls.push('cancel');current.status='canceled';if(providerMismatch)current.customer='cus_unrelated';return structuredClone(current);}
 }};
 const authorityFile=write('authority.cjs',`'use strict';const authority={calls:[]};
 for(const name of ['resolvePrivileges','revokeBridgeSession','deleteBridgeMembership','deleteAccount','moderate','trustedIP','verifyCSRF','verifyDeploymentReadiness'])authority[name]=function(){throw Error('Native authority is a closed test fixture');};
 authority.cancelSubscription=function(){this.calls.push('external-cancel');throw Error('The external account module must not implement billing cancellation');};
 ${missingAuthorityMethod?'delete authority['+JSON.stringify(missingAuthorityMethod)+'];':''}module.exports=authority;`);
 const config={database,paymentsMode:'sandbox',ownerSubjects:['owner'],authorityModule:authorityFile,redxOrigin:'http://127.0.0.1:17790',redxCredentialFile:write('redx-key','fixture-only-database-key'),licenseKeyFile:write('license-key',keys.privateKey.export({format:'pem',type:'pkcs8'})),ipHashKeyFile:write('ip-key','fixture-only-hash-key-with-at-least-32-characters'),stripeWebhookSecretFile:write('webhook-key','fixture-only-signature-secret'),stripeWebhookEndpointId:'we_factory_fixture',mediaDirectory:path.join(directory,'media'),legalApproved:true,legalApproval:legal.review};
 if(missingDatabase)delete config.database;
 const configFile=write('config.json',JSON.stringify(config));let backingStore;
 class FixtureRedXStore extends MemoryStore{constructor(options){super();this.productionReady=true;this.recordKey='bridge-platform-v1';this.options=options;backingStore=this;}}
 const fixtureRequire=name=>{
  if(name==='./store.cjs')return{RedXStore:FixtureRedXStore,bridgeDatabaseName};
  if(name==='./stripe.cjs')return{...billingModule,stripeClientFromEnvironment:()=>client};
  if(path.resolve(name)===path.resolve(__dirname,'../../app/legal-content.cjs'))return legal;
  return nodeRequire(name);
 };
 const module={exports:{}};vm.runInNewContext(source,{require:fixtureRequire,module,__dirname,process:{platform:process.platform,env:{}},console,Buffer},{filename:sourceFile});
 return{create:()=>module.exports.createProductionService({BRIDGE_CONFIG_FILE:configFile}),calls,current,authority:()=>nodeRequire(authorityFile),authorityLoaded:()=>Object.hasOwn(require.cache,authorityFile),store:()=>backingStore,cleanup(){delete require.cache[authorityFile];const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),scratch);assert.ok(path.basename(resolved).startsWith('redx-platform-factory-'));fs.rmSync(resolved,{recursive:true,force:true});}};
}
async function onboard(platform,sub,extra={}){
 const actor={verified:true,sub,mfaUsed:true,reauthAtMs:Date.now(),...extra},keys=crypto.generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({format:'pem',type:'spki'}).toString(),challenge=await platform.dispatch(actor,'/device/challenge');
 const result=await platform.dispatch(actor,'/device/enroll',{nonce:challenge.nonce,publicKey,signature:crypto.sign(null,Buffer.from('bridge-enroll:'+challenge.nonce),keys.privateKey).toString('base64url'),label:'Factory fixture'});
 const enrolled={...actor,deviceVerified:true,deviceId:result.deviceId},read=await platform.dispatch(enrolled,'/legal/read',{version:platform.legalVersion});await platform.dispatch(enrolled,'/legal/accept',{grant:read.grant,read:true,agree:true});return enrolled;
}
async function paid(platform,user){
 const order=await platform.dispatch(user,'/checkout/quote',{kind:'subscription',tier:'gold'});
 await platform.applyPayment({verified:true,paid:true,eventId:'evt_factory_paid',checkoutSessionId:'cs_factory_paid',orderId:order.id,sub:user.sub,deviceId:user.deviceId,amountCents:799,currency:'usd',subscriptionId:'sub_factory_fixture',periodEndMs:Date.now()+86400000});
 await platform.withBillingState(state=>{state.customers={person:'cus_factory_fixture'};state.subscriptions={sub_factory_fixture:{sub:'person',tier:'gold',customerId:'cus_factory_fixture'}};});
}
test('production factory routes cancellation through its actual billing ledger instead of the external authority stub',async()=>{
 const f=fixture();try{
  const {platform,server}=await f.create();assert.equal(server.listening,false);assert.equal(f.store().options.database,'bridge_platform_v1');const user=await onboard(platform,'person'),owner=await onboard(platform,'owner',{ownerVerified:true});await paid(platform,user);
  const before=await f.store().load();assert.equal((await platform.dispatch(owner,'/admin/gift',{target:user.sub,kind:'subscription',remove:true})).ok,true);
  const after=await f.store().load();assert.deepEqual(f.calls,['retrieve','cancel','retrieve']);assert.deepEqual(f.authority().calls,[]);assert.deepEqual(after.members.person.subscriptions,[]);assert.deepEqual(after.orders,before.orders);assert.ok(Object.values(after.payments).some(payment=>payment.subscriptionId==='sub_factory_fixture'));
 }finally{f.cleanup();}
});
test('factory-wired billing rejects a changed provider identity and preserves active grants',async()=>{
 const f=fixture({providerMismatch:true});try{
  const {platform}=await f.create(),user=await onboard(platform,'person'),owner=await onboard(platform,'owner',{ownerVerified:true});await paid(platform,user);const before=await f.store().load();
  await assert.rejects(platform.dispatch(owner,'/admin/gift',{target:user.sub,kind:'subscription',remove:true}),error=>error.code==='subscription_cancellation_incomplete');
  assert.deepEqual((await f.store().load()).members.person.subscriptions,before.members.person.subscriptions);assert.deepEqual(f.authority().calls,[]);
 }finally{f.cleanup();}
});
test('factory billing wiring does not bypass missing canonical authority or draft legal gates',async()=>{
 for(const options of [{missingAuthorityMethod:'resolvePrivileges'},{actualDraft:true}]){
  const f=fixture(options);try{await assert.rejects(f.create(),options.actualDraft?/agreements and business details/:/Account authority integration missing/);assert.deepEqual(f.calls,[]);}finally{f.cleanup();}
 }
});

test('production factory refuses missing, canonical or unrelated database configuration before constructing a store',async()=>{
 for(const options of [{missingDatabase:true},...[null,'','redx_accounts','redxai_accounts','default','bridge_platform_'].map(database=>({database}))]){
  const f=fixture(options);try{await assert.rejects(f.create(),/explicit isolated Bridge database/);assert.equal(f.authorityLoaded(),false);assert.equal(f.store(),undefined);assert.deepEqual(f.calls,[]);}finally{f.cleanup();}
 }
});
