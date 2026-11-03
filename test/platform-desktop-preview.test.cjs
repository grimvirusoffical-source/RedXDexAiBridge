'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {releaseProfile,previewStatus,guardPlatformIPC,createPlatformIPC}=require('../app/platform-release.cjs');
const preview=Object.freeze({releaseProfile:'desktop-preview',required:false,shopEnabled:false,canonicalCookieTransport:false});
test('desktop preview permits only a public planned catalog and rejects every account-platform dependency',async()=>{
 let touched=0;const forbidden=()=>{touched++;throw Error('Unexpected authority access');},handlers=createPlatformIPC({config:preview,status:forbidden,request:forbidden,checkout:forbidden});
 const status=await handlers['platform:status']();assert.equal(status.available,false);assert.equal(status.mode,'desktop-preview');assert.equal(status.catalog.planned,true);assert.equal(status.catalog.tiers.length,7);assert.equal(status.catalog.plugins.length,4);
 for(const key of ['sub','role','tier','creditsCents','availableCreditsCents','ownerBenefits','devices','accepted','legalVersion'])assert.equal(Object.hasOwn(status,key),false,key);
 for(const route of ['/catalog','/me','/checkout/quote','/purchase/credits','/plugins/run','/plugins/checkpoints','/legal/read','/legal/accept','/account/reset','/account/delete','/admin/users','/admin/plugins'])await assert.rejects(handlers['platform:request'](route,{scope:'global',pluginId:'workflow-checkpoints'}),{code:'shop_coming_soon'});
 for(const kind of ['plugin','subscription','credits','portal','stripe-dashboard'])await assert.rejects(handlers['platform:checkout']({kind}),{code:'shop_coming_soon'});
 assert.equal(touched,0);status.catalog.tiers[0].name='spoofed';assert.equal(previewStatus().catalog.tiers[0].name,'Free');
});
test('explicit preview profile rejects contradictory flags and production continues to delegate',async()=>{
 assert.equal(releaseProfile(preview),'desktop-preview');
 for(const change of [{required:true},{shopEnabled:true},{canonicalCookieTransport:true},{required:undefined},{shopEnabled:undefined},{canonicalCookieTransport:undefined}])assert.throws(()=>releaseProfile({...preview,...change}),/Desktop preview/);
 for(const config of [{required:false},{releaseProfile:'unknown',required:true},{required:true,shopEnabled:false}])assert.throws(()=>releaseProfile(config));
 let calls=0;const next=async(...args)=>{calls++;return args[0];},live=createPlatformIPC({config:{releaseProfile:'production',required:true,shopEnabled:true},status:next,request:next,checkout:next});
 assert.equal(await live['platform:status']('status'),'status');assert.equal(await live['platform:request']('/catalog'),'/catalog');assert.equal(await live['platform:checkout']('checkout'),'checkout');assert.equal(calls,3);
});
test('main IPC wrapper authenticates first and blocks future platform channels before their handlers',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8'),start=source.indexOf(' function ipc(name,fn){'),end=source.indexOf(' function defaultClient',start);assert.ok(start>0&&end>start);
 const registered={},calls=[],frame={},web={mainFrame:frame},context={ipcMain:{handle:(name,fn)=>{registered[name]=fn;}},win:{webContents:web},UI:'file:///fixture/index.html',LOGIN_UI:'file:///fixture/sign-in.html',PUBLIC_IPC:new Set(),CI_SMOKE:false,accountAuth:{ensure:async()=>calls.push('authenticate')},platformConfig:preview,guardPlatformIPC};
 vm.runInNewContext(source.slice(start,end),context);context.ipc('platform:future-admin-operation',()=>calls.push('forbidden'));context.ipc('tool:interactive',()=>{calls.push('desktop-tool');return'permitted';});
 const event={sender:web,senderFrame:frame};frame.url=context.UI;
 await assert.rejects(registered['platform:future-admin-operation'](event),{code:'shop_coming_soon'});assert.deepEqual(calls,['authenticate']);
 assert.equal(await registered['tool:interactive'](event),'permitted');assert.deepEqual(calls,['authenticate','authenticate','desktop-tool']);
 frame.url=context.LOGIN_UI;await assert.rejects(registered['platform:future-admin-operation'](event),/Sign in/);assert.equal(calls.length,3);
 await assert.rejects(registered['platform:future-admin-operation']({...event,senderFrame:{url:context.UI}}),/Untrusted IPC sender/);
});
