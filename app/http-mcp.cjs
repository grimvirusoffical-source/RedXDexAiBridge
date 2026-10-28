'use strict';
const http=require('node:http'),crypto=require('node:crypto');
const {dispatch}=require('./protocol.cjs');
function isAuthorized(header,token){if(typeof header!=='string'||!header.startsWith('Bearer '))return false;const a=Buffer.from(header.slice(7)),b=Buffer.from(token);return a.length===b.length&&crypto.timingSafeEqual(a,b);}
async function body(req,limit=1048576){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>limit)throw Object.assign(Error('Request too large'),{status:413});chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
function startServer({token,clients,oauth,contextFor=()=>({}),host='127.0.0.1',port=0,onCall=()=>{}}={}){
 if(!['127.0.0.1','::1'].includes(host))throw Error('Refusing to bind MCP to non-loopback address');
 if(!clients&&!token)token=crypto.randomBytes(32).toString('base64url');
 let active=0;
 const server=http.createServer(async(req,res)=>{
  const json=(status,value)=>{if(!res.headersSent)res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  try{
   const url=new URL(req.url,'http://127.0.0.1'),pathname=url.pathname;
   const expected=new Set(['127.0.0.1','localhost','[::1]']);if(oauth?.origin)expected.add(new URL(oauth.origin).hostname);
   let requestHost;try{requestHost=new URL('http://'+req.headers.host).hostname;}catch{}if(!expected.has(requestHost))return json(403,{error:'Invalid Host'});
   if(req.headers.origin&&req.headers.origin!==oauth?.origin)return json(403,{error:'Origin not permitted'});
   if(req.method==='GET'&&['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(pathname)&&oauth?.origin)return json(200,oauth.resourceMetadata());
   if(req.method==='GET'&&pathname==='/.well-known/oauth-authorization-server'&&oauth?.origin)return json(200,oauth.metadata());
   if(pathname.startsWith('/oauth/')&&oauth?.origin){
    if(pathname==='/oauth/authorize'&&req.method==='GET'){const ticket=oauth.begin(Object.fromEntries(url.searchParams));res.writeHead(303,{Location:'/oauth/wait/'+ticket}).end();return;}
    if(pathname.startsWith('/oauth/wait/')&&req.method==='GET'){const result=oauth.page(pathname.slice('/oauth/wait/'.length));if(result.redirect)res.writeHead(result.status,{Location:result.redirect}).end();else res.writeHead(result.status,{'Content-Type':'text/html; charset=utf-8'}).end(result.body);return;}
    if(req.method==='POST'&&['/oauth/register','/oauth/token','/oauth/revoke'].includes(pathname)){
     const raw=await body(req,65536),ct=String(req.headers['content-type']||'').split(';')[0];let input;
     if(ct==='application/json')input=JSON.parse(raw);else if(ct==='application/x-www-form-urlencoded')input=Object.fromEntries(new URLSearchParams(raw));else return json(415,{error:'Unsupported content type'});
     if(!input||typeof input!=='object'||Array.isArray(input))return json(400,{error:'Invalid request'});
     const value=pathname.endsWith('/register')?oauth.register(input):pathname.endsWith('/token')?oauth.token(input):oauth.revoke(input);return json(pathname.endsWith('/register')?201:200,value);
    }
    return json(404,{error:'Not found'});
   }
   const bearer=String(req.headers.authorization||'').startsWith('Bearer ')?String(req.headers.authorization).slice(7):'';
   const client=clients?.verify(bearer)||oauth?.verify(bearer)||(token&&isAuthorized(req.headers.authorization,token)?{id:'local',name:'Local client',kind:'local'}:null);
   const challenge=oauth?.origin?`Bearer resource_metadata="${oauth.origin}/.well-known/oauth-protected-resource/mcp", scope="bridge:tools"`:'Bearer';
   if(!client)res.setHeader('WWW-Authenticate',challenge);
   // Schema-only discovery is public on the OAuth endpoint. No computer tool
   // (including status or profile) ever executes without a verified credential.
   if(!client&&!oauth?.origin)return json(401,{error:'Authentication required'});
   if(pathname!=='/mcp')return json(404,{error:'Not found'});
   if(req.method!=='POST'){res.setHeader('Allow','POST');return json(405,{error:'This server uses JSON responses; a standalone SSE stream is not provided'});}
   if(req.headers.origin)return json(403,{error:'Browser origins cannot invoke computer tools'});
   if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return json(415,{error:'JSON required'});
   if(active>=32)return json(429,{error:'Too many concurrent requests'});
   const raw=await body(req);let message;try{message=JSON.parse(raw);}catch{return json(400,{jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
   if(Array.isArray(message)||!message||typeof message!=='object')return json(400,{jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid Request'}});
   if(!client){
    const discovery=['initialize','ping','tools/list','notifications/initialized'].includes(message.method);
    if(!discovery||bearer){
     const failure={error:'Authentication required',_meta:{'mcp/www_authenticate':[challenge]}};
     if(message.id!==undefined&&message.method==='tools/call')Object.assign(failure,{jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:'Connect RedXDexAiBridge and approve pairing on your Mac before using computer tools.'}],isError:true,_meta:{'mcp/www_authenticate':[challenge]}}});
     return json(401,failure);
    }
    const result=await dispatch(message,{discoveryOnly:true});
    if(!result){res.writeHead(202).end();return;}return json(200,result);
   }
   active++;let response;const started=Date.now();
   try{response=await dispatch(message,{...contextFor(client),clientId:client.id,clientName:client.name});}
   finally{active--;onCall({at:Date.now(),clientId:client.id,clientName:client.name,tool:message.params?.name||message.method,durationMs:Date.now()-started,error:!!response?.result?.isError});}
   if(!response){res.writeHead(202).end();return;}json(200,response);
  }catch(e){if(!res.headersSent)json(e.status||400,{error:e.message==='Unexpected end of JSON input'?'Invalid JSON':String(e.message).slice(0,200)});else res.end();}
 });
 server.requestTimeout=120000;server.headersTimeout=15000;server.keepAliveTimeout=2000;server.maxHeadersCount=40;
 return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);const p=server.address().port;resolve({server,url:`http://${host==='::1'?'[::1]':host}:${p}/mcp`,token,port:p,stop:()=>new Promise((ok,bad)=>{server.close(e=>e?bad(e):ok());server.closeIdleConnections?.();})});});});
}
module.exports={startServer,isAuthorized};
