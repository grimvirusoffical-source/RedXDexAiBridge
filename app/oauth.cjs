'use strict';
// OAuth authorization-code + PKCE. Approval happens only in the local desktop UI.
const fs=require('node:fs'),crypto=require('node:crypto');
const {atomicJSON,digest}=require('./clients.cjs');
const random=()=>crypto.randomBytes(32).toString('base64url');
const err=(message,status=400)=>Object.assign(new Error(message),{status});
function redirectOK(value){try{const u=new URL(value);return !u.hash&&!u.username&&!u.password&&(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]','localhost'].includes(u.hostname)));}catch{return false;}}
function html(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
class OAuthService {
 constructor({file,clients,approvals,onClient=()=>{}}){
  this.file=file;this.clients=clients;this.approvals=approvals;this.onClient=onClient;this.origin=null;this.pending=new Map();this.codes=new Map();this.rates=new Map();
  this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{registrations:{},access:{},refresh:{},families:{}};
  for(const key of ['registrations','access','refresh','families'])if(!this.data[key]||typeof this.data[key]!=='object'||Array.isArray(this.data[key]))throw Error('Invalid OAuth registry');
 }
 save(){const now=Date.now();for(const [k,t]of Object.entries(this.data.access))if(t.expires<now)delete this.data.access[k];for(const [k,t]of Object.entries(this.data.refresh))if(t.expires<now)delete this.data.refresh[k];atomicJSON(this.file,this.data);}
 setOrigin(origin){const u=new URL(origin);if(u.pathname!=='/'||u.search||u.hash||u.username||u.password||!(u.protocol==='https:'||(u.protocol==='http:'&&u.hostname==='127.0.0.1')))throw Error('Invalid canonical MCP origin');this.origin=u.origin;}
 get resource(){return this.origin+'/mcp';}
 rate(bucket,limit=60){const now=Date.now(),key=bucket;let r=this.rates.get(key);if(!r||now-r.start>60000){r={start:now,n:0};this.rates.set(key,r);}if(++r.n>limit)throw err('Too many requests; retry in a minute',429);}
 resourceMetadata(){return {resource:this.resource,authorization_servers:[this.origin],scopes_supported:['bridge:tools'],bearer_methods_supported:['header']};}
 metadata(){return {issuer:this.origin,authorization_endpoint:this.origin+'/oauth/authorize',token_endpoint:this.origin+'/oauth/token',registration_endpoint:this.origin+'/oauth/register',revocation_endpoint:this.origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['bridge:tools'],authorization_response_iss_parameter_supported:true};}
 register(input){
  this.rate('register',20);if(Object.keys(this.data.registrations).length>=200)throw err('Client registration limit reached; remove old registrations in the app',429);
  if(!Array.isArray(input.redirect_uris)||!input.redirect_uris.length||input.redirect_uris.length>8||!input.redirect_uris.every(x=>typeof x==='string'&&x.length<=2048&&redirectOK(x)))throw err('Invalid redirect_uris');
  if(input.token_endpoint_auth_method&&input.token_endpoint_auth_method!=='none')throw err('Only public clients with PKCE are supported');
  const id='rxb_'+crypto.randomBytes(20).toString('hex');
  const r={client_id:id,client_name:String(input.client_name||'MCP client').slice(0,80),redirect_uris:input.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_id_issued_at:Math.floor(Date.now()/1000)};
  this.data.registrations[id]=r;this.save();return r;
 }
 begin(params){
  this.rate('authorize',20);
  for(const[k,p]of this.pending)if(p.expires<Date.now())this.pending.delete(k);
  if(this.pending.size>=24)throw err('Too many pending connections',429);
  const client=this.data.registrations[params.client_id];if(!client)throw err('Unknown client');
  if(!client.redirect_uris.includes(params.redirect_uri))throw err('Redirect URI does not match registration');
  if(params.response_type!=='code'||params.code_challenge_method!=='S256'||!/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge||''))throw err('Authorization code with S256 PKCE is required');
  if(params.resource!==this.resource)throw err('A matching resource parameter is required');
  if(params.scope&&params.scope!=='bridge:tools')throw err('Unknown scope');
  if(params.state&&params.state.length>2048)throw err('State is too long');
  const ticket=random(),p={params:{...params},client,expires:Date.now()+180000,state:'pending'};this.pending.set(ticket,p);
  const request={kind:'connection',clientId:client.client_id,clientName:client.client_name,capability:'connect',summary:'Pair this AI with your computer',details:'Unverified client label: '+client.client_name+'\nCallback: '+params.redirect_uri+'\nEach capability remains subject to your desktop permission settings.'};
  this.approvals.request(request).then(async()=>{
   if(p.expires<Date.now())throw Error('Pairing expired');
   if(!client.bridgeId||!this.clients.exists(client.bridgeId)){const c=this.clients.create(client.client_name,'oauth');client.bridgeId=c.id;await this.onClient(c.id);}
   const code=random();this.codes.set(digest(code),{...p.params,bridgeId:client.bridgeId,expires:Date.now()+60000});
   const target=new URL(p.params.redirect_uri);target.searchParams.set('code',code);target.searchParams.set('iss',this.origin);if(p.params.state)target.searchParams.set('state',p.params.state);
   p.state='approved';p.redirect=target.href;this.save();
  }).catch(()=>{p.state='denied';});
  return ticket;
 }
 page(ticket){
  const p=this.pending.get(ticket);if(!p||p.expires<Date.now())return {status:410,body:'Connection request expired. Start again from your AI client.'};
  if(p.state==='approved'){this.pending.delete(ticket);return {status:303,redirect:p.redirect};}
  const denied=p.state==='denied';
  return {status:denied?403:200,body:`<!doctype html><html><head><meta charset="utf-8">${denied?'':'<meta http-equiv="refresh" content="2">'}<meta name="viewport" content="width=device-width, initial-scale=1"><title>RedXDexAiBridge pairing</title><style>body{font:16px system-ui;background:#10131b;color:#eee;max-width:620px;margin:12vh auto;padding:24px}h1{font-size:28px}small{color:#aab}strong{color:#ff6b77}</style></head><body><small>REDXDEX AI BRIDGE</small><h1>${denied?'Connection declined':'Approve this connection on your computer'}</h1><p><strong>${html(p.client.client_name)}</strong> is requesting access to the bridge.</p><p>${denied?'No computer access was granted.':'Open RedXDexAiBridge → Approvals. Check the AI name and callback before allowing the connection. This page continues automatically.'}</p><small>You can revoke access at any time. No passwords or files are requested on this page.</small></body></html>`};
 }
 issue(clientId,bridgeId,family){
  if(!this.clients.exists(bridgeId))throw err('Client access has been revoked',401);
  const access=random(),refresh=random(),now=Date.now();family=family||random();this.data.families[family]=this.data.families[family]||{revoked:false};
  const base={clientId,bridgeId,family,resource:this.resource};
  this.data.access[digest(access)]={...base,expires:now+3600000};this.data.refresh[digest(refresh)]={...base,expires:now+30*86400000,used:false};this.save();
  return {access_token:access,token_type:'Bearer',expires_in:3600,refresh_token:refresh,scope:'bridge:tools'};
 }
 token(input){
  this.rate('token',120);if(!this.data.registrations[input.client_id])throw err('invalid_client',401);
  if(input.resource!==this.resource)throw err('invalid_target');
  if(input.grant_type==='authorization_code'){
   const key=digest(String(input.code||'')),c=this.codes.get(key);this.codes.delete(key);
   if(!c||c.expires<Date.now()||c.client_id!==input.client_id||c.redirect_uri!==input.redirect_uri||c.resource!==this.resource)throw err('invalid_grant');
   if(!/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier||''))throw err('invalid_grant');
   const challenge=crypto.createHash('sha256').update(input.code_verifier).digest('base64url');if(challenge!==c.code_challenge)throw err('invalid_grant');
   return this.issue(input.client_id,c.bridgeId);
  }
  if(input.grant_type==='refresh_token'){
   const r=this.data.refresh[digest(String(input.refresh_token||''))];if(!r||r.clientId!==input.client_id||r.resource!==this.resource||r.expires<Date.now())throw err('invalid_grant');
   if(r.used||this.data.families[r.family]?.revoked){if(this.data.families[r.family])this.data.families[r.family].revoked=true;this.save();throw err('invalid_grant');}
   r.used=true;return this.issue(input.client_id,r.bridgeId,r.family);
  }
  throw err('unsupported_grant_type');
 }
 verify(value){if(typeof value!=='string'||value.length>512)return null;const t=this.data.access[digest(value)];if(!t||t.expires<Date.now()||t.resource!==this.resource||this.data.families[t.family]?.revoked||!this.clients.exists(t.bridgeId))return null;const client=this.clients.list().find(c=>c.id===t.bridgeId);return {id:t.bridgeId,name:client.name,kind:'oauth'};}
 revoke(input){const t=this.data.access[digest(String(input.token||''))]||this.data.refresh[digest(String(input.token||''))];if(t&&t.clientId===input.client_id&&this.data.families[t.family]){this.data.families[t.family].revoked=true;this.save();}return {};}
 reset(){this.data={registrations:{},access:{},refresh:{},families:{}};this.codes.clear();this.pending.clear();this.save();}
}
module.exports={OAuthService,redirectOK};
