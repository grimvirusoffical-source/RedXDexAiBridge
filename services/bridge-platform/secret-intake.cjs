'use strict';
// Fresh Node-only local form for normal user/server execution. It never loads
// script files, changes execution policy, contacts Stripe, or accepts paths
// from HTTP requests. Windows package/AppContainer temp environments are
// refused before listening: private native files are unreadable to that token.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os');
const SANDBOX_ACCOUNT='acct_1USFfGEKYCPRlM5G',COOKIE='redx_sandbox_intake',MAX_BODY=2048;
const CSP="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
// Native form POSTs under no-referrer get Origin:null (Fetch Standard).
// Keep the exact Origin guard and withhold referrers to other origins.
const REFERRER_POLICY='same-origin';
const keyPattern=kind=>kind==='sandbox-api'?/^rk_test_[A-Za-z0-9]{16,512}$/:kind==='sandbox-webhook'?/^whsec_[A-Za-z0-9]{16,512}$/:null;
class IntakeError extends Error{constructor(code){super(code);this.code=code;}}
function supportedRuntime(){if(os.platform()==='win32'&&/(?:^|\/)Packages\/[^/]+\/AC\/Temp(?:\/|$)/i.test(os.tmpdir().replace(/\\/g,'/')))throw Error('Unsupported protected credential intake environment');}
function destination(file){
 try{
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0'))throw Error();const target=path.resolve(file);
  try{fs.lstatSync(target);throw Error('exists');}catch(error){if(error.code!=='ENOENT')throw Error();}
  for(let directory=path.dirname(target);;){
   try{const entry=fs.lstatSync(directory);if(!entry.isDirectory()||entry.isSymbolicLink())throw Error();}catch(error){if(error.code!=='ENOENT')throw Error();}
   try{fs.lstatSync(path.join(directory,'.git'));throw Error('repository');}catch(error){if(error.code!=='ENOENT')throw Error();}
   const parent=path.dirname(directory);if(parent===directory)break;directory=parent;
  }
  return target;
 }catch{throw Error('Invalid protected Sandbox destination');}
}
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&/^[A-Za-z0-9_-]{43}$/.test(a)&&a.length===b.length&&crypto.timingSafeEqual(Buffer.from(a),Buffer.from(b));
function cookieValue(raw){
 if(typeof raw!=='string'||raw.length>2048)return null;let result=null,count=0;
 for(const part of raw.split(';')){const at=part.indexOf('=');if(at>0&&part.slice(0,at).trim()===COOKIE){count++;result=part.slice(at+1).trim();}}
 return count===1?result:null;
}
function countHeader(req,name){let count=0;for(let i=0;i<req.rawHeaders.length;i+=2)if(req.rawHeaders[i].toLowerCase()===name)count++;return count;}
function html(title,body){return'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>'+title+'</title><style>html{color-scheme:dark;font:16px system-ui;background:#100e12;color:#f5f2f4}body{max-width:38rem;margin:8vh auto;padding:1.5rem}h1{font-size:1.6rem}p{line-height:1.55;color:#d0c8ce}main{background:#19151c;border:1px solid #40313b;border-top:3px solid #ee334f;border-radius:10px;padding:1.5rem}label{display:block;margin-top:1.5rem}input{display:block;box-sizing:border-box;width:100%;margin:.5rem 0 1.2rem;padding:.8rem;background:#100e12;color:#fff;border:1px solid #715762;border-radius:5px}button{background:#ca2640;color:white;border:0;border-radius:5px;padding:.8rem 1.4rem;font:inherit;cursor:pointer}small{color:#bdb3ba}</style></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>';}
function page(kind,csrf){const label=kind==='sandbox-api'?'Sandbox restricted API key':'Sandbox webhook signing secret';return html('Save Sandbox credential','<p>Account: Sandbox · '+SANDBOX_ACCOUNT+'</p><p>This local form saves one credential to protected local storage. The intake closes after saving.</p><form method="post" action="/save" enctype="application/x-www-form-urlencoded" autocomplete="off"><input type="hidden" name="csrf" value="'+csrf+'"><input type="hidden" name="account" value="'+SANDBOX_ACCOUNT+'"><input type="hidden" name="kind" value="'+kind+'"><label for="credential">'+label+'</label><input id="credential" name="secret" type="password" required maxlength="520" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus><button type="submit">Save securely</button></form><p><small>The credential is never placed in the address or returned by this form.</small></p>');}
async function readBody(req,timeoutMs){
 const chunks=[];let total=0,timer;
 const reading=(async()=>{for await(const chunk of req){total+=chunk.length;if(total>MAX_BODY)throw new IntakeError('too_large');chunks.push(chunk);}return Buffer.concat(chunks);})();
 try{return await Promise.race([reading,new Promise((_,reject)=>{timer=setTimeout(()=>{reject(new IntakeError('timeout'));req.destroy();},timeoutMs);})]);}
 finally{clearTimeout(timer);for(const chunk of chunks)chunk.fill(0);}
}
function formBody(raw){
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);for(const piece of text.split('&')){const at=piece.indexOf('=');if(at<0)throw Error();decodeURIComponent(piece.slice(0,at).replace(/\+/g,' '));decodeURIComponent(piece.slice(at+1).replace(/\+/g,' '));}
  const params=new URLSearchParams(text),keys=[...params.keys()];if(keys.length!==4||keys.some(key=>!['csrf','account','kind','secret'].includes(key))||new Set(keys).size!==4)throw Error();return params;
 }catch{throw new IntakeError('invalid_form');}finally{raw.fill(0);}
}
async function startSecretIntake({file,kind,expectedAccount=SANDBOX_ACCOUNT,writer,port=0,intakeTimeoutMs=300000,bodyTimeoutMs=5000,writerTimeoutMs=30000}={}){
 supportedRuntime();const target=destination(file);
 if(!keyPattern(kind)||expectedAccount!==SANDBOX_ACCOUNT||!Number.isInteger(port)||port<0||port>65535||!Number.isInteger(intakeTimeoutMs)||intakeTimeoutMs<20||intakeTimeoutMs>600000||!Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<10||bodyTimeoutMs>10000||!Number.isInteger(writerTimeoutMs)||writerTimeoutMs<10||writerTimeoutMs>60000)throw Error('Invalid Sandbox intake configuration');
 const save=writer===undefined?require('./protected-secret.cjs').writeSandboxSecret:writer;if(typeof save!=='function')throw Error('Protected credential writer required');
 let phase='ready',origin,host,expiryTimer,closing=false,cookie=crypto.randomBytes(32).toString('base64url'),csrf=crypto.randomBytes(32).toString('base64url'),complete;
 const done=new Promise(resolve=>{complete=resolve;}),sockets=new Set();
 function finish(status){
  if(closing)return done;closing=true;phase=status;cookie=null;csrf=null;clearTimeout(expiryTimer);
  const force=setTimeout(()=>{for(const socket of sockets)socket.destroy();},1000);force.unref?.();
  server.close(()=>{clearTimeout(force);complete(Object.freeze({status,kind,account:SANDBOX_ACCOUNT}));});server.closeIdleConnections?.();return done;
 }
 function send(req,res,status,title,message,headers={}){
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','pragma':'no-cache','content-security-policy':CSP,'x-content-type-options':'nosniff','referrer-policy':REFERRER_POLICY,'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin','connection':'close',...headers});
  res.once('finish',()=>{if(!req.complete)req.destroy();});res.end(html(title,'<p>'+message+'</p>'));
 }
 const server=http.createServer({maxHeaderSize:4096},async(req,res)=>{
  let secret=null,raw;
  try{
   if(req.headers.host!==host||countHeader(req,'host')!==1)return send(req,res,403,'Request refused','Open the local intake address directly.');
   if(closing||phase!=='ready')return send(req,res,409,'Intake unavailable','This intake is already in use or has ended.');
   if(req.method==='GET'&&req.url==='/'){
    if(req.headers.origin&&req.headers.origin!==origin)return send(req,res,403,'Request refused','Open the local intake address directly.');
    res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','pragma':'no-cache','content-security-policy':CSP,'x-content-type-options':'nosniff','referrer-policy':REFERRER_POLICY,'cross-origin-opener-policy':'same-origin','cross-origin-resource-policy':'same-origin','set-cookie':COOKIE+'='+cookie+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+Math.ceil(intakeTimeoutMs/1000),'connection':'close'});res.end(page(kind,csrf));return;
   }
   if(req.method!=='POST'||req.url!=='/save')return send(req,res,405,'Request refused','Use the local credential form.');
   if(countHeader(req,'origin')!==1||req.headers.origin!==origin||(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')||!equal(cookieValue(req.headers.cookie),cookie))return send(req,res,403,'Request refused','Reload the local intake form and try again.');
   if(countHeader(req,'content-type')!==1||!/^application\/x-www-form-urlencoded(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))return send(req,res,415,'Request refused','Use the local credential form.');
   if(req.headers['content-length']!==undefined&&(!/^\d+$/.test(req.headers['content-length'])||Number(req.headers['content-length'])>MAX_BODY))return send(req,res,413,'Request refused','The submitted form is too large.');
   raw=await readBody(req,bodyTimeoutMs);const params=formBody(raw);raw=null;
   if(closing||phase!=='ready')return send(req,res,409,'Intake unavailable','This intake is already in use or has ended.');
   if(!equal(params.get('csrf'),csrf)||params.get('account')!==SANDBOX_ACCOUNT||params.get('kind')!==kind)return send(req,res,403,'Request refused','Reload the local intake form and try again.');
   secret=params.get('secret');params.delete('secret');if(!keyPattern(kind).test(secret||''))return send(req,res,400,'Credential not saved','Use the credential for this Sandbox account and credential type.');
   destination(target);phase='writing';cookie=null;csrf=null;clearTimeout(expiryTimer);let writerTimer;
   const finishReply=status=>{if(res.destroyed||res.writableEnded){finish(status);return;}res.once('finish',()=>finish(status));res.once('close',()=>finish(status));};
   try{
    const pending=Promise.resolve().then(()=>{if(closing||phase!=='writing')throw Error();return save(target,secret,{kind,expectedAccount:SANDBOX_ACCOUNT});});
    const result=await Promise.race([pending,new Promise((_,reject)=>{writerTimer=setTimeout(()=>reject(new IntakeError('write_timeout')),writerTimeoutMs);})]);if(result?.saved!==true)throw Error();
    if(closing||phase!=='writing')return;
    finishReply('saved');
    send(req,res,200,'Saved securely','The Sandbox credential was saved to protected local storage. You can close this tab.',{'set-cookie':COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});
   }catch{
    if(!closing){finishReply('failed');send(req,res,500,'Save not confirmed','The protected save was not confirmed. Restart the intake before trying again.',{'set-cookie':COOKIE+'=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});}
   }finally{clearTimeout(writerTimer);}
  }catch(error){send(req,res,error instanceof IntakeError&&error.code==='too_large'?413:400,'Credential not saved','The request could not be accepted. Reload the local intake form.');}
  finally{secret=null;if(raw)raw.fill(0);}
 });
 server.headersTimeout=3000;server.requestTimeout=10000;server.timeout=10000;server.keepAliveTimeout=1000;server.maxHeadersCount=20;server.maxConnections=8;server.maxRequestsPerSocket=2;
 server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);const bound=server.address();host='127.0.0.1:'+bound.port;origin='http://'+host;resolve();});});
 server.on('error',()=>finish('failed'));expiryTimer=setTimeout(()=>finish('expired'),intakeTimeoutMs);expiryTimer.unref?.();
 return Object.freeze({url:origin+'/',done,close:()=>finish('closed')});
}
if(require.main===module){
 const args=process.argv.slice(2);let file,kind,valid=args.length===4;
 for(let i=0;i<args.length;i+=2){if(args[i]==='--file'&&file===undefined)file=args[i+1];else if(args[i]==='--kind'&&kind===undefined)kind=args[i+1];else valid=false;}
 if(!valid){console.error('Sandbox credential intake could not start.');process.exitCode=1;}
 else startSecretIntake({file,kind}).then(async intake=>{console.log(intake.url);const result=await intake.done;if(result.status==='saved')console.log('Sandbox credential saved securely.');else{console.error('Sandbox credential intake ended without a confirmed save.');process.exitCode=1;}}).catch(()=>{console.error('Sandbox credential intake could not start.');process.exitCode=1;});
}
module.exports={startSecretIntake,SANDBOX_ACCOUNT};
