'use strict';
const crypto=require('node:crypto');
const ORIGIN='https://red-xai.com',PREFIX='/redxai-bridge/api';
const ROUTE=/^\/[a-z][a-z0-9/-]{0,90}$/;
const COOKIE_TOKEN=/^[A-Za-z0-9_~.+/-]{12,1024}={0,2}$/;
const CANONICAL_COOKIE_DEFAULT=require('./platform-config.cjs').canonicalCookieTransport===true;
const canonicalSubject=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\p{Cc}]/u.test(value)&&!(value in Object.prototype)&&Buffer.from(value,'utf8').toString('utf8')===value;
class PlatformClient {
 constructor({request=fetch,credentials,loadSecret,saveSecret,clearSecret,label='My computer',now=Date.now,canonicalCookieTransport=CANONICAL_COOKIE_DEFAULT}={}){
  if(typeof credentials!=='function'||typeof loadSecret!=='function'||typeof saveSecret!=='function')throw Error('Private account and device storage are required');
  Object.assign(this,{request,credentials,loadSecret,saveSecret,clearSecret,label,now});this.canonicalCookieTransport=canonicalCookieTransport===true;this.device=null;this.enrolling=null;this.state=null;
 }
 async identity(){
  const c=await this.credentials();if(!c?.sub||!['quick','website','website-cookie'].includes(c.provider))throw Error('Sign in with your existing Red-XAI website account to use the shop');
  if(c.provider==='website-cookie'){
   if(!this.canonicalCookieTransport)throw Error('Canonical website sessions are not enabled for the account platform');const now=this.now();
   if(!Number.isSafeInteger(now)||now<0||!canonicalSubject(c.sub)||typeof c.refresh!=='string'||!COOKIE_TOKEN.test(c.refresh)||!Number.isSafeInteger(c.expiresAt)||c.expiresAt<=now||!Number.isSafeInteger(c.accountExpiresMs)||c.accountExpiresMs<=now||(c.cookieExpiresMs!==null&&(!Number.isSafeInteger(c.cookieExpiresMs)||c.cookieExpiresMs<=now)))throw Error('The website account session is invalid or expired');
  }
  return c;
 }
 async keys(){if(this.device)return this.device;let record;try{const saved=await this.loadSecret('bridge-platform-device');if(saved)record=JSON.parse(saved);}catch{throw Error('Secure device identity could not be read');}
  if(!record){const pair=crypto.generateKeyPairSync('ed25519');record={privateKey:pair.privateKey.export({type:'pkcs8',format:'pem'}),publicKey:pair.publicKey.export({type:'spki',format:'pem'})};await this.saveSecret('bridge-platform-device',JSON.stringify(record));}
  const privateKey=crypto.createPrivateKey(record.privateKey),publicKey=crypto.createPublicKey(privateKey).export({type:'spki',format:'pem'});if(publicKey!==record.publicKey)throw Error('Device identity is invalid');
  this.device={...record,privateKey,deviceId:crypto.createHash('sha256').update(publicKey).digest('hex')};return this.device;
 }
 async raw(route,data={}, {enroll=false,method='POST'}={}){
  if(!ROUTE.test(route)||route.includes('//')||route.includes('..'))throw Error('Invalid platform operation');
  const account=await this.identity(),url=new URL(PREFIX+route,ORIGIN);if(method==='GET')for(const [key,value]of Object.entries(data))if(value!==undefined&&value!==null)url.searchParams.set(key,String(value));const body=method==='GET'?'':JSON.stringify(data);
  if(Buffer.byteLength(body)>7*1024*1024)throw Error('Platform request is too large');
  const headers={accept:'application/json',...(method==='GET'?{}:{'content-type':'application/json'})};
  if(account.provider==='quick')headers.authorization='Bearer '+account.access;
  else if(account.provider==='website-cookie'){
   // Explicit native credentials, never ambient browser cookies or URL data.
   headers['X-Bridge-Site-Session']=account.refresh;headers['X-Bridge-Site-Subject']=Buffer.from(account.sub,'utf8').toString('base64url');
  }else headers['X-RedX-Session']=account.refresh;
  if(!enroll){const d=await this.keys(),time=String(this.now()),nonce=crypto.randomBytes(24).toString('base64url');const digest=crypto.createHash('sha256').update(body).digest('hex');const canonical=[method,url.pathname+url.search,digest,time,nonce].join('\n');Object.assign(headers,{'X-Bridge-Device':d.deviceId,'X-Bridge-Time':time,'X-Bridge-Nonce':nonce,'X-Bridge-Signature':crypto.sign(null,Buffer.from(canonical),d.privateKey).toString('base64url')});}
  let response;try{response=await this.request(url.href,{method,headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),...(account.provider==='website-cookie'?{credentials:'omit'}:{}),...(method==='GET'?{}:{body})});}catch{throw Error('Red-XAI shop is unavailable. Your account and saved purchases have not been changed.');}
  if(!(response.headers.get('content-type')||'').includes('application/json'))throw Error('The Red-XAI platform has not been deployed at this address');
  const bytes=[];let size=0;for await(const b of response.body){size+=b.length;if(size>8*1024*1024)throw Error('Platform response too large');bytes.push(Buffer.from(b));}
  let value;try{value=JSON.parse(Buffer.concat(bytes).toString());}catch{throw Error('Invalid platform response');}
  if(!response.ok){const message=value.error==='banned'?(value.untilMs?'This account is banned until '+new Date(value.untilMs).toLocaleString():'This account is permanently banned'):(value.message||String(value.error||'Platform request refused'));const e=Error(message);e.code=value.error;e.status=response.status;e.details=value;throw e;}return value;
 }
 async enroll(){if(this.enrolling)return this.enrolling;this.enrolling=(async()=>{const d=await this.keys(),challenge=await this.raw('/device/challenge',{}, {enroll:true});if(typeof challenge.nonce!=='string'||challenge.nonce.length>256)throw Error('Invalid device challenge');const signature=crypto.sign(null,Buffer.from('bridge-enroll:'+challenge.nonce),d.privateKey).toString('base64url');const result=await this.raw('/device/enroll',{nonce:challenge.nonce,publicKey:d.publicKey,signature,label:this.label},{enroll:true});if(result.deviceId!==d.deviceId)throw Error('Server device identity did not match');return result;})().finally(()=>{this.enrolling=null;});return this.enrolling;}
 async status(){try{await this.enroll();}catch(e){if(e.code!=='bridge_membership_deleted')throw e;await this.raw('/account/join',{}, {enroll:true});await this.enroll();}this.state={...await this.raw('/me'),deviceId:(await this.keys()).deviceId};return this.state;}
 async call(route,data={}){await this.keys();const result=await this.raw(route,data,{method:route==='/admin/users'?'GET':'POST'});if(route==='/catalog'&&Array.isArray(result.plugins)){const plugins=result.plugins.slice(0,100);for(let offset=0;offset<plugins.length;offset+=4)await Promise.all(plugins.slice(offset,offset+4).map(async p=>{if(!/^\/bridge-platform\/media\/[a-f0-9]{64}\.(png|jpg|webp)$/.test(p.image||''))return;try{const image=await this.raw('/media/read',{image:p.image});if(['image/png','image/jpeg','image/webp'].includes(image.mimeType)&&typeof image.base64==='string'&&image.base64.length<=7000000&&/^[A-Za-z0-9+/=]+$/.test(image.base64))p.imageDataUrl='data:'+image.mimeType+';base64,'+image.base64;}catch{}}));}return result;}
 async catalog(){return this.raw('/catalog');}
 async checkout(data){const orderId=data.orderId||(await this.call('/checkout/quote',data)).id;const result=await this.call('/checkout/create',{orderId});const u=new URL(result.url);if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.username||u.password)throw Error('Untrusted checkout address');return{...result,url:u.href};}
 async forgetDevice(){if(this.clearSecret)await this.clearSecret('bridge-platform-device');this.device=null;this.state=null;}
}
module.exports={PlatformClient,ORIGIN,PREFIX};
