'use strict';
const crypto=require('node:crypto');
const QUICK_ORIGIN='https://red-xai.com';
const QUICK_PATH='/redxai-connect';
const WEBSITE_API='https://api.red-xai.com/v1/accounts/';
const CANONICAL_API=QUICK_ORIGIN+'/api/accounts/';
const SESSION_COOKIE='redx_session';
const COOKIE_TOKEN=/^[A-Za-z0-9_~.+/-]{12,1024}={0,2}$/;
const CLIENT_ID='bridge';
const QUICK_SCOPE='bridge.app';
const APP_NUMBER=6;
const B64_43=/^[A-Za-z0-9_-]{43}$/;
const SAFE_CODE=/^[A-Za-z0-9]{8}$/;
function issuerOrigin(input){
 if(!input)return null;
 const u=new URL(input);
 if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password)throw Error('Red-XAI Accounts issuer must be an HTTPS origin');
 return u.origin;
}
function approvalURL(raw){
 const u=new URL(raw);
 if(u.origin!==QUICK_ORIGIN||u.username||u.password||u.search||
    !['/redxai-connect','/redxai-connect/','/redxai-connectx'].includes(u.pathname)||
    !/^#request=[A-Za-z0-9_-]{43}$/.test(u.hash))throw Error('Quick Login returned an unsafe approval URL');
 return u.href;
}
function requireToken(s,prefix){
 if(typeof s!=='string'||!s.startsWith(prefix)||!B64_43.test(s.slice(prefix.length)))throw Error('Red-XAI returned malformed credentials');
 return s;
}
function isSub(s){return typeof s==='string'&&s.length>0&&s.length<=256&&!/[\x00-\x1f]/.test(s);}
function statusError(operation,status){return Error('Red-XAI '+operation+' could not complete (HTTP '+status+'). Try again or use Quick Login.');}
// This credential belongs only to the first-party website login gate. It is not a
// bridge.app bearer or proof of any owner, administrator or billing permission.
function sessionCookie(headers,now,required=false){
 if(typeof headers?.getSetCookie!=='function')throw Error('Red-XAI session-cookie transport is unavailable');
 const values=headers.getSetCookie();
 if(!Array.isArray(values)||values.length>16||values.some(v=>typeof v!=='string')||values.reduce((n,v)=>n+v.length,0)>16384)throw Error('Invalid Red-XAI session-cookie response');
 let found=null;
 for(const value of values){
  if(typeof value!=='string'||/[\x00-\x1f\x7f]/.test(value))throw Error('Invalid Red-XAI session-cookie response');
  const parts=value.split(';'),first=parts.shift(),equals=first.indexOf('=');
  if(equals<1)throw Error('Invalid Red-XAI session-cookie response');
  if(first.slice(0,equals).trim()!==SESSION_COOKIE)continue;
  if(found)throw Error('Duplicate Red-XAI session cookies');
  const token=first.slice(equals+1).trim(),attrs=new Map();
  for(const part of parts){
   const split=part.indexOf('='),key=(split<0?part:part.slice(0,split)).trim().toLowerCase(),val=split<0?'':part.slice(split+1).trim();
   if(!key||attrs.has(key))throw Error('Invalid Red-XAI session-cookie attributes');
   attrs.set(key,val);
  }
  if(!COOKIE_TOKEN.test(token)||!attrs.has('secure')||attrs.get('secure')!==''||!attrs.has('httponly')||attrs.get('httponly')!==''||
     !['lax','strict'].includes((attrs.get('samesite')||'').toLowerCase())||
     (attrs.has('domain')&&attrs.get('domain').replace(/^\./,'').toLowerCase()!=='red-xai.com')||
     !['/','/api','/api/','/api/accounts','/api/accounts/'].includes(attrs.get('path')))
   throw Error('Red-XAI returned an unsafe session cookie');
  let expires=null;
  // A valid Max-Age takes precedence even when Expires is stale or malformed.
  if(attrs.has('max-age')){
   const raw=attrs.get('max-age'),age=Number(raw);
   if(!/^-?\d+$/.test(raw)||!Number.isSafeInteger(age)||!Number.isSafeInteger(now+age*1000))throw Error('Invalid Red-XAI cookie expiry');
   expires=now+age*1000;
  }else if(attrs.has('expires')){expires=Date.parse(attrs.get('expires'));if(!Number.isSafeInteger(expires))throw Error('Invalid Red-XAI cookie expiry');}
  if(expires!==null&&expires<=now)throw Error('Red-XAI session cookie has expired');
  found={refresh:token,cookieExpiresMs:expires};
 }
 if(required&&!found)throw Error('Red-XAI did not return a fresh authenticated session cookie');
 return found;
}
class RedXAIAccount {
 constructor({request=globalThis.fetch,load=async()=>'',save=async()=>{},clear=async()=>{},accountsIssuer='',onChange=()=>{},beforeActivate=async()=>{},now=()=>Date.now()}={}){
  if(typeof request!=='function')throw Error('HTTPS request transport is required');
  this.request=request;this.load=load;this.save=save;this.clear=clear;
  this.accountsIssuer=issuerOrigin(accountsIssuer);this.onChange=onChange;this.beforeActivate=beforeActivate;this.now=now;
  this.session=null;this.approval=null;this.manualChallenge=null;this.manualJob=null;this.polling=false;this.refreshing=null;
  this.authEpoch=0;this.quickEpoch=0;this.storageQueue=Promise.resolve();
 }
 isSignedIn(){return !!(this.session&&this.session.expiresAt>this.now()+3000);}
 status(){
  return {signedIn:this.isSignedIn(),appNumber:APP_NUMBER,
   account:this.isSignedIn()?{sub:this.session.sub,email:this.session.email,provider:this.session.provider}:null,
   quickLoginAvailable:true,manualLoginAvailable:true,
   awaiting2fa:!!this.manualChallenge,secondFactor:this.manualChallenge?.method||null,
   secondFactorMethods:this.manualChallenge?.methods||[]};
 }
 emit(){this.onChange(this.status());}
 async json(url,{method='POST',body=null,form=false,bearer='',additionalHeaders={}}={}){
  let response;
  const headers={accept:'application/json',...additionalHeaders};
  if(body!==null)headers['content-type']=form?'application/x-www-form-urlencoded':'application/json';
  if(bearer)headers.authorization='Bearer '+bearer;
  try {
   response=await this.request(url,{method,redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(12000),headers,
    ...(body===null?{}:{body:form?new URLSearchParams(body).toString():JSON.stringify(body)})});
  }catch{throw Error('Red-XAI authentication service could not be reached securely');}
  if(response.status>=300&&response.status<400)throw Error('Red-XAI authentication redirected unexpectedly');
  const raw=await response.text();
  if(raw.length>65536)throw Error('Red-XAI authentication response was too large');
  let data={};try{data=raw?JSON.parse(raw):{};}catch{throw Error('Red-XAI authentication did not return JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid Red-XAI authentication response');
  return {status:response.status,data};
 }
 async quickStart(){
  this.cancelManual();this.approval=null;const epoch=++this.quickEpoch;
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const {status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/start',{body:{
   client_id:CLIENT_ID,code_challenge:challenge,code_challenge_method:'S256'}});
  if(epoch!==this.quickEpoch)throw Error('Quick Login approval was cancelled');
  if(status!==200)throw Error(status===400?'Red-XAI must enable the Bridge Quick Login client first':'Quick Login could not start');
  if(!B64_43.test(data.device_code||'')||!SAFE_CODE.test(data.user_code||'')||
     !Number.isInteger(data.interval)||data.interval<2||data.interval>10||
     !Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>300||
     data.protocol!=='redx-site-session-v1')throw Error('Red-XAI returned an invalid approval challenge');
  const url=approvalURL(data.verification_uri);
  this.approval={device:data.device_code,verifier,code:data.user_code,url,
   expiresAt:this.now()+data.expires_in*1000,interval:data.interval*1000,nextPoll:0};
  this.emit();
  return {code:data.user_code,url,interval:data.interval,expiresIn:data.expires_in};
 }
 quickLink(){
  if(!this.approval||this.approval.expiresAt<=this.now())throw Error('Start Quick Login again');
  return approvalURL(this.approval.url);
 }
 async quickPoll(){
  const job=this.approval;
  if(!job||job.expiresAt<=this.now()){this.approval=null;throw Error('Quick Login approval expired');}
  if(this.polling||this.now()<job.nextPoll)return {pending:true,interval:Math.max(2,Math.ceil((job.nextPoll-this.now())/1000))};
  this.polling=true;job.nextPoll=this.now()+job.interval;
  try{
   const {status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/token',{body:{
    client_id:CLIENT_ID,device_code:job.device,code_verifier:job.verifier}});
   if(this.approval!==job)throw Error('Quick Login approval was cancelled');
   if(status===428)return {pending:true,interval:job.interval/1000};
   if(status===429){job.interval=Math.min(job.interval+1000,10000);job.nextPoll=this.now()+job.interval;return {pending:true,interval:job.interval/1000};}
   if(status!==200){this.approval=null;throw Error('Quick Login approval was denied, expired or not enabled');}
   await this.acceptQuick(data,'',()=>{if(this.approval!==job)throw Error('Quick Login approval was cancelled');},true);
   this.approval=null;this.emit();
   return {signedIn:true,account:this.status().account};
  }finally{this.polling=false;}
 }
 cancelQuick(){this.quickEpoch++;this.approval=null;this.emit();return {cancelled:true};}
 async verifyQuick(access,expected){
  const {status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/userinfo',{method:'GET',bearer:access});
  if(status!==200||data.protocol!=='redx-site-session-v1'||data.issuer!==QUICK_ORIGIN||
     data.client_id!==CLIENT_ID||data.scope!==QUICK_SCOPE||data.sub!==expected||data.email_verified!==true)
   throw Error('Red-XAI could not verify this Bridge account');
  return data;
 }
 async acceptQuick(data,expected='',guard=()=>{},fresh=false){
  if(data.issuer!==QUICK_ORIGIN||data.protocol!=='redx-site-session-v1'||data.client_id!==CLIENT_ID||
     data.scope!==QUICK_SCOPE||String(data.token_type).toLowerCase()!=='bearer'||
     !isSub(data.user?.sub)||data.user?.email_verified!==true||
     !Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>3600)
   throw Error('Red-XAI returned credentials for an invalid app or account');
  requireToken(data.access_token,'rxca_');requireToken(data.refresh_token,'rxcr_');
  if(expected&&expected!==data.user.sub)throw Error('The Red-XAI account changed during refresh');
  const info=await this.verifyQuick(data.access_token,data.user.sub);
  guard();if(fresh)this.authEpoch++;
  await this.activate({provider:'quick',sub:data.user.sub,email:info.email||data.user.email||'',
   access:data.access_token,refresh:data.refresh_token,expiresAt:this.now()+data.expires_in*1000,
   remember:data.remember_device===true},expected,guard);
 }
 async manualLogin(login,password){
  if(typeof login!=='string'||!login.trim()||login.length>254||typeof password!=='string'||!password||password.length>665)
   throw Error('Enter a valid email or username and password');
  this.cancelManual();this.cancelQuick();
  const job={controller:new AbortController(),expiresAt:this.now()+300000,busy:false};
  this.manualJob=job;job.timer=setTimeout(()=>{if(this.manualJob===job)this.cancelManual();},300000);job.timer.unref?.();
  if(!this.accountsIssuer)return this.websiteLogin(login.trim(),password,job);
  const {status,data}=await this.json(this.accountsIssuer+'/v1/login',{body:{app:CLIENT_ID,login:login.trim(),password}});
  this.assertManual(job);
  if(status!==200)throw statusError('manual sign-in',status);
  if(data.step==='2fa'){
   if(typeof data.challenge!=='string'||!data.challenge.startsWith('rxa_h_')||data.challenge.length>100||
      !['app','phone'].includes(data.method))throw Error('Invalid Red-XAI second-factor challenge');
   this.manualChallenge={challenge:data.challenge,method:data.method,job};
   this.emit();return {requires2fa:true,method:data.method};
  }
  return this.acceptManualLogin(data,job);
 }
 async verifyWebsite(token,expected=''){
  if(typeof token!=='string'||token.length<12||token.length>512||/[\r\n]/.test(token))
   throw Error('Invalid saved Red-XAI account credential');
  const {status,data}=await this.json(WEBSITE_API+'me',{method:'GET',
   additionalHeaders:{'X-RedX-Session':token}});
  const account=data.account;
  const sub=account?.id||account?.sub;
  if(status!==200||!isSub(sub)||(expected&&sub!==expected))
   throw Error('Red-XAI account session is invalid, expired or belongs to another user');
  return {sub,email:typeof account.email==='string'?account.email:''};
 }
 cancelManual(){
  const job=this.manualJob;this.manualJob=null;this.manualChallenge=null;this.authEpoch++;
  if(job){clearTimeout(job.timer);job.controller.abort();job.cookie=null;}
  this.emit();return {cancelled:true};
 }
 assertManual(job){
  if(!job||this.manualJob!==job||job.controller.signal.aborted||job.expiresAt<=this.now())
   throw Error('Manual sign-in was cancelled or expired; start again');
 }
 finishManual(job){
  this.assertManual(job);clearTimeout(job.timer);this.manualJob=null;this.manualChallenge=null;job.cookie=null;
 }
 async websiteJSON(operation,{body=null,job=null,credential=null,freshCookie=false}={}){
  if(!['login','login/call','login/2fa','me'].includes(operation))throw Error('Unsupported Red-XAI account operation');
  if(job)this.assertManual(job);
  const url=CANONICAL_API+operation,headers={accept:'application/json',origin:QUICK_ORIGIN};
  if(body!==null)headers['content-type']='application/json';
  const cookie=credential||job?.cookie;
  if(cookie){if(!COOKIE_TOKEN.test(cookie.refresh))throw Error('Invalid saved Red-XAI session cookie');headers.cookie=SESSION_COOKIE+'='+cookie.refresh;}
  if(operation==='login/call'||operation==='login/2fa')headers['x-redx-flow']=this.manualChallenge?.challenge;
  let response;
  try{
   response=await this.request(url,{method:body===null?'GET':'POST',headers,
    ...(body===null?{}:{body:JSON.stringify(body)}),credentials:'omit',redirect:'error',cache:'no-store',
    signal:job?AbortSignal.any([job.controller.signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000)});
  }catch{if(job)this.assertManual(job);throw Error('Red-XAI authentication service could not be reached securely');}
  if(job)this.assertManual(job);
  if(!response||response.redirected||(response.url&&response.url!==url)||!Number.isInteger(response.status)||response.status<100||response.status>599)
   throw Error('Red-XAI authentication returned an unsafe response');
  if(response.status>=300&&response.status<400)throw Error('Red-XAI authentication redirected unexpectedly');
  // Error responses can contain private account details. Only their status is used.
  if(response.status!==200){await response.body?.cancel().catch(()=>{});return {status:response.status,data:{},cookie:null};}
  let raw='';
  if(response.body){
   if(typeof response.body.getReader!=='function')throw Error('Unsupported Red-XAI authentication response');
   const reader=response.body.getReader(),chunks=[];let length=0;
   try{while(true){const item=await reader.read();if(item.done)break;length+=item.value.byteLength;if(length>65536){await reader.cancel().catch(()=>{});throw Error('Red-XAI authentication response was too large');}chunks.push(Buffer.from(item.value));}raw=Buffer.concat(chunks).toString('utf8');}
   catch(error){if(job)this.assertManual(job);throw Error(error.message==='Red-XAI authentication response was too large'?error.message:'Red-XAI authentication response could not be read securely');}
   finally{reader.releaseLock();}
  }
  if(job)this.assertManual(job);
  let data={};try{data=raw?JSON.parse(raw):{};}catch{throw Error('Red-XAI authentication did not return JSON');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid Red-XAI authentication response');
  const updated=sessionCookie(response.headers,this.now(),freshCookie);
  if(freshCookie&&updated?.refresh===job?.cookie?.refresh)throw Error('Red-XAI did not rotate the authenticated session cookie');
  return {status:response.status,data,cookie:updated};
 }
 async websiteLogin(login,password,job){
  try{
   const {status,data,cookie}=await this.websiteJSON('login',{body:{login,password},job});
   if(status!==200)throw statusError('manual sign-in',status);
   if(data.next==='2fa_setup')throw Error('The Red-XAI account service requested two-factor setup; password sign-in was not completed');
   if(data.next==='2fa'){
    if(typeof data.token!=='string'||data.token.length<12||data.token.length>512||/[\x00-\x1f\x7f]/.test(data.token)||
       !data.methods||typeof data.methods!=='object'||Array.isArray(data.methods))throw Error('Red-XAI returned an unsupported sign-in challenge');
    // Match the public site's selector: truthy flags offer TOTP/call; otherwise
    // it starts a call challenge. These hints never authorize a session.
    const methods=data.methods.totp?(data.methods.call?['totp','call']:['totp']):['call'];
    job.cookie=cookie;
    this.manualChallenge={provider:'website-cookie',challenge:data.token,methods,method:methods[0],callRequested:false,job};
    this.emit();return {requires2fa:true,methods};
   }
   if(data.ok===false||data.success===false||data.error||
      ['requires2fa','requires2faSetup','twoFactorRequired'].some(key=>Object.hasOwn(data,key)&&data[key]!==false)||
      (data.next!==undefined&&data.next!==null&&data.next!=='')||
      (data.token!==undefined&&data.token!==null&&data.token!=='')||
      (data.challenge!==undefined&&data.challenge!==null&&data.challenge!=='')||
      (data.pending!==undefined&&(!Array.isArray(data.pending)||data.pending.length)))
    throw Error('Red-XAI returned an unsupported or unfinished sign-in challenge');
   if(!cookie)throw Error('Red-XAI did not return a fresh authenticated session cookie');
   return await this.acceptWebsiteCookie(cookie,'password',job);
  }catch(error){if(this.manualJob===job)this.cancelManual();throw error;}
 }
 async manualCall(){
  const pending=this.manualChallenge,job=pending?.job;this.assertManual(job);
  if(pending.provider!=='website-cookie'||!pending.methods.includes('call')||pending.callRequested||job.busy)
   throw Error('Start a new phone verification challenge before requesting another call');
  job.busy=true;pending.callRequested=true;
  try{
   const {status,cookie}=await this.websiteJSON('login/call',{body:{},job});
   if(status!==200)throw statusError('verification call',status);
   if(cookie)job.cookie=cookie;
   return {sent:true};
  }catch(error){if(this.manualJob===job)this.cancelManual();throw error;}
  finally{job.busy=false;}
 }
 async website2fa(code,method=''){
  const pending=this.manualChallenge,job=pending?.job;this.assertManual(job);
  if(pending.provider!=='website-cookie')throw Error('Start Red-XAI password sign-in first');
  if(typeof code==='string')code=code.replace(/ /g,'');
  if(typeof code!=='string'||!/^[0-9]{4,10}$/.test(code))throw Error('Enter your verification code');
  const selected=method||pending.method;
  if(!pending.methods.includes(selected))throw Error('Unsupported Red-XAI 2FA method');
  if(job.busy)throw Error('Wait for the current verification request');
  if(selected==='call'&&!pending.callRequested)throw Error('Request a verification call before entering its code');
  job.busy=true;
  try{
   const result=await this.websiteJSON('login/2fa',{body:{method:selected,code},job,freshCookie:true});
   if(result.status!==200)throw statusError('second-factor verification',result.status);
   return await this.acceptWebsiteCookie(result.cookie,selected,job);
  }catch(error){if(this.manualJob===job)this.cancelManual();throw error;}
  finally{job.busy=false;}
 }
 async acceptWebsiteCookie(cookie,method,job){
  this.assertManual(job);
  const verified=await this.verifyWebsiteCookie({...cookie,method},'',job);
  this.assertManual(job);this.authEpoch++;
  await this.activate({...verified,provider:'website-cookie',access:'',remember:verified.cookieExpiresMs!==null},'',()=>this.assertManual(job));
  this.finishManual(job);this.emit();
  return {signedIn:true,account:this.status().account};
 }
 async verifyWebsiteCookie(record,expected='',job=null){
  const now=this.now();
  if(!COOKIE_TOKEN.test(record.refresh)||!['totp','call','password'].includes(record.method)||
     (record.cookieExpiresMs!==null&&(!Number.isSafeInteger(record.cookieExpiresMs)||record.cookieExpiresMs<=now))||
     (record.accountExpiresMs!==undefined&&(!Number.isSafeInteger(record.accountExpiresMs)||record.accountExpiresMs<=now)))
   throw Error('Red-XAI saved session is invalid or expired');
  const {status,data,cookie}=await this.websiteJSON('me',{credential:record,job});
  if(status!==200)throw statusError('account verification',status);
  const account=data.account,amr=data.amr;
  if(!account||!isSub(account.id)||(expected&&account.id!==expected)||!Array.isArray(amr)||amr.length>32||
     !amr.every(x=>typeof x==='string'&&/^[a-z][a-z0-9_-]{0,63}$/.test(x))||!amr.includes('pwd')||
     (record.method!=='password'&&!amr.includes(record.method==='totp'?'otp':'call'))||
     !Number.isSafeInteger(data.expiresMs)||data.expiresMs<=this.now())throw Error('Red-XAI could not verify the authenticated account and second factor');
  for(const value of [data,account]){
   if((value.active!==undefined&&value.active!==true)||(value.status!==undefined&&value.status!=='active')||
      ['deleted','disabled','banned'].some(key=>value[key]!==undefined&&value[key]!==false)||
      ['email_verified','emailVerified'].some(key=>value[key]!==undefined&&value[key]!==true)||
      (value.pending!==undefined&&(!Array.isArray(value.pending)||value.pending.length)))throw Error('Red-XAI account is not eligible for sign-in');
  }
  const credential=cookie||record,effective=Math.min(data.expiresMs,credential.cookieExpiresMs??Infinity);
  if(effective<=this.now()+3000)throw Error('Red-XAI session is expiring; sign in again');
  return {sub:account.id,email:typeof account.email==='string'?account.email:'',refresh:credential.refresh,
   method:record.method,cookieExpiresMs:credential.cookieExpiresMs,accountExpiresMs:data.expiresMs,
   expiresAt:Math.min(effective,this.now()+60000)};
 }
 async manual2fa(code,method=''){
  const pending=this.manualChallenge;
  if(pending?.provider==='website-cookie')return this.website2fa(code,method);
  if(!pending||!this.accountsIssuer)throw Error('Sign in before entering a verification code');
  this.assertManual(pending.job);
  if(typeof code!=='string'||!/^[0-9]{4,10}$/.test(code))throw Error('Enter the verification code');
  const {status,data}=await this.json(this.accountsIssuer+'/v1/login/2fa',{body:{challenge:pending.challenge,code}});
  this.assertManual(pending.job);
  if(status!==200||data.step!=='ok')throw Error('The verification code was rejected or expired');
  return this.acceptManualLogin(data,pending.job);
 }
 async acceptManualLogin(data,job){
  this.assertManual(job);
  if(data.step!=='ok'||typeof data.session!=='string'||!data.session.startsWith('rxa_s_')||
      (Array.isArray(data.pending)&&data.pending.length))
   throw Error('Complete the required account verification steps on the Red-XAI Accounts website');
  const {status, data:tokens}=await this.json(this.accountsIssuer+'/oauth2/token',{form:true,body:{
   grant_type:'urn:red-xai:grant-type:session',client_id:CLIENT_ID,
   subject_token:data.session,scope:'openid profile email'}});
  this.assertManual(job);
  if(status!==200)throw statusError('app-specific session exchange',status);
  await this.acceptManualTokens(tokens,'',()=>this.assertManual(job),true);
  this.finishManual(job);
  this.emit();return {signedIn:true,account:this.status().account};
 }
 async acceptManualTokens(data,expected='',guard=()=>{},fresh=false){
  if(typeof data.access_token!=='string'||data.access_token.length<20||
     typeof data.refresh_token!=='string'||data.refresh_token.length<20||
     !Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>3600||
     String(data.token_type).toLowerCase()!=='bearer')throw Error('Red-XAI issued invalid account tokens');
  const {status, data:profile}=await this.json(this.accountsIssuer+'/oauth2/userinfo',{method:'GET',bearer:data.access_token});
  if(status!==200||!isSub(profile.sub)||profile.email_verified===false||
     (expected&&expected!==profile.sub))throw Error('Red-XAI could not verify the account identity');
  guard();if(fresh)this.authEpoch++;
  await this.activate({provider:'accounts',sub:profile.sub,email:profile.email||'',
   access:data.access_token,refresh:data.refresh_token,expiresAt:this.now()+data.expires_in*1000,
   remember:true},expected,guard);
 }
 persist(action){
  const pending=this.storageQueue.then(action,action);this.storageQueue=pending.catch(()=>{});return pending;
 }
 async activate(session,expected='',guard=()=>{}){
  guard();
  if(expected&&session.sub!==expected)throw Error('Authenticated account unexpectedly changed');
  const before=this.session;
  // A fresh, verified account must never inherit another account's current Bridge session.
  if(before&&before.sub!==session.sub)throw Error('Sign out of the previous Red-XAI account first');
  await this.beforeActivate(session);
  guard();
  let activated=session;
  try{
   await this.persist(async()=>{
    guard();
    if(session.remember){
     const record={provider:session.provider,refresh:session.refresh,sub:session.sub};
     if(session.provider==='website-cookie')Object.assign(record,{method:session.method,cookieExpiresMs:session.cookieExpiresMs,accountExpiresMs:session.accountExpiresMs});
     await this.save(JSON.stringify(record));
    }else await this.clear();
    try{guard();}catch(error){await this.clear().catch(()=>{});throw error;}
   });
  }catch{
   guard();
   // Successful login may remain active in memory; never persist a plain-text token.
   activated={...session,remember:false};
  }
  guard();
  this.session=activated;
  this.emit();
 }
 async restore(){
  let saved='';
  try{saved=await this.load();}catch{return false;}
  if(!saved)return false;
  let record;
  try{record=JSON.parse(saved);}catch{await this.clear().catch(()=>{});return false;}
  if(!record||!['quick','accounts','website','website-cookie'].includes(record.provider)||!isSub(record.sub)||typeof record.refresh!=='string')return false;
  if(record.provider==='website-cookie'&&(!Number.isSafeInteger(record.cookieExpiresMs)||!Number.isSafeInteger(record.accountExpiresMs)))return false;
  try{await this.refresh(record);return this.isSignedIn();}
  catch{return false;}
 }
 async refresh(record){
  if(this.refreshing)return this.refreshing;
  this.refreshing=this._refresh(record).finally(()=>{this.refreshing=null;});
  return this.refreshing;
 }
 async _refresh(record){
  const active=record||this.session;
  if(!active?.refresh)throw Error('No saved Red-XAI session');
  const epoch=this.authEpoch,sourceSession=this.session;
  const guard=()=>{if(epoch!==this.authEpoch||this.session!==sourceSession)throw Error('Red-XAI session verification was cancelled');};
  let status,data;
  if(active.provider==='quick'){
   ({status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/refresh',{body:{client_id:CLIENT_ID,refresh_token:active.refresh}}));
   if(status===200)await this.acceptQuick(data,active.sub,guard);
  }else if(active.provider==='accounts'&&this.accountsIssuer){
   ({status,data}=await this.json(this.accountsIssuer+'/oauth2/token',{form:true,body:{
    grant_type:'refresh_token',client_id:CLIENT_ID,refresh_token:active.refresh}}));
   if(status===200)await this.acceptManualTokens(data,active.sub,guard);
  }else if(active.provider==='website'){
   const verified=await this.verifyWebsite(active.refresh,active.sub);
   status=200;
   await this.activate({...verified,provider:'website',refresh:active.refresh,access:'',
    expiresAt:this.now()+60000,remember:true},active.sub,guard);
  }else if(active.provider==='website-cookie'){
   const verified=await this.verifyWebsiteCookie(active,active.sub);
   status=200;
   await this.activate({...verified,provider:'website-cookie',access:'',remember:verified.cookieExpiresMs!==null},active.sub,guard);
  }else throw Error('The saved Red-XAI identity provider is unavailable');
  if(status!==200){
   await this.persist(async()=>{
    guard();this.session=null;this.emit();
    if(status===400||status===401||status===403)await this.clear().catch(()=>{});
   });
   throw Error('Red-XAI session has expired or been revoked');
  }
  return this.status();
 }
 async ensure(){
  if(this.isSignedIn())return true;
  if(this.session?.refresh){try{await this.refresh();}catch{}}
  if(!this.isSignedIn())throw Error('Sign in to Red-XAI before using Bridge');
  return true;
 }
 async logout(){
  const previous=this.session;
  this.cancelManual();this.cancelQuick();this.session=null;
  await this.persist(()=>this.clear()).catch(()=>{});
  this.emit();
  if(previous?.refresh){
   const url=previous.provider==='quick'?QUICK_ORIGIN+QUICK_PATH+'/revoke':
    previous.provider==='website'?WEBSITE_API+'logout':
    previous.provider==='accounts'&&this.accountsIssuer?this.accountsIssuer+'/oauth2/revoke':null;
   if(url)await this.json(url,previous.provider==='website'?{body:{},additionalHeaders:{'X-RedX-Session':previous.refresh}}:
    {body:previous.provider==='quick'?{token:previous.refresh}:{
    token:previous.refresh,client_id:CLIENT_ID},form:previous.provider==='accounts'}).catch(()=>{});
  }
  return this.status();
 }
}
module.exports={RedXAIAccount,CLIENT_ID,QUICK_SCOPE,APP_NUMBER,approvalURL,issuerOrigin};
