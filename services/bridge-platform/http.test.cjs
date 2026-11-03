'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{Readable}=require('node:stream');
const {createHandler,createNativeAuthenticator}=require('./http.cjs');const {dimensions}=require('./media.cjs');
async function call(handler,{method='GET',headers={},body='{}',url='/redxai-bridge/api/me'}={}){const req=Readable.from(method==='POST'?[Buffer.from(body)]:[]);req.method=method;req.headers=headers;req.url=url;let status,result;const res={writeHead:code=>{status=code;},end:raw=>{result=JSON.parse(raw);res.writableEnded=true;}};await handler(req,res);return{status,result};}
test('HTTP never takes privileges from JSON and enforces host/origin/CSRF',async()=>{let got;const platform={verifyDeviceProof:async(a)=>a,dispatch:async(a,route)=>{got={a,route};return{ok:true};}};const handler=createHandler({platform,authenticate:async()=>({sub:'user_01',verified:true,ownerVerified:false})});assert.equal((await call(handler)).status,403);assert.equal((await call(handler,{headers:{host:'red-xai.com'}})).status,200);assert.equal((await call(handler,{method:'POST',headers:{host:'red-xai.com','content-type':'application/json',origin:'https://evil.test'}})).status,403);assert.equal((await call(handler,{method:'POST',headers:{host:'red-xai.com','content-type':'application/json',origin:'https://red-xai.com'}})).status,403);assert.equal((await call(handler,{method:'POST',headers:{host:'red-xai.com','content-type':'application/json'},body:JSON.stringify({ownerVerified:true,verified:true})})).status,200);assert.equal(got.a.ownerVerified,false);});
test('native identity verifier pins realm/client/scope and refuses self-owner headers',async()=>{const auth=createNativeAuthenticator({request:async()=>({ok:true,text:async()=>JSON.stringify({issuer:'https://red-xai.com',protocol:'redx-site-session-v1',client_id:'bridge',scope:'bridge.app',email_verified:true,sub:'user_01'})})});const a=await auth({headers:{authorization:'Bearer rxca_'+'a'.repeat(43),'x-owner':'true'}});assert.equal(a.verified,true);assert.equal(a.ownerVerified,false);const wrong=createNativeAuthenticator({request:async()=>({ok:true,text:async()=>JSON.stringify({issuer:'https://red-xai.com',protocol:'redx-site-session-v1',client_id:'vortex',scope:'vortex.app',email_verified:true,sub:'user_01'})})});assert.equal(await wrong({headers:{authorization:'Bearer rxca_'+'a'.repeat(43)}}),null);});
test('plugin media rejects active formats, malformed headers and oversized image dimensions',()=>{assert.throws(()=>dimensions(Buffer.from('<svg onload="alert(1)"/>'),'image/svg+xml'));assert.throws(()=>dimensions(Buffer.alloc(100),'image/png'));const png=Buffer.alloc(45);Buffer.from('89504e470d0a1a0a','hex').copy(png);png.writeUInt32BE(13,8);png.write('IHDR',12);png.writeUInt32BE(9000,16);png.writeUInt32BE(1,20);png.writeUInt32BE(0,33);png.write('IEND',37);assert.throws(()=>dimensions(png,'image/png'),/dimensions/);});

const LEGAL='http-fixture-v1',POST_HEADERS={host:'red-xai.com','content-type':'application/json'};
const ready=()=>({ready:true,app:'bridge',issuer:'https://red-xai.com',billingMode:'live',legalVersion:LEGAL,checks:Object.fromEntries(require('./readiness.cjs').CHECKS.map(key=>[key,true]))});
const purchase=(handler,route='/checkout/create',body={})=>call(handler,{method:'POST',url:'/redxai-bridge/api'+route,headers:POST_HEADERS,body:JSON.stringify(body)});
function purchaseHandler(readiness){const reached=[];return{reached,handler:createHandler({platform:{legalVersion:LEGAL,verifyDeviceProof:async actor=>({...actor,deviceVerified:true,deviceId:'fixture-device'}),dispatch:async(_actor,route)=>{reached.push(route);return{ok:true};}},authenticate:async()=>({sub:'fixture-user',verified:true}),readiness,extraRoutes:async({route})=>{if(route==='/checkout/create'||route==='/billing/portal'){reached.push(route);return{ok:true};}}})};}

test('new purchase routes fail closed for missing, false and malformed current readiness',async()=>{
 const invalid=[undefined,null,false,[],{ready:true},...['ready','app','issuer','billingMode','legalVersion','checks'].map(key=>{const value=ready();delete value[key];return value;}),{...ready(),ready:false},{...ready(),ready:'true'},{...ready(),issuer:'https://other.example'},{...ready(),legalVersion:'old-version'},{...ready(),billingMode:'sandbox'},{...ready(),checks:{...ready().checks,stripeWebhook:false}},Object.assign(Object.create({ready:true}),{...ready(),ready:undefined})];
 const accessor=ready();Object.defineProperty(accessor,'ready',{get:()=>true});invalid.push(accessor);
 for(const value of invalid){const f=purchaseHandler(value===undefined?undefined:async()=>value);for(const route of ['/checkout/quote','/checkout/create','/purchase/credits']){const response=await purchase(f.handler,route,{readiness:ready(),ready:true,orderId:'fixture-order'});assert.equal(response.status,503);assert.equal(response.result.error,'purchases_unavailable');}assert.deepEqual(f.reached,[]);}
 for(const readiness of [ready(),async()=>{throw Error('Private readiness failure');}]){const f=purchaseHandler(readiness);assert.equal((await purchase(f.handler)).status,503);assert.deepEqual(f.reached,[]);}
});

