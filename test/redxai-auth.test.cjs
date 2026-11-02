'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {RedXAIAccount,APP_NUMBER,approvalURL,CLIENT_ID}=require('../app/redxai-auth.cjs');
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});}
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
test('live Red-XAI password login requires server-issued 2FA before it unlocks',async()=>{
 let saved='',hits=[];
 const a=new RedXAIAccount({
  request:async(url,opts)=>{
   hits.push({url,headers:opts.headers,body:opts.body||''});
   if(url.endsWith('/login'))return json({next:'2fa',token:'flow-very-long-opaque-value',methods:['totp','sms']});
   if(url.endsWith('/login/2fa'))return json({token:'website-authenticated-session-value'});
   if(url.endsWith('/me'))return json({account:{id:'account-123',email:'test@red-xai.com'}});
   throw Error('unexpected website endpoint '+url);
  },
  load:async()=>saved,save:async v=>{saved=v;},clear:async()=>{saved='';}
 });
 const result=await a.manualLogin('user@example.org','Example_password123!');
 assert.equal(result.requires2fa,true);
 assert.equal(a.isSignedIn(),false);
 await assert.rejects(a.manual2fa('1234','unknown'),/2FA method/);
 const done=await a.manual2fa('123456','totp');
 assert.equal(done.signedIn,true);
 assert.equal(a.status().account.provider,'website');
 assert.equal(hits.find(h=>h.url.endsWith('/login/2fa')).headers['X-RedX-Flow'],'flow-very-long-opaque-value');
 assert.ok(saved.includes('"provider":"website"'));
 assert.equal(saved.includes('Example_password123!'),false);
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
 let identity='user-a';
 const a=new RedXAIAccount({request:async(url)=>url.endsWith('/login')
  ?json({token:'website-authenticated-session-value'}):json({account:{id:identity}})});
 await a.manualLogin('user-a','A-strong-password');
 identity='user-b';
 await assert.rejects(a.manualLogin('user-b','B-strong-password'),/previous Red-XAI account/);
 assert.equal(a.status().account.sub,'user-a');
});
