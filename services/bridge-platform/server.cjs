'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {createPlatform}=require('./index.cjs'),{RedXStore}=require('./store.cjs'),{createHandler,createNativeAuthenticator}=require('./http.cjs'),{PluginMediaStore}=require('./media.cjs');
const {createStripeBilling,stripeClientFromEnvironment}=require('./stripe.cjs');
const {createReadinessProbe,reviewedLegal}=require('./readiness.cjs');
function privateFile(file){if(!path.isAbsolute(file||''))throw Error('An absolute protected configuration path is required');const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||(process.platform!=='win32'&&(st.mode&0o077)))throw Error('Server configuration must be a private regular file');return fs.readFileSync(file,'utf8');}
async function createProductionService(env=process.env){
 const config=JSON.parse(privateFile(env.BRIDGE_CONFIG_FILE));if(!['sandbox','live'].includes(config.paymentsMode))throw Error('Explicit Stripe mode required');const priceCatalog=config.paymentsMode==='sandbox'?require('./sandbox-catalog.json'):JSON.parse(privateFile(config.stripeCatalogFile));if(priceCatalog.mode!==config.paymentsMode)throw Error('Stripe catalog mode mismatch');
 if(!Array.isArray(config.ownerSubjects)||!config.ownerSubjects.length)throw Error('Verified canonical owner subjects have not been provisioned');
 // This adapter must come from the actual deployed account authority. Missing
 // authority blocks deployment; no local flag can substitute for MFA/ownership.
 privateFile(config.authorityModule);const canonicalAuthority=require(config.authorityModule),authority=Object.create(null);
 for(const method of ['resolvePrivileges','revokeBridgeSession','deleteBridgeMembership','deleteAccount','moderate','trustedIP','verifyCSRF','verifyDeploymentReadiness']){
  if(typeof canonicalAuthority[method]!=='function')throw Error('Account authority integration missing: '+method);
  authority[method]=canonicalAuthority[method].bind(canonicalAuthority);
 }
 // Subscription cancellation belongs to this service's verified Stripe ledger.
 // Never accept an unrelated account-module stub as proof of stopped billing.
 let billing=null;
 authority.cancelSubscription=async(...args)=>{if(typeof billing?.cancelSubscription!=='function')throw Error('Verified subscription billing is unavailable');return billing.cancelSubscription(...args);};
 const store=new RedXStore({base:config.redxOrigin,key:privateFile(config.redxCredentialFile).trim(),database:config.database||'redxai_accounts'});
 const legal=require(path.resolve(__dirname,'../../app/legal-content.cjs'));if(config.legalApproved!==true||!reviewedLegal(legal,config.legalApproval)||!reviewedLegal(legal))throw Error('Published agreements and business details have not been reviewed and approved');
 const platform=createPlatform({store,authority,ownerSubjects:config.ownerSubjects,licensePrivateKey:privateFile(config.licenseKeyFile),ipHashKey:privateFile(config.ipHashKeyFile).trim(),production:true,legalVersion:legal.version,legalDocuments:legal.documents});
 if(!/^bpc_[A-Za-z0-9]+$/.test(priceCatalog.portalConfiguration||''))throw Error('An explicit mode-specific Billing Portal configuration is required');
 billing=createStripeBilling({client:stripeClientFromEnvironment(env),platform,prices:priceCatalog.products,portalConfiguration:priceCatalog.portalConfiguration,webhookEndpointId:config.stripeWebhookEndpointId,webhookSecret:privateFile(config.stripeWebhookSecretFile).trim(),livemode:config.paymentsMode==='live',allowLive:env.BRIDGE_ENABLE_LIVE_PAYMENTS==='yes'});
 const media=new PluginMediaStore(config.mediaDirectory);
 const authenticate=createNativeAuthenticator({resolvePrivileges:authority.resolvePrivileges,trustedIP:authority.trustedIP,canonicalCookieTransport:config.canonicalCookieTransport===true});
 const readiness=createReadinessProbe({authority,store,platform,billing,legal,config,clientConfig:require('../../app/platform-config.cjs')});
 const handler=createHandler({platform,authenticate,readiness,verifyCSRF:authority.verifyCSRF,rawWebhook:billing.rawWebhook,extraRoutes:async input=>{
  if(input.route==='/admin/media'){const me=await platform.dispatch(input.actor,'/me');if(me.role!=='owner'||!me.accepted||!input.actor.mfaUsed||!Number.isFinite(input.actor.reauthAtMs)||input.actor.reauthAtMs>Date.now()||Date.now()-input.actor.reauthAtMs>600000)throw Error('Verified owner reauthentication required');const b=Buffer.from(String(input.body.base64||''),'base64');return{image:media.put(b,input.body.mimeType)};}
  if(input.route==='/media/read'){if(!/^\/bridge-platform\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(input.body.image||''))throw Error('Invalid image');const found=media.get(path.basename(input.body.image));if(!found)throw Error('Image not found');return{mimeType:found.type,base64:found.bytes.toString('base64')};}
  return billing.extraRoutes(input);
 }});
 const server=http.createServer(handler);server.headersTimeout=10000;server.requestTimeout=30000;server.maxHeadersCount=40;
 return{server,platform,billing,listen:()=>new Promise((ok,bad)=>{server.once('error',bad);server.listen(config.port||17783,'127.0.0.1',ok);})};
}
if(require.main===module)createProductionService().then(async service=>{await service.listen();console.log('Bridge platform listening on loopback with verified account integration');}).catch(()=>{console.error('Bridge platform configuration or account authority is not ready; no service started');process.exitCode=1;});
module.exports={createProductionService,privateFile};
