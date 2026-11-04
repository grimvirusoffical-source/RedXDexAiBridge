'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {CHECKS,READINESS_URL,readinessVerified,createReadinessProbe}=require('../app/platform-readiness.cjs');
const {PlatformClient}=require('../app/platform-client.cjs');
const legalVersion='bridge-2026-11-v1';
const ready=()=>({ready:true,app:'bridge',issuer:'https://red-xai.com',billingMode:'live',legalVersion,checks:Object.fromEntries(CHECKS.map(key=>[key,true]))});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json; charset=utf-8'}});
test('desktop readiness matches every named server check and accepts only own exact live claims',()=>{
 assert.deepEqual(CHECKS,require('../services/bridge-platform/readiness.cjs').CHECKS);
 assert.equal(readinessVerified(ready(),legalVersion),true);
 for(const key of CHECKS)assert.equal(readinessVerified({...ready(),checks:{...ready().checks,[key]:false}},legalVersion),false,key);
 for(const override of [{ready:false},{app:'vortex'},{issuer:'https://example.com'},{billingMode:'sandbox'},{legalVersion:'old'}])assert.equal(readinessVerified({...ready(),...override},legalVersion),false);
 assert.equal(readinessVerified(Object.create(ready()),legalVersion),false);
 assert.equal(readinessVerified({...ready(),checks:Object.create(ready().checks)},legalVersion),false);
 const getter=ready();Object.defineProperty(getter,'ready',{get(){throw Error('Unexpected getter');}});
 assert.equal(readinessVerified(getter,legalVersion),false);
 for(const version of ['',undefined,'v/1','v\n1','v'.repeat(101)])assert.equal(readinessVerified(ready(),version),false);
});
test('public probe omits credentials, fixes origin and returns only public capability data',async()=>{
 const calls=[],probe=createReadinessProbe({legalVersion,request:async(url,options)=>{calls.push({url,options});return response({...ready(),unexpectedPrivateField:'must-not-return'});}});
 const value=await probe();assert.deepEqual(value,ready());assert.equal(Object.hasOwn(value,'unexpectedPrivateField'),false);
 assert.equal(calls[0].url,READINESS_URL);assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.cache,'no-store');assert.equal(calls[0].options.method,'GET');
 assert.deepEqual(calls[0].options.headers,{accept:'application/json'});
 value.checks.ownerMfa=false;assert.equal((await probe()).checks.ownerMfa,true);
});
test('unready, non-200, HTML, wrong-origin and malformed or oversized bodies fail closed',async()=>{
 const cases=[
 ()=>response({...ready(),ready:false}),
 ()=>new Response(JSON.stringify(ready()),{status:201,headers:{'content-type':'application/json'}}),
 ()=>new Response('<html>login</html>',{headers:{'content-type':'text/html'}}),
 ()=>{const r=response(ready());Object.defineProperty(r,'redirected',{value:true});return r;},
 ()=>{const r=response(ready());Object.defineProperty(r,'url',{value:'https://example.com/readiness'});return r;},
 ()=>new Response('{',{headers:{'content-type':'application/json'}}),
 ()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'application/json'}}),
 ()=>response({...ready(),padding:'x'.repeat(17000)})
 ];
 for(const make of cases)await assert.rejects(createReadinessProbe({legalVersion,request:async()=>make()})(),{code:'platform_not_ready'});
});
test('ignored cancellation retains one provider slot and cannot grant late readiness',async()=>{
 let calls=0,complete;
 const request=async()=>{calls++;if(calls===1)return new Promise(resolve=>{complete=resolve;});return response(ready());};
 const probe=createReadinessProbe({legalVersion,request,timeoutMs:20});
 const results=await Promise.allSettled([probe(),probe()]);
 assert.equal(calls,1);assert.ok(results.every(value=>value.status==='rejected'&&value.reason.code==='platform_not_ready'));
 await assert.rejects(probe(),{code:'platform_not_ready'});assert.equal(calls,1);
 complete(response(ready()));await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(await probe(),ready());assert.equal(calls,2);
});
test('production enrollment and operations do not read account or device credentials before readiness',async()=>{
 let identityReads=0,keyReads=0,keyWrites=0;const routes=[];
 const client=new PlatformClient({readinessRequired:true,legalVersion,request:async url=>{routes.push(url);return response({...ready(),checks:{...ready().checks,stripeWebhook:false}});},credentials:async()=>{identityReads++;return{sub:'fixture-user',provider:'quick',access:'fixture-only'};},loadSecret:async()=>{keyReads++;return null;},saveSecret:async()=>{keyWrites++;}});
 for(const action of [()=>client.status(),()=>client.call('/catalog'),()=>client.checkout({kind:'subscription',tier:'gold'}),()=>client.raw('/catalog')])await assert.rejects(action(),{code:'platform_not_ready'});
 assert.equal(identityReads,0);assert.equal(keyReads,0);assert.equal(keyWrites,0);assert.ok(routes.length>0&&routes.every(url=>url===READINESS_URL));
});
test('verified readiness permits signed transport and every later operation rechecks readiness',async()=>{
 let available=true,identityReads=0;const calls=[];
 const client=new PlatformClient({readinessRequired:true,legalVersion,request:async(url,options)=>{calls.push({url,options});return url===READINESS_URL?response({...ready(),ready:available}):response({catalog:true});},credentials:async()=>{identityReads++;return{sub:'fixture-user',provider:'quick',access:'fixture-only'};},loadSecret:async()=>null,saveSecret:async()=>{}});
 assert.deepEqual(await client.raw('/catalog'),{catalog:true});assert.equal(identityReads,1);
 const operation=calls.find(value=>value.url.endsWith('/catalog'));assert.equal(operation.options.headers.authorization,'Bearer fixture-only');assert.equal(typeof operation.options.headers['X-Bridge-Signature'],'string');
 available=false;await assert.rejects(client.raw('/catalog'),{code:'platform_not_ready'});assert.equal(identityReads,1);assert.equal(calls.filter(value=>value.url.endsWith('/catalog')).length,1);
});
