'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RedXAIAccount,APP_NUMBER,approvalURL,CLIENT_ID}=require('../app/redxai-auth.cjs');
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
const BASE=1800000000000,COOKIE='canonical-session-cookie-value',FLOW='flow-very-long-opaque-value';
const COOKIE_ATTRS='; Path=/; Secure; HttpOnly; SameSite=Lax';
function fixture(options={}){
 let clock=BASE,saved='',method='totp';const hits=[];
 const request=async(url,opts)=>{
  hits.push({url,...opts});assert.match(url,/^https:\/\/red-xai\.com\/api\/accounts\//);
  assert.equal(opts.credentials,'omit');assert.equal(opts.redirect,'error');assert.equal(opts.headers.origin,'https://red-xai.com');
  if(options.request){const response=await options.request(url,opts);if(response)return response;}
  if(url.endsWith('/login')){const r=json(options.login||{next:'2fa',token:FLOW,methods:{totp:true,call:true}});for(const c of options.loginCookies||[])r.headers.append('set-cookie','redx_session='+c);return r;}
  if(url.endsWith('/login/call'))return json({phone:'private-account-phone',message:'private-service-message'});
  if(url.endsWith('/login/2fa')){method=JSON.parse(opts.body).method;const r=json({});for(const c of options.cookies||[COOKIE+COOKIE_ATTRS+'; Max-Age=600'])r.headers.append('set-cookie','redx_session='+c);return r;}
  if(url.endsWith('/me'))return json(options.profile?options.profile():{account:{id:'account-123',email:'test@red-xai.com'},amr:['pwd',method==='totp'?'otp':'call'],expiresMs:BASE+3600000});
  throw Error('unexpected fixture operation');
 };
 const a=new RedXAIAccount({now:()=>clock,request,load:async()=>saved,save:async value=>{saved=value;},clear:async()=>{saved='';},...options.auth});
 return {a,hits,request,now:()=>clock,advance:ms=>{clock+=ms;},saved:()=>saved,
  login:()=>a.manualLogin('fixture-user','Fixture-password!'),finish:()=>a.manual2fa('123456','totp')};
}
function quickToken(remember=true,scope='bridge.app'){
 return {issuer:'https://red-xai.com',protocol:'redx-site-session-v1',client_id:'bridge',
  scope,token_type:'Bearer',access_token:'rxca_'+('a'.repeat(43)),refresh_token:'rxcr_'+('b'.repeat(43)),
  expires_in:3600,remember_device:remember,user:{sub:'account-123',email_verified:true,email:'test@red-xai.com'}};
}
function quickStart(){
 return {device_code:'d'.repeat(43),user_code:'TEST1234',interval:2,expires_in:300,
  protocol:'redx-site-session-v1',verification_uri:'https://red-xai.com/redxai-connectx#request='+('e'.repeat(43))};
}
function quickUser(){return {sub:'account-123',email:'test@red-xai.com',email_verified:true,
 issuer:'https://red-xai.com',client_id:'bridge',scope:'bridge.app',protocol:'redx-site-session-v1'};}
test('app registry numeric ID 6 is fixed and Quick Login URLs are origin pinned',()=>{
 assert.equal(APP_NUMBER,6);assert.equal(CLIENT_ID,'bridge');
 assert.throws(()=>approvalURL('https://red-xai.com.attacker.test/redxai-connectx#request='+('a'.repeat(43))));
 assert.throws(()=>approvalURL('https://red-xai.com@evil.invalid/redxai-connectx#request='+('a'.repeat(43))));
 assert.throws(()=>approvalURL('http://red-xai.com/redxai-connectx#request='+('a'.repeat(43))));
 assert.match(approvalURL(quickStart().verification_uri),/^https:\/\/red-xai\.com/);
});
test('quick login remains locked until verified, and trust choice governs storage',async()=>{
 let saved='',calls=[];const a=new RedXAIAccount({
  request:async(url,opts)=>{calls.push(url);
   if(url.endsWith('/start'))return json(quickStart());
   if(url.endsWith('/token'))return json(quickToken(false));
   if(url.endsWith('/userinfo'))return json(quickUser());
   throw Error('unexpected endpoint');},
  load:async()=>saved,save:async(v)=>{saved=v;},clear:async()=>{saved='';}
 });
 assert.equal(a.isSignedIn(),false);
 const start=await a.quickStart();
 assert.equal(start.code,'TEST1234');assert.equal(a.isSignedIn(),false);
 assert.equal(a.quickLink(),quickStart().verification_uri);
 const response=await a.quickPoll();
 assert.equal(response.signedIn,true);assert.equal(a.status().account.sub,'account-123');
 assert.equal(saved,'','No trust session must remain memory-only');
 assert.ok(calls.some(x=>x.endsWith('/userinfo')));
});
test('quick login rejects wrong app scopes, even with a structurally valid bearer',async()=>{
 const a=new RedXAIAccount({request:async url=>{
  if(url.endsWith('/start'))return json(quickStart());
  if(url.endsWith('/token'))return json(quickToken(true,'vortex.app'));
  throw Error('should not verify a wrong app');}});
 await a.quickStart();
 await assert.rejects(a.quickPoll(),/invalid app|account/i);
 assert.equal(a.isSignedIn(),false);
});
test('canonical password flow uses object methods and fresh HttpOnly cookie, never a body token',async()=>{
 const f=fixture();assert.deepEqual(await f.login(),{requires2fa:true,methods:['totp','call']});
 assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
 await assert.rejects(f.a.manual2fa('123456','sms'),/2FA method/);
 const result=await f.finish();assert.equal(result.signedIn,true);
 assert.equal(result.account.provider,'website-cookie');assert.equal(f.a.session.access,'');
 const check=f.hits.find(hit=>hit.url.endsWith('/me'));
 assert.equal(check.headers.cookie,'redx_session='+COOKIE);assert.equal(check.headers['x-redx-flow'],undefined);
 assert.equal(f.hits.find(hit=>hit.url.endsWith('/login/2fa')).headers['x-redx-flow'],FLOW);
 assert.equal(JSON.stringify(f.a.status()).includes(COOKIE),false);
 const saved=JSON.parse(f.saved());assert.equal(saved.cookieExpiresMs,BASE+600000);assert.equal(saved.accountExpiresMs,BASE+3600000);
 assert.equal(saved.method,'totp');assert.equal(f.saved().includes('Fixture-password!'),false);
 assert.equal(f.saved().includes(FLOW),false);assert.equal(f.a.session.expiresAt,BASE+60000);
});
test('restored website session is verified on server before opening the Bridge',async()=>{
 const old=JSON.stringify({provider:'website',sub:'account-123',refresh:'website-authenticated-session-value'});
 const a=new RedXAIAccount({load:async()=>old,save:async()=>{},request:async(url,opts)=>{
  assert.ok(url.endsWith('/me'));assert.equal(opts.headers['X-RedX-Session'],'website-authenticated-session-value');
  return json({account:{id:'account-123',email:'test@red-xai.com'}});
 }});
 assert.equal(a.isSignedIn(),false);assert.equal(await a.restore(),true);
 assert.equal(a.isSignedIn(),true);
});
test('a mismatched account ID never inherits an existing Bridge session',async()=>{
 let identity='user-a';const f=fixture({profile:()=>({account:{id:identity},amr:['pwd','otp'],expiresMs:BASE+3600000})});
 await f.login();await f.finish();
 identity='user-b';
 await f.login();await assert.rejects(f.finish(),/previous Red-XAI account/);
 assert.equal(f.a.status().account.sub,'user-a');
});
test('phone verification requires an explicit call and returns no account phone details',async()=>{
 const f=fixture();await f.login();
 await assert.rejects(f.a.manual2fa('123456','call'),/Request a verification call/);
 assert.deepEqual(await f.a.manualCall(),{sent:true});
 assert.equal(f.hits.filter(hit=>hit.url.endsWith('/login/call')).length,1);
 assert.equal(f.hits.find(hit=>hit.url.endsWith('/login/call')).headers['x-redx-flow'],FLOW);
 await assert.rejects(f.a.manualCall(),/new phone verification/);
 assert.equal((await f.a.manual2fa('123456','call')).signedIn,true);
});
test('website-cookie sessions revalidate within sixty seconds and preserve credential expiry metadata',async()=>{
 const f=fixture();await f.login();await f.finish();f.advance(61000);
 assert.equal(f.a.isSignedIn(),false);assert.equal(await f.a.ensure(),true);
 assert.equal(f.hits.filter(hit=>hit.url.endsWith('/me')).length,2);
 assert.equal(f.a.session.expiresAt,BASE+121000);
 assert.equal(JSON.parse(f.saved()).cookieExpiresMs,BASE+600000);
 const restored=new RedXAIAccount({now:f.now,request:f.request,load:async()=>f.saved()});
 assert.equal(await restored.restore(),true);assert.equal(restored.status().account.sub,'account-123');
});
test('session-only cookies stay memory-only and Max-Age takes precedence over Expires',async()=>{
 const transient=fixture({cookies:[COOKIE+COOKIE_ATTRS]});await transient.login();await transient.finish();
 assert.equal(transient.a.isSignedIn(),true);assert.equal(transient.saved(),'');assert.equal(transient.a.session.remember,false);
 const f=fixture({cookies:[COOKIE+COOKIE_ATTRS+'; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=120']});
 await f.login();await f.finish();assert.equal(JSON.parse(f.saved()).cookieExpiresMs,BASE+120000);
 f.advance(120001);let requests=0;
 const restored=new RedXAIAccount({now:f.now,load:async()=>f.saved(),request:async()=>{requests++;throw Error('must not send expired cookie');}});
 assert.equal(await restored.restore(),false);assert.equal(requests,0);
 const expiresOnly=fixture({cookies:[COOKIE+COOKIE_ATTRS+'; Expires='+new Date(BASE+120000).toUTCString()]});
 await expiresOnly.login();await expiresOnly.finish();assert.equal(JSON.parse(expiresOnly.saved()).cookieExpiresMs,BASE+120000);
 const malformedExpires=fixture({cookies:[COOKIE+COOKIE_ATTRS+'; Expires=not-a-date; Max-Age=120']});
 await malformedExpires.login();await malformedExpires.finish();assert.equal(JSON.parse(malformedExpires.saved()).cookieExpiresMs,BASE+120000);
});
test('unsafe or absent authenticated cookies never unlock the app',async t=>{
 const invalid=[[],[COOKIE+'; Path=/; HttpOnly; SameSite=Lax'],[COOKIE+'; Path=/; Secure; SameSite=Lax'],
  [COOKIE+COOKIE_ATTRS+'; Domain=attacker.invalid'],[COOKIE+'; Path=/other; Secure; HttpOnly; SameSite=Lax'],
  [COOKIE+COOKIE_ATTRS+'; Secure'],[COOKIE+COOKIE_ATTRS,COOKIE+COOKIE_ATTRS],
  [COOKIE+COOKIE_ATTRS+'; Max-Age=0'],[COOKIE+COOKIE_ATTRS+'; Max-Age=-1'],
  [COOKIE+COOKIE_ATTRS+'; Expires=Thu, 01 Jan 1970 00:00:00 GMT'],[COOKIE+COOKIE_ATTRS+'; Max-Age=Infinity'],
  [COOKIE+'; Path=/; Secure; HttpOnly; SameSite=None']];
 for(let i=0;i<invalid.length;i++)await t.test('cookie case '+i,async()=>{
  const f=fixture({cookies:invalid[i]});await f.login();await assert.rejects(f.finish(),/cookie|expiry/);assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
 });
 const newline=fixture({request:async url=>{
  if(!url.endsWith('/login/2fa'))return;
  const r=json({});Object.defineProperty(r,'headers',{value:{getSetCookie:()=>['redx_session='+COOKIE+COOKIE_ATTRS+'\r\nX-Bad: value']}});return r;
 }});await newline.login();await assert.rejects(newline.finish(),/cookie/);
});
test('canonical sign-in rejects MFA setup, legacy methods and body-token-only success',async t=>{
 for(const login of [{next:'2fa_setup',token:FLOW,methods:{totp:true}},
  {next:'2fa',token:FLOW,methods:['totp']},{token:COOKIE}])await t.test(login.next||'no second factor',async()=>{
  const f=fixture({login});await assert.rejects(f.login(),/setup|challenge|2FA/);assert.equal(f.a.isSignedIn(),false);
 });
});
test('MFA method hints match public truthiness and its call fallback without wire aliases',async t=>{
 for(const [methods,expected]of [[{totp:1,call:'available'},['totp','call']], [{totp:'enabled',call:0},['totp']],
  [{totp:false,call:1},['call']],[{totp:0,call:0},['call']],[{},['call']],[{app:true,sms:true},['call']]])await t.test(JSON.stringify(methods),async()=>{
  const f=fixture({login:{next:'2fa',token:FLOW,methods}});assert.deepEqual(await f.login(),{requires2fa:true,methods:expected});
  assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
  if(expected[0]==='call'){await f.a.manualCall();await f.a.manual2fa('123456','call');}else await f.finish();
  const posted=JSON.parse(f.hits.find(hit=>hit.url.endsWith('/login/2fa')).body);assert.equal(posted.method,expected[0]);
 });
});
test('server-completed password-only login requires a fresh cookie and pwd profile, and restores the same subject',async()=>{
 const profile=()=>({account:{id:'account-123'},amr:['pwd'],expiresMs:BASE+3600000});
 const f=fixture({login:{},loginCookies:[COOKIE+COOKIE_ATTRS+'; Max-Age=600'],profile});
 assert.equal((await f.login()).signedIn,true);assert.equal(f.a.session.method,'password');
 assert.equal(f.a.session.expiresAt,BASE+60000);assert.equal(f.hits.some(hit=>hit.url.endsWith('/login/2fa')||hit.url.endsWith('/login/call')),false);
 assert.equal(f.a.status().awaiting2fa,false);assert.equal(JSON.parse(f.saved()).method,'password');
 const restored=new RedXAIAccount({now:f.now,request:f.request,load:async()=>f.saved()});assert.equal(await restored.restore(),true);
 assert.equal(restored.session.sub,'account-123');assert.equal(restored.session.method,'password');
 const wrongSubject=new RedXAIAccount({now:f.now,load:async()=>f.saved(),request:async()=>json({account:{id:'different-account'},amr:['pwd'],expiresMs:BASE+3600000})});
 assert.equal(await wrongSubject.restore(),false);
 const transient=fixture({login:{next:null},loginCookies:[COOKIE+COOKIE_ATTRS],profile});assert.equal((await transient.login()).signedIn,true);assert.equal(transient.saved(),'');
});
test('password-only completion cannot bypass a challenge, unsupported state, missing cookie or invalid account',async t=>{
 const profile=()=>({account:{id:'account-123'},amr:['pwd'],expiresMs:BASE+3600000}),cookies=[COOKIE+COOKIE_ATTRS+'; Max-Age=600'];
 const challenge=fixture({login:{next:'2fa',token:FLOW,methods:{totp:1,call:1}},loginCookies:cookies,profile});
 assert.equal((await challenge.login()).requires2fa,true);assert.equal(challenge.a.isSignedIn(),false);assert.equal(challenge.hits.some(hit=>hit.url.endsWith('/me')),false);
 for(const login of [{next:'2fa_setup',token:FLOW,methods:{totp:1}},{next:'unexpected'}, {token:FLOW}, {challenge:FLOW}, {pending:['2fa']}])await t.test(JSON.stringify(login),async()=>{
  const f=fixture({login,loginCookies:cookies,profile});await assert.rejects(f.login(),/setup|challenge/);assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
 });
 const missing=fixture({login:{},profile});await assert.rejects(missing.login(),/fresh authenticated session cookie/);assert.equal(missing.a.isSignedIn(),false);
 for(const body of [{account:{id:'account-123'},amr:[],expiresMs:BASE+3600000},
  {account:{id:'account-123',disabled:true},amr:['pwd'],expiresMs:BASE+3600000},
  {account:{id:'account-123'},amr:['pwd'],expiresMs:BASE+3600000,pending:['2fa']},
  {account:{id:'account-123'},amr:['pwd'],expiresMs:BASE}])await t.test(JSON.stringify(body),async()=>{
  const f=fixture({login:{},loginCookies:cookies,profile:()=>body});await assert.rejects(f.login(),/verify|eligible/);assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
 });
});
test('password-only completion rejects explicit failure and unresolved MFA signals before account activation',async t=>{
 const profile=()=>({account:{id:'account-123'},amr:['pwd'],expiresMs:BASE+3600000}),loginCookies=[COOKIE+COOKIE_ATTRS+'; Max-Age=600'];
 for(const login of [{ok:false},{success:false},{error:'sign-in failed'},{error:{code:'verification_required'}},
  {requires2fa:true},{requires2fa:0},{requires2fa:null},{requires2faSetup:''},{requires2faSetup:[]},
  {twoFactorRequired:'false'},{twoFactorRequired:true}])await t.test(JSON.stringify(login),async()=>{
  const f=fixture({login,loginCookies,profile});await assert.rejects(f.login(),/unfinished sign-in challenge/);
  assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');assert.equal(f.hits.some(hit=>hit.url.endsWith('/me')),false);
 });
 const completed=fixture({login:{ok:true,success:true,error:'',requires2fa:false,requires2faSetup:false,twoFactorRequired:false},loginCookies,profile});
 assert.equal((await completed.login()).signedIn,true);assert.equal(completed.a.session.method,'password');
});
test('identity must confirm password plus selected factor and future server expiry',async t=>{
 const valid={account:{id:'account-123'},amr:['pwd','otp'],expiresMs:BASE+3600000};
 for(const profile of [{...valid,amr:['pwd']},{...valid,amr:['pwd','call']},{...valid,expiresMs:BASE},
  {...valid,expiresMs:undefined},{...valid,account:{id:'account-123',disabled:true}},
  {...valid,account:{id:'account-123',emailVerified:false}},{...valid,pending:['mfa']}])await t.test(JSON.stringify(profile),async()=>{
  const f=fixture({profile:()=>profile});await f.login();await assert.rejects(f.finish(),/verify|eligible/);assert.equal(f.a.isSignedIn(),false);assert.equal(f.saved(),'');
 });
});
test('manual errors expose only status and reject redirected or oversized successful responses',async()=>{
 const rejected=fixture({request:async url=>url.endsWith('/login')?json({error:'private-account-data'},401):null});
 await assert.rejects(rejected.login(),error=>error.message.includes('HTTP 401')&&!error.message.includes('private-account-data'));
 const redirected=fixture({request:async url=>{if(!url.endsWith('/login'))return;const r=json({});Object.defineProperty(r,'url',{value:'https://attacker.invalid/'});return r;}});
 await assert.rejects(redirected.login(),/unsafe/);
 const large=fixture({request:async url=>url.endsWith('/login')?json({value:'x'.repeat(65537)}):null});
 await assert.rejects(large.login(),/too large/);
});
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
test('cancelled or superseded manual requests cannot create a challenge or unlock Bridge',async()=>{
 const entered=deferred(),response=deferred();let first=true;
 const f=fixture({request:async url=>{if(url.endsWith('/login')&&first){first=false;entered.resolve();return response.promise;}}});
 const old=f.login();await entered.promise;f.a.cancelManual();
 const fresh=await f.login();assert.equal(fresh.requires2fa,true);
 response.resolve(json({next:'2fa',token:'stale-flow-that-must-be-discarded',methods:{call:true}}));
 await assert.rejects(old,/cancelled/);assert.deepEqual(f.a.status().secondFactorMethods,['totp','call']);
 const verifyEntered=deferred(),verifyResponse=deferred(),g=fixture({request:async url=>{
  if(url.endsWith('/login/2fa')){verifyEntered.resolve();return verifyResponse.promise;}
 }});
 await g.login();const verify=g.finish();await verifyEntered.promise;g.a.cancelManual();
 const completed=json({});completed.headers.append('set-cookie','redx_session='+COOKIE+COOKIE_ATTRS+'; Max-Age=600');verifyResponse.resolve(completed);
 await assert.rejects(verify,/cancelled/);assert.equal(g.a.isSignedIn(),false);assert.equal(g.saved(),'');
});
test('logout during encrypted persistence clears the late credential and cannot unlock Bridge',async()=>{
 const entered=deferred(),release=deferred();let saved='';
 const f=fixture({auth:{save:async value=>{entered.resolve();await release.promise;saved=value;},clear:async()=>{saved='';}}});
 await f.login();const completion=f.finish();await entered.promise;
 assert.equal(f.a.isSignedIn(),false);const logout=f.a.logout();release.resolve();
 await assert.rejects(completion,/cancelled/);await logout;assert.equal(saved,'');assert.equal(f.a.isSignedIn(),false);
 assert.equal(f.hits.some(hit=>hit.url.endsWith('/logout')),false);
});
test('superseded refresh success and failure cannot overwrite or clear a fresh manual session',async t=>{
 for(const status of [200,401])await t.test('late refresh HTTP '+status,async()=>{
  const entered=deferred(),release=deferred(),f=fixture();
  f.a.request=async(url,opts)=>{
   if(url.endsWith('/redxai-connect/refresh')){entered.resolve();return release.promise;}
   if(url.endsWith('/redxai-connect/userinfo'))return json(quickUser());
   return f.request(url,opts);
  };
  f.a.session={provider:'quick',sub:'account-123',refresh:'rxcr_'+('b'.repeat(43)),access:'rxca_'+('a'.repeat(43)),expiresAt:BASE-1};
  await f.login();const refresh=f.a.refresh();await entered.promise;
  await f.finish();const saved=f.saved();release.resolve(json(status===200?quickToken():{},status));
  await assert.rejects(refresh,/cancelled/);assert.equal(f.a.status().account.provider,'website-cookie');assert.equal(f.saved(),saved);
 });
});
test('refresh begun during fresh-session persistence cannot overwrite or clear its commit',async t=>{
 for(const status of [200,401])await t.test('late persisted refresh HTTP '+status,async()=>{
  const saving=deferred(),saveRelease=deferred(),refreshStarted=deferred(),refreshRelease=deferred();let held=true;
  const f=fixture({auth:{save:async()=>{if(held){held=false;saving.resolve();await saveRelease.promise;}}}});
  f.a.request=async(url,opts)=>{
   if(url.endsWith('/redxai-connect/refresh')){refreshStarted.resolve();return refreshRelease.promise;}
   if(url.endsWith('/redxai-connect/userinfo'))return json(quickUser());
   return f.request(url,opts);
  };
  f.a.session={provider:'quick',sub:'account-123',refresh:'rxcr_'+('b'.repeat(43)),expiresAt:BASE-1};
  await f.login();const completion=f.finish();await saving.promise;const refresh=f.a.refresh();await refreshStarted.promise;
  saveRelease.resolve();await completion;refreshRelease.resolve(json(status===200?quickToken():{},status));
  await assert.rejects(refresh,/cancelled/);assert.equal(f.a.status().account.provider,'website-cookie');
 });
});
test('restored canonical cookies reject changed subject, missing expiry and server revocation',async()=>{
 const f=fixture();await f.login();await f.finish();const saved=f.saved();
 for(const record of [JSON.parse(saved),{...JSON.parse(saved),cookieExpiresMs:null},{...JSON.parse(saved),accountExpiresMs:BASE-1}]){
  const restored=new RedXAIAccount({now:f.now,load:async()=>JSON.stringify(record),request:async()=>json({account:{id:'another-user'},amr:['pwd','otp'],expiresMs:BASE+3600000})});
  assert.equal(await restored.restore(),false);assert.equal(restored.isSignedIn(),false);
 }
 let revoked=false;const g=fixture({request:async url=>revoked&&url.endsWith('/me')?json({},401):null});
 await g.login();await g.finish();revoked=true;g.advance(61000);
 await assert.rejects(g.a.ensure(),/Sign in/);assert.equal(g.a.isSignedIn(),false);
});
test('explicit standalone Accounts issuer remains separate from canonical cookie authentication',async()=>{
 const hits=[],a=new RedXAIAccount({accountsIssuer:'https://accounts.example.org',request:async(url,opts)=>{
  hits.push(url);assert.ok(url.startsWith('https://accounts.example.org/'));assert.equal(opts.headers.cookie,undefined);
  if(url.endsWith('/v1/login'))return json({step:'2fa',challenge:'rxa_h_fixture',method:'app'});
  if(url.endsWith('/v1/login/2fa'))return json({step:'ok',session:'rxa_s_fixture'});
  if(url.endsWith('/oauth2/token'))return json({access_token:'fixture-access-token-long-enough',refresh_token:'fixture-refresh-token-long-enough',expires_in:3600,token_type:'Bearer'});
  if(url.endsWith('/oauth2/userinfo'))return json({sub:'separate-realm-subject',email_verified:true});
  throw Error('unexpected standalone endpoint');
 }});
 assert.equal((await a.manualLogin('fixture-user','Fixture-password!')).requires2fa,true);
 assert.equal((await a.manual2fa('123456','app')).signedIn,true);assert.equal(a.status().account.provider,'accounts');
 assert.equal(hits.length,4);
});
test('background revalidation cannot send a fresh manual session back to the login screen',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const source=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8');
 const body=source.split('const interval=setInterval(async()=>{')[1].split('},30000);')[0];
 const entered=deferred(),release=deferred(),f=fixture();let shown=0;
 f.a.request=async(url,opts)=>{if(url.endsWith('/redxai-connect/refresh')){entered.resolve();return release.promise;}return f.request(url,opts);};
 f.a.session={provider:'quick',sub:'account-123',refresh:'rxcr_'+('b'.repeat(43)),expiresAt:BASE-1};
 const revalidate=vm.runInNewContext('(async()=>{'+body+'})',{accountAuth:f.a,gateway:{},Date:{now:f.now},showLogin:async()=>{shown++;f.a.session=null;}});
 await f.login();const background=revalidate();await entered.promise;await f.finish();release.resolve(json({},401));await background;
 assert.equal(shown,0);assert.equal(f.a.status().account.provider,'website-cookie');
 f.a.request=async()=>json({},401);await revalidate();assert.equal(shown,1);assert.equal(f.a.isSignedIn(),false);
});
test('background refresh started during fresh persistence cannot show the login screen afterward',async t=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
 const body=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8').split('const interval=setInterval(async()=>{')[1].split('},30000);')[0];
 for(const status of [200,401])await t.test('late background HTTP '+status,async()=>{
  const saving=deferred(),saveRelease=deferred(),refreshStarted=deferred(),refreshRelease=deferred();let held=true,shown=0;
  const f=fixture({auth:{save:async()=>{if(held){held=false;saving.resolve();await saveRelease.promise;}}}});
  f.a.request=async(url,opts)=>{
   if(url.endsWith('/redxai-connect/refresh')){refreshStarted.resolve();return refreshRelease.promise;}
   if(url.endsWith('/redxai-connect/userinfo'))return json(quickUser());
   return f.request(url,opts);
  };
  f.a.session={provider:'quick',sub:'account-123',refresh:'rxcr_'+('b'.repeat(43)),expiresAt:BASE-1};
  const revalidate=vm.runInNewContext('(async()=>{'+body+'})',{accountAuth:f.a,gateway:{},Date:{now:f.now},showLogin:async()=>{shown++;f.a.session=null;}});
  await f.login();const completion=f.finish();await saving.promise;const background=revalidate();await refreshStarted.promise;
  saveRelease.resolve();await completion;refreshRelease.resolve(json(status===200?quickToken():{},status));await background;
  assert.equal(shown,0);assert.equal(f.a.status().account.provider,'website-cookie');
 });
});