test('valid current readiness permits purchases and closing readiness immediately stops subsequent purchases',async()=>{
 let current=ready(),calls=0;const f=purchaseHandler(async()=>{calls++;return current;});
 for(const route of ['/checkout/quote','/checkout/create','/purchase/credits'])assert.equal((await purchase(f.handler,route)).status,200);
 assert.equal(f.reached.length,3);current={...ready(),ready:false};assert.equal((await purchase(f.handler)).status,503);assert.equal(f.reached.length,3);current=ready();assert.equal((await purchase(f.handler)).status,200);assert.equal(calls,5);
});

test('a hung readiness evaluation cannot start a purchase after its public deadline',async()=>{
 let complete;const pending=new Promise(resolve=>{complete=resolve;}),f=purchaseHandler(()=>pending);
 const response=await purchase(f.handler);assert.equal(response.status,503);assert.deepEqual(f.reached,[]);complete(ready());await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(f.reached,[]);
});

test('closed purchase readiness leaves webhook, portal, cancellation and account-management routing available',async()=>{
 let readinessCalls=0,webhooks=0;const reached=[],handler=createHandler({platform:{legalVersion:LEGAL,verifyDeviceProof:async actor=>actor,dispatch:async(_actor,route)=>{reached.push(route);return{ok:true};}},authenticate:async()=>({sub:'fixture-user',verified:true}),readiness:async()=>{readinessCalls++;throw Error('Not ready');},extraRoutes:async({route})=>{if(route==='/billing/portal'){reached.push(route);return{ok:true};}},rawWebhook:async(_req,res)=>{webhooks++;res.writeHead(200);res.end('{}');}});
 for(const route of ['/billing/portal','/account/delete','/account/reset','/admin/gift'])assert.equal((await purchase(handler,route,{kind:'subscription',remove:true})).status,200);
 assert.equal((await purchase(handler,'/stripe/webhook')).status,200);assert.equal(webhooks,1);assert.equal(readinessCalls,0);assert.deepEqual(reached,['/billing/portal','/account/delete','/account/reset','/admin/gift']);
});

test('me retains unsigned onboarding but any partial device-proof attempt must fail without fallback',async()=>{
 let proofs=0;const handler=createHandler({platform:{verifyDeviceProof:async()=>{proofs++;throw Error('Should not verify incomplete proof');},dispatch:async()=>({accepted:false})},authenticate:async()=>({sub:'fixture-user',verified:true})});
 assert.deepEqual(await call(handler,{headers:{host:'red-xai.com'}}),{status:200,result:{accepted:false}});
 for(const headers of [{'x-bridge-device':'fixture-device'},{'x-bridge-time':'0'},{'x-bridge-nonce':'fixture-nonce'},{'x-bridge-signature':'fixture-signature'},{'x-bridge-device':'','x-bridge-time':'0','x-bridge-nonce':'n','x-bridge-signature':'s'}]){const response=await call(handler,{headers:{host:'red-xai.com',...headers}});assert.equal(response.status,403);assert.equal(response.result.error,'device_proof_required');}assert.equal(proofs,0);
});

test('real client status preserves enrolled device legal acceptance through the HTTP boundary and rejects forged or replayed proof',async()=>{
 const crypto=require('node:crypto'),{createPlatform}=require('./index.cjs'),{MemoryStore}=require('./store.cjs'),{PlatformClient}=require('../../app/platform-client.cjs');
 const platform=createPlatform({store:new MemoryStore(),ownerSubjects:['fixture-owner'],licensePrivateKey:crypto.generateKeyPairSync('ed25519').privateKey,ipHashKey:'http-fixture-ip-key-at-least-thirty-two',legalVersion:LEGAL,legalDocuments:['terms','privacy','agreement'].map(id=>({id,title:id,content:'Fixture agreement'}))});
 let subject='fixture-user',saved='',lastMe;const handler=createHandler({platform,authenticate:async()=>({sub:subject,verified:true,username:'Fixture'})});
 const request=async(url,options)=>{const u=new URL(url),response=await call(handler,{method:options.method,url:u.pathname+u.search,body:options.body||'',headers:{host:'red-xai.com',...Object.fromEntries(Object.entries(options.headers).map(([key,value])=>[key.toLowerCase(),value]))}});if(u.pathname.endsWith('/me'))lastMe={url,options:structuredClone(options)};return Response.json(response.result,{status:response.status});};
 const client=new PlatformClient({request,credentials:async()=>({provider:'quick',sub:'fixture-user',access:'fixture-token'}),loadSecret:async()=>saved,saveSecret:async(_name,value)=>{saved=value;}});
 assert.equal((await client.status()).accepted,false);const read=await client.call('/legal/read',{version:LEGAL});await client.call('/legal/accept',{grant:read.grant,read:true,agree:true});const me=await client.status();assert.equal(me.accepted,true);assert.match(me.deviceId,/^[a-f0-9]{64}$/);
 const captured=lastMe;assert.equal((await request(captured.url,captured.options)).status,403);
 const bad=structuredClone(captured.options);bad.headers['X-Bridge-Nonce']=crypto.randomBytes(24).toString('base64url');const forged=await request(captured.url,bad);assert.equal(forged.status,403);assert.equal((await forged.json()).error,'device_proof_invalid');
 subject='different-fixture-user';assert.equal((await request(captured.url,captured.options)).status,403);subject='fixture-user';assert.equal((await client.status()).accepted,true);
});
