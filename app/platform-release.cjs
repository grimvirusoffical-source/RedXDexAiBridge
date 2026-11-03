'use strict';
const PREVIEW='desktop-preview';
const MESSAGE='Shop coming soon. Subscriptions, plugins, Axioms and account management will be enabled in a normal update after server deployment.';
function releaseProfile(config={}){
 if(config.releaseProfile===PREVIEW){
  if(config.required!==false||config.shopEnabled!==false||config.canonicalCookieTransport!==false)throw Error('Desktop preview requires an inactive shop, unenforced account platform and disabled canonical shop transport');
  return PREVIEW;
 }
 if(config.releaseProfile!==undefined&&config.releaseProfile!=='production')throw Error('Unsupported account platform release profile');
 if(config.required!==true||config.shopEnabled===false)throw Error('Production platform enforcement is not enabled. Keep this candidate in preview.');
 return 'production';
}
function comingSoon(){const error=Error(MESSAGE);error.code='shop_coming_soon';return error;}
function previewStatus(){
 const {TIERS,PLUGINS}=require('./platform-preview-catalog.cjs');
 // Public planned prices only. No account identity, balance, license, role,
 // legal acceptance or usage allowance is asserted by this local catalog.
 return{available:false,mode:PREVIEW,message:MESSAGE,catalog:{planned:true,tiers:structuredClone(TIERS),plugins:structuredClone(PLUGINS),currency:{name:'Red-XAI Axioms',symbol:'AX',usdCentsPerUnit:100,minimumTopupCents:501}}};
}
function guardPlatformIPC(config,name,handler){
 if(typeof name!=='string'||typeof handler!=='function')throw Error('A named IPC handler is required');
 const preview=releaseProfile(config)===PREVIEW;
 if(!preview||!name.startsWith('platform:'))return handler;
 return name==='platform:status'?async()=>previewStatus():async()=>{throw comingSoon();};
}
function createPlatformIPC({config,status,request,checkout}={}){
 if([status,request,checkout].some(fn=>typeof fn!=='function'))throw Error('Account platform handlers are required');
 // Every platform request is rejected before any dependency is invoked. This
 // includes reads, local paid-plugin execution and account/staff mutations.
 return Object.freeze({
  'platform:status':guardPlatformIPC(config,'platform:status',status),
  'platform:request':guardPlatformIPC(config,'platform:request',request),
  'platform:checkout':guardPlatformIPC(config,'platform:checkout',checkout)
 });
}
module.exports={PREVIEW,MESSAGE,releaseProfile,previewStatus,guardPlatformIPC,createPlatformIPC};
