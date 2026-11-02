'use strict';
const crypto=require('node:crypto');
const QUICK_ORIGIN='https://red-xai.com';
const QUICK_PATH='/redxai-connect';
const WEBSITE_API='https://api.red-xai.com/v1/accounts/';
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
class RedXAIAccount {
 constructor({request=globalThis.fetch,load=async()=>'',save=async()=>{},clear=async()=>{},accountsIssuer='',onChange=()=>{},beforeActivate=async()=>{},now=()=>Date.now()}={}){
  if(typeof request!=='function')throw Error('HTTPS request transport is required');
  this.request=request;this.load=load;this.save=save;this.clear=clear;
  this.accountsIssuer=issuerOrigin(accountsIssuer);this.onChange=onChange;this.beforeActivate=beforeActivate;this.now=now;
  this.session=null;this.approval=null;this.manualChallenge=null;this.polling=false;this.refreshing=null;
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
  this.approval=null;this.manualChallenge=null;
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const {status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/start',{body:{
   client_id:CLIENT_ID,code_challenge:challenge,code_challenge_method:'S256'}});
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
   await this.acceptQuick(data);
   this.approval=null;this.emit();
   return {signedIn:true,account:this.status().account};
  }finally{this.polling=false;}
 }
 cancelQuick(){this.approval=null;this.emit();return {cancelled:true};}
 async verifyQuick(access,expected){
  const {status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/userinfo',{method:'GET',bearer:access});
  if(status!==200||data.protocol!=='redx-site-session-v1'||data.issuer!==QUICK_ORIGIN||
     data.client_id!==CLIENT_ID||data.scope!==QUICK_SCOPE||data.sub!==expected||data.email_verified!==true)
   throw Error('Red-XAI could not verify this Bridge account');
  return data;
 }
 async acceptQuick(data,expected=''){
  if(data.issuer!==QUICK_ORIGIN||data.protocol!=='redx-site-session-v1'||data.client_id!==CLIENT_ID||
     data.scope!==QUICK_SCOPE||String(data.token_type).toLowerCase()!=='bearer'||
     !isSub(data.user?.sub)||data.user?.email_verified!==true||
     !Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>3600)
   throw Error('Red-XAI returned credentials for an invalid app or account');
  requireToken(data.access_token,'rxca_');requireToken(data.refresh_token,'rxcr_');
  if(expected&&expected!==data.user.sub)throw Error('The Red-XAI account changed during refresh');
  const info=await this.verifyQuick(data.access_token,data.user.sub);
  await this.activate({provider:'quick',sub:data.user.sub,email:info.email||data.user.email||'',
   access:data.access_token,refresh:data.refresh_token,expiresAt:this.now()+data.expires_in*1000,
   remember:data.remember_device===true},expected);
 }
 async manualLogin(login,password){
  if(typeof login!=='string'||!login.trim()||login.length>254||typeof password!=='string'||!password||password.length>665)
   throw Error('Enter a valid email or username and password');
  this.manualChallenge=null;
  if(!this.accountsIssuer)return this.websiteLogin(login.trim(),password);
  const {status,data}=await this.json(this.accountsIssuer+'/v1/login',{body:{app:CLIENT_ID,login:login.trim(),password}});
  if(status!==200)throw Error('Red-XAI sign-in failed; check your credentials or account status');
  if(data.step==='2fa'){
   if(typeof data.challenge!=='string'||!data.challenge.startsWith('rxa_h_')||data.challenge.length>100||
      !['app','phone'].includes(data.method))throw Error('Invalid Red-XAI second-factor challenge');
   this.manualChallenge={challenge:data.challenge,method:data.method};
   this.emit();return {requires2fa:true,method:data.method};
  }
  return this.acceptManualLogin(data);
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
 async websiteLogin(login,password){
  const {status,data}=await this.json(WEBSITE_API+'login',{body:{login,password}});
  if(status!==200)throw Error('Red-XAI sign-in failed; check your credentials or account status');
  if(typeof data.next==='string'&&data.next){
   if(typeof data.token!=='string'||data.token.length<12||data.token.length>512||
      /[\r\n]/.test(data.token))throw Error('Red-XAI returned an invalid 2FA session');
   const methods=Array.isArray(data.methods)?data.methods.filter(x=>typeof x==='string'&&/^[a-z0-9_-]{2,32}$/.test(x)):[];
   if(!methods.length)throw Error('Red-XAI did not provide a supported 2FA method');
   this.manualChallenge={provider:'website',challenge:data.token,methods,method:methods[0]};
   this.emit();return {requires2fa:true,methods};
  }
  if(typeof data.token!=='string')throw Error('Red-XAI did not return an authenticated account session');
  return this.acceptWebsite(data.token);
 }
 async website2fa(code,method=''){
  const pending=this.manualChallenge;
  if(pending?.provider!=='website')throw Error('Start Red-XAI password sign-in first');
  if(typeof code!=='string'||!/^[0-9]{4,10}$/.test(code))throw Error('Enter your verification code');
  const selected=method||pending.method;
  if(!pending.methods.includes(selected))throw Error('Unsupported Red-XAI 2FA method');
  const {status,data}=await this.json(WEBSITE_API+'login/2fa',{
   additionalHeaders:{'X-RedX-Flow':pending.challenge},body:{method:selected,code}});
  if(status!==200)throw Error('Red-XAI rejected the verification code');
  if(typeof data.token!=='string')throw Error('Red-XAI did not complete second-factor authentication');
  this.manualChallenge=null;
  return this.acceptWebsite(data.token);
 }
 async acceptWebsite(token){
  const info=await this.verifyWebsite(token);
  await this.activate({...info,provider:'website',access:'',refresh:token,
   expiresAt:this.now()+60000,remember:true});
  this.emit();
  return {signedIn:true,account:this.status().account};
 }
 async manual2fa(code,method=''){
  const pending=this.manualChallenge;
  if(pending?.provider==='website')return this.website2fa(code,method);
  if(!pending||!this.accountsIssuer)throw Error('Sign in before entering a verification code');
  if(typeof code!=='string'||!/^[0-9]{4,10}$/.test(code))throw Error('Enter the verification code');
  const {status,data}=await this.json(this.accountsIssuer+'/v1/login/2fa',{body:{challenge:pending.challenge,code}});
  if(status!==200||data.step!=='ok')throw Error('The verification code was rejected or expired');
  this.manualChallenge=null;
  return this.acceptManualLogin(data);
 }
 async acceptManualLogin(data){
  if(data.step!=='ok'||typeof data.session!=='string'||!data.session.startsWith('rxa_s_')||
      (Array.isArray(data.pending)&&data.pending.length))
   throw Error('Complete the required account verification steps on the Red-XAI Accounts website');
  const {status, data:tokens}=await this.json(this.accountsIssuer+'/oauth2/token',{form:true,body:{
   grant_type:'urn:red-xai:grant-type:session',client_id:CLIENT_ID,
   subject_token:data.session,scope:'openid profile email'}});
  if(status!==200)throw Error('Red-XAI did not issue an app-specific session');
  await this.acceptManualTokens(tokens);
  this.emit();return {signedIn:true,account:this.status().account};
 }
 async acceptManualTokens(data,expected=''){
  if(typeof data.access_token!=='string'||data.access_token.length<20||
     typeof data.refresh_token!=='string'||data.refresh_token.length<20||
     !Number.isInteger(data.expires_in)||data.expires_in<1||data.expires_in>3600||
     String(data.token_type).toLowerCase()!=='bearer')throw Error('Red-XAI issued invalid account tokens');
  const {status, data:profile}=await this.json(this.accountsIssuer+'/oauth2/userinfo',{method:'GET',bearer:data.access_token});
  if(status!==200||!isSub(profile.sub)||profile.email_verified===false||
     (expected&&expected!==profile.sub))throw Error('Red-XAI could not verify the account identity');
  await this.activate({provider:'accounts',sub:profile.sub,email:profile.email||'',
   access:data.access_token,refresh:data.refresh_token,expiresAt:this.now()+data.expires_in*1000,
   remember:true},expected);
 }
 async activate(session,expected=''){
  if(expected&&session.sub!==expected)throw Error('Authenticated account unexpectedly changed');
  const before=this.session;
  // A fresh, verified account must never inherit another account's current Bridge session.
  if(before&&before.sub!==session.sub)throw Error('Sign out of the previous Red-XAI account first');
  await this.beforeActivate(session);
  this.session=session;
  try{
   if(session.remember)await this.save(JSON.stringify({provider:session.provider,refresh:session.refresh,sub:session.sub}));
   else await this.clear();
  }catch{
   // Successful login may remain active in memory; never persist a plain-text token.
   this.session={...session,remember:false};
  }
  this.emit();
 }
 async restore(){
  let saved='';
  try{saved=await this.load();}catch{return false;}
  if(!saved)return false;
  let record;
  try{record=JSON.parse(saved);}catch{await this.clear().catch(()=>{});return false;}
  if(!record||!['quick','accounts','website'].includes(record.provider)||!isSub(record.sub)||typeof record.refresh!=='string')return false;
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
  let status,data;
  if(active.provider==='quick'){
   ({status,data}=await this.json(QUICK_ORIGIN+QUICK_PATH+'/refresh',{body:{client_id:CLIENT_ID,refresh_token:active.refresh}}));
   if(status===200)await this.acceptQuick(data,active.sub);
  }else if(active.provider==='accounts'&&this.accountsIssuer){
   ({status,data}=await this.json(this.accountsIssuer+'/oauth2/token',{form:true,body:{
    grant_type:'refresh_token',client_id:CLIENT_ID,refresh_token:active.refresh}}));
   if(status===200)await this.acceptManualTokens(data,active.sub);
  }else if(active.provider==='website'){
   const verified=await this.verifyWebsite(active.refresh,active.sub);
   status=200;
   await this.activate({...verified,provider:'website',refresh:active.refresh,access:'',
    expiresAt:this.now()+60000,remember:true},active.sub);
  }else throw Error('The saved Red-XAI identity provider is unavailable');
  if(status!==200){
   this.session=null;this.emit();
   if(status===400||status===401||status===403)await this.clear().catch(()=>{});
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
  this.session=null;this.approval=null;this.manualChallenge=null;
  await this.clear().catch(()=>{});
  this.emit();
  if(previous?.refresh){
   const url=previous.provider==='quick'?QUICK_ORIGIN+QUICK_PATH+'/revoke':
    previous.provider==='website'?WEBSITE_API+'logout':
    this.accountsIssuer?this.accountsIssuer+'/oauth2/revoke':null;
   if(url)await this.json(url,previous.provider==='website'?{body:{},additionalHeaders:{'X-RedX-Session':previous.refresh}}:
    {body:previous.provider==='quick'?{token:previous.refresh}:{
    token:previous.refresh,client_id:CLIENT_ID},form:previous.provider==='accounts'}).catch(()=>{});
  }
  return this.status();
 }
}
module.exports={RedXAIAccount,CLIENT_ID,QUICK_SCOPE,APP_NUMBER,approvalURL,issuerOrigin};
