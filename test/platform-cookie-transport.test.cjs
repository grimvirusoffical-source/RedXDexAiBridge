'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const {PlatformClient}=require('../app/platform-client.cjs');
const {createNativeAuthenticator,createHandler}=require('../services/bridge-platform/http.cjs');
const ORIGIN='https://red-xai.com',ME=ORIGIN+'/api/accounts/me',NOW=Date.UTC(2026,10,2),SUB='canonical-primary-fixture',COOKIE='fixture_primary_cookie_not_real';
const profile=()=>({account:{id:SUB,username:'fixture',email:'fixture@example.invalid',roles:['owner']},amr:['pwd','call'],expiresMs:NOW+3600000});
const headers=(sub=SUB)=>({'x-bridge-site-session':COOKIE,'x-bridge-site-subject':Buffer.from(sub).toString('base64url')});
const session=()=>({provider:'website-cookie',sub:SUB,refresh:COOKIE,cookieExpiresMs:null,accountExpiresMs:NOW+3600000,expiresAt:NOW+60000});
function client(options={}){return new PlatformClient({credentials:async()=>session(),loadSecret:async()=>null,saveSecret:async()=>{},now:()=>NOW,...options});}
function authenticator(options={}){return createNativeAuthenticator({canonicalCookieTransport:true,now:()=>NOW,request:async()=>Response.json(profile()),...options});}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('canonical transport is disabled by default on client and server, including non-boolean opt-ins',async()=>{
 assert.equal(require('../app/platform-config.cjs').canonicalCookieTransport,false);assert.equal(require('../app/platform-config.cjs').required,false);
 let calls=0;const request=async()=>{calls++;return Response.json(profile());};
 for(const canonicalCookieTransport of [undefined,false,'true',1]){
  const options=canonicalCookieTransport===undefined?{}:{canonicalCookieTransport};
  await assert.rejects(client({request,...options}).raw('/device/challenge',{}, {enroll:true}),/not enabled/);
  assert.equal(await createNativeAuthenticator({request,...options})({headers:headers(),body:{canonicalCookieTransport:true}}),null);
 }
 assert.equal(calls,0);
});
test('enabled client sends only bounded native credentials to the fixed Bridge origin',async()=>{
 let calls=0;const c=client({canonicalCookieTransport:true,request:async(url,options)=>{
  calls++;assert.equal(url,ORIGIN+'/redxai-bridge/api/device/challenge');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.equal(options.credentials,'omit');assert.equal(options.headers['X-Bridge-Site-Session'],COOKIE);assert.equal(Buffer.from(options.headers['X-Bridge-Site-Subject'],'base64url').toString(),SUB);
  for(const name of ['cookie','authorization','X-RedX-Session'])assert.equal(options.headers[name],undefined);assert.equal(url.includes(COOKIE),false);assert.equal(options.body.includes(COOKIE),false);return Response.json({nonce:'fixture_nonce'});
 }});assert.deepEqual(await c.raw('/device/challenge',{}, {enroll:true}),{nonce:'fixture_nonce'});assert.equal(calls,1);
});
test('invalid or expired cookie records never leave the client and do not fall back to another provider',async()=>{
 let calls=0;for(const change of [{refresh:'invalid;cookie'},{refresh:{}},{sub:'bad subject'},{sub:'constructor'},{expiresAt:NOW},{accountExpiresMs:NOW},{cookieExpiresMs:NOW},{cookieExpiresMs:undefined},{provider:'accounts'},{accountExpiresMs:Infinity}]){
  await assert.rejects(client({canonicalCookieTransport:true,credentials:async()=>({...session(),...change}),request:async()=>{calls++;return Response.json({});}}).raw('/device/challenge',{}, {enroll:true}));
 }assert.equal(calls,0);
});
test('server validates the exact canonical subject without inventing owner, email, MFA or freshness privileges',async()=>{
 const seen=[];const auth=authenticator({request:async(url,options)=>{seen.push({url,options});return Response.json(profile());}});
 const actor=await auth({headers:{...headers(),'x-owner':'true','x-mfa-used':'true','x-auth-time':String(NOW)}});
 assert.equal(actor.sub,SUB);assert.equal(actor.verified,true);for(const field of ['ownerVerified','mfaUsed','reauthenticationVerified','recoveryVerified','freshLoginVerified'])assert.equal(actor[field],false);assert.equal(actor.reauthAtMs,0);assert.equal(actor.email_verified,undefined);assert.equal(actor.emailVerified,undefined);
 assert.equal(seen.length,1);assert.equal(seen[0].url,ME);assert.deepEqual(seen[0].options.headers,{accept:'application/json',cookie:'redx_session='+COOKIE});assert.equal(seen[0].options.redirect,'error');assert.equal(seen[0].options.credentials,'omit');assert.equal(seen[0].options.cache,'no-store');
});
test('only the injected trusted adapter can supply privileged capabilities',async()=>{
 let evidence;const auth=authenticator({resolvePrivileges:async value=>{evidence=value;return{ownerVerified:true,mfaUsed:true,reauthenticationVerified:true,reauthAtMs:NOW-1000,recoveryVerified:true,freshLoginVerified:true};}});
 const actor=await auth({headers:headers()});assert.equal(evidence.provider,'website-cookie');assert.equal(evidence.sub,SUB);assert.equal(evidence.credential,COOKIE);assert.deepEqual(evidence.upstream.amr,['pwd','call']);assert.equal(evidence.signal.aborted,false);assert.equal(actor.ownerVerified,true);assert.equal(actor.reauthAtMs,NOW-1000);assert.equal(actor.recoveryVerified,true);
});
test('mixed native providers and Origin-bearing or browser-cookie requests are rejected before upstream access',async()=>{
 let calls=0;const auth=authenticator({request:async()=>{calls++;return Response.json(profile());}});
 for(const [field,value]of Object.entries({authorization:'Bearer fixture','x-redx-session':'fixture',cookie:'redx_session='+COOKIE,origin:ORIGIN}))assert.equal(await auth({headers:{...headers(),[field]:value}}),null);
 for(const field of ['authorization','x-redx-session','cookie','origin'])assert.equal(await auth({headers:{...headers(),[field]:''}}),null);
 assert.equal(calls,0);
});
test('malformed credentials and encoded subject constraints fail before forwarding',async()=>{
 let calls=0;const auth=authenticator({request:async()=>{calls++;return Response.json(profile());}});
 for(const variant of [{'x-bridge-site-session':'invalid;cookie'},{'x-bridge-site-session':[COOKIE,COOKIE]},{'x-bridge-site-session':''},{'x-bridge-site-subject':''},{'x-bridge-site-subject':'bad=padding'},{'x-bridge-site-subject':Buffer.from('bad subject').toString('base64url')},{'x-bridge-site-subject':'a'.repeat(1101)},{'x-bridge-site-subject':Buffer.from([255]).toString('base64url')}])assert.equal(await auth({headers:{...headers(),...variant}}),null);
 assert.equal(await auth({headers:{'x-bridge-site-session':COOKIE}}),null);assert.equal(await auth({headers:{'x-bridge-site-subject':headers()['x-bridge-site-subject']}}),null);assert.equal(calls,0);
});
test('account switching, expiry, pending factors and negative verification/status cannot authenticate',async()=>{
 let adapterCalls=0;const variants=[value=>({...value,account:{...value.account,id:'another_account'}}),value=>({...value,account:{sub:SUB}}),value=>({...value,expiresMs:NOW}),value=>({...value,expiresMs:'future'}),value=>({...value,active:false}),value=>({...value,account:{...value.account,banned:true}}),value=>({...value,account:{...value.account,status:'inactive'}}),value=>({...value,pending:['2fa']}),value=>({...value,account:{...value.account,emailVerified:false}}),value=>({...value,email_verified:false}),value=>({...value,amr:[]}),value=>({...value,amr:['call',{}]})];
 for(const modify of variants){const auth=authenticator({request:async()=>Response.json(modify(profile())),resolvePrivileges:async()=>{adapterCalls++;return{};}});assert.equal(await auth({headers:headers()}),null);}assert.equal(adapterCalls,0);
});
test('non-ASCII opaque subjects are encoded for headers and still compared exactly',async()=>{
 const sub='canonical-测试',auth=authenticator({request:async()=>Response.json({...profile(),account:{...profile().account,id:sub}})});assert.equal((await auth({headers:headers(sub)})).sub,sub);assert.equal(await auth({headers:headers(SUB)}),null);
});
test('redirects, wrong MIME, malformed/oversized responses and upstream errors cannot leak credentials',async()=>{
 const wrongURL=Response.json(profile());Object.defineProperty(wrongURL,'url',{value:'https://untrusted.example/me'});assert.equal(await authenticator({request:async()=>wrongURL})({headers:headers()}),null);
 const redirect=Response.json(profile());Object.defineProperty(redirect,'redirected',{value:true});assert.equal(await authenticator({request:async()=>redirect})({headers:headers()}),null);
 const invalidUTF8=Buffer.from(JSON.stringify(profile()));invalidUTF8[invalidUTF8.indexOf('fixture')]=255;
 for(const response of [new Response('<html>'+COOKIE+'</html>'),new Response(JSON.stringify(profile()),{headers:{'content-type':'application/jsonish'}}),new Response(COOKIE,{headers:{'content-type':'application/json'}}),new Response(invalidUTF8,{headers:{'content-type':'application/json'}}),new Response('x'.repeat(32769),{headers:{'content-type':'application/json'}})])await assert.rejects(authenticator({request:async()=>response})({headers:headers()}),error=>error.message==='Canonical account verification unavailable'&&!error.message.includes(COOKIE));
 await assert.rejects(authenticator({request:async()=>{throw Error(COOKIE);}})({headers:headers()}),error=>error.message==='Canonical account verification unavailable');
 for(const status of [401,403,503])assert.equal(await authenticator({request:async()=>new Response('',{status})})({headers:headers()}),null);
});
test('timed-out canonical work retains its capacity slot and cannot authenticate after a late response',async()=>{
 const late=deferred();let calls=0,signal;const auth=authenticator({canonicalTimeoutMs:10,canonicalMaxInFlight:1,request:async(_url,options)=>{calls++;signal=options.signal;if(calls===1)return late.promise;return Response.json(profile());}});
 await assert.rejects(auth({headers:headers()}),/Canonical account verification unavailable/);assert.equal(signal.aborted,true);await assert.rejects(auth({headers:headers()}),/Canonical account verification unavailable/);assert.equal(calls,1);
 late.resolve(Response.json(profile()));await turn();assert.equal((await auth({headers:headers()})).sub,SUB);assert.equal(calls,2);
});
test('body and trusted-adapter waits are bounded without late privilege activation',async()=>{
 let stream;const hungBody=new Response(new ReadableStream({start(controller){stream=controller;}}),{headers:{'content-type':'application/json'}});const bodyAuth=authenticator({canonicalTimeoutMs:10,canonicalMaxInFlight:1,request:async()=>hungBody});
 await assert.rejects(bodyAuth({headers:headers()}),/Canonical account verification unavailable/);await assert.rejects(bodyAuth({headers:headers()}),/Canonical account verification unavailable/);stream.close();await turn();
 const late=deferred();let calls=0,signal;const auth=authenticator({canonicalTimeoutMs:10,canonicalMaxInFlight:1,resolvePrivileges:async evidence=>{calls++;signal=evidence.signal;if(calls===1)return late.promise;return{};}});
 await assert.rejects(auth({headers:headers()}),/Canonical account verification unavailable/);assert.equal(signal.aborted,true);await assert.rejects(auth({headers:headers()}),/Canonical account verification unavailable/);assert.equal(calls,1);late.resolve({ownerVerified:true,mfaUsed:true});await turn();assert.equal((await auth({headers:headers()})).ownerVerified,false);
});
test('dedicated native channel preserves the real device signature and leaves browser CSRF checks intact',async()=>{
 let saved='',proofs=0;const authenticate=authenticator(),platform={verifyDeviceProof:async(actor,input)=>{const publicKey=JSON.parse(saved).publicKey,canonical=[input.method,input.path,input.bodyHash,String(input.timeMs),input.nonce].join('\n');assert.equal(crypto.verify(null,Buffer.from(canonical),publicKey,Buffer.from(input.signature,'base64url')),true);assert.equal(actor.sub,SUB);proofs++;return actor;},dispatch:async actor=>({sub:actor.sub,owner:actor.ownerVerified})};
 const handler=createHandler({platform,authenticate});
 const c=client({canonicalCookieTransport:true,loadSecret:async()=>saved,saveSecret:async(_name,value)=>{saved=value;},request:async(url,options)=>{
  const req=Readable.from([Buffer.from(options.body)]);req.method=options.method;req.url=new URL(url).pathname;req.headers={host:'red-xai.com',...Object.fromEntries(Object.entries(options.headers).map(([key,value])=>[key.toLowerCase(),value]))};let status,responseHeaders,raw;const res={writeHead:(value,h)=>{status=value;responseHeaders=h;},end:value=>{raw=value;res.writableEnded=true;}};await handler(req,res);return new Response(raw,{status,headers:responseHeaders});
 }});
 const result=await c.call('/legal/read',{ownerVerified:true,reauthAtMs:NOW,version:'fixture'});assert.deepEqual(result,{sub:SUB,owner:false});assert.equal(proofs,1);
 const browser=createHandler({platform,authenticate:async()=>({sub:SUB,verified:true})}),req=Readable.from([Buffer.from('{}')]);req.method='POST';req.url='/redxai-bridge/api/legal/read';req.headers={host:'red-xai.com',origin:ORIGIN,cookie:'redx_session='+COOKIE,'content-type':'application/json'};let status;await browser(req,{writeHead:code=>{status=code;},end:()=>{}});assert.equal(status,403);
});
test('Quick Login and legacy manual authentication retain their existing transports',async()=>{
 for(const provider of ['quick','website']){let calls=0;const c=client({credentials:async()=>({provider,sub:SUB,access:'fixture_quick',refresh:'fixture_legacy'}),request:async(_url,options)=>{calls++;assert.equal(options.headers['X-Bridge-Site-Session'],undefined);assert.equal(options.headers['X-Bridge-Site-Subject'],undefined);if(provider==='quick')assert.equal(options.headers.authorization,'Bearer fixture_quick');else assert.equal(options.headers['X-RedX-Session'],'fixture_legacy');return Response.json({ok:true});}});await c.raw('/device/challenge',{}, {enroll:true});assert.equal(calls,1);}
 const seen=[],auth=createNativeAuthenticator({request:async(url)=>{seen.push(url);return{ok:true,text:async()=>JSON.stringify(url.includes('userinfo')?{issuer:ORIGIN,protocol:'redx-site-session-v1',client_id:'bridge',scope:'bridge.app',email_verified:true,sub:SUB}:{account:{id:SUB}})};}});
 assert.equal((await auth({headers:{authorization:'Bearer rxca_'+'a'.repeat(43)}})).sub,SUB);assert.equal((await auth({headers:{'x-redx-session':'fixture_legacy_session'}})).sub,SUB);assert.deepEqual(seen,[ORIGIN+'/redxai-connect/userinfo','https://api.red-xai.com/v1/accounts/me']);
});
