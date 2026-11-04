#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const VERSION='0.1.9',SERVER_NAME='red-xai-bridge';
const TEMPLATE=path.join(__dirname,'../distribution/chatgpt-plugin/template');
const HELP='Red-XAI Bridge private plugin setup '+VERSION+'\n'+
 'node scripts/export-chatgpt-plugin.cjs --endpoint HTTPS_MCP_URL --output NEW_DIRECTORY [--config-only]\n\n'+
 'Use the verified URL from your own Bridge Connections page. This checks public OAuth\n'+
 'protected-resource metadata and advertised HTTPS issuer URL syntax; it never signs in.\n'+
 '--config-only requires --server-name EXISTING_NAME and writes only connection declarations.\n';
function endpointURL(value){
 let url;try{url=new URL(value);}catch{throw Error('Use your own verified public HTTPS /mcp endpoint');}
 const host=url.hostname.toLowerCase();
 if(url.protocol!=='https:'||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password||
    !host.includes('.')||net.isIP(host.replace(/^\[|\]$/g,''))||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.')){
  throw Error('Use a plain public HTTPS /mcp URL without credentials, query parameters or fragments');
 }
 return url.href;
}
function checkedServerName(value){
 if(typeof value!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(value))throw Error('Use the exact existing MCP server name (letters, numbers, underscores or hyphens)');
 return value;
}
function configuration(endpoint,serverName=SERVER_NAME){
 const url=endpointURL(endpoint);checkedServerName(serverName);
 // Native Codex rejects server-level extensions. OAuth is the host default;
 // discovery only advertises issuers. Normal client approval is still required.
 const servers={[serverName]:{type:'streamable-http',url,headers:{}}};
 return {portable:{$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:servers},legacy:{mcpServers:servers}};
}
class DiscoveryError extends Error {}
async function verifyDiscovery(endpoint,fetchImpl=globalThis.fetch,{timeoutMs=10000}={}){
 const url=endpointURL(endpoint);
 if(typeof fetchImpl!=='function')throw Error('Node.js 20 or newer is required');
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Invalid OAuth discovery deadline');
 const metadataURL=new URL('/.well-known/oauth-protected-resource/mcp',url).href;
 const controller=new AbortController();let timer,response,reader,cancelled=false;
 const unavailable=()=>new DiscoveryError('OAuth discovery could not be verified; check Bridge is online');
 function cancelBody(){
  const target=reader||response?.body;
  if(!target||cancelled)return;cancelled=true;
  try{Promise.resolve(target.cancel()).catch(()=>{});}catch{}
 }
 const deadline=new Promise((_,reject)=>{
  timer=setTimeout(()=>{controller.abort();cancelBody();reject(new DiscoveryError('OAuth discovery timed out'));},timeoutMs);
 });
 const readMetadata=(async()=>{
  response=await fetchImpl(metadataURL,{redirect:'error',signal:controller.signal,headers:{Accept:'application/json'}});
  if(controller.signal.aborted){cancelBody();throw new DiscoveryError('OAuth discovery timed out');}
  if(!response?.ok)throw new DiscoveryError('OAuth discovery returned HTTP '+(Number.isInteger(response?.status)?response.status:'error'));
  const length=response.headers?.get?.('content-length');
  if(length&&/^\d+$/.test(length)&&Number(length)>65536)throw new DiscoveryError('OAuth discovery response is too large');
  if(!response.body||typeof response.body.getReader!=='function')throw new DiscoveryError('OAuth discovery did not return readable JSON');
  reader=response.body.getReader();
  const chunks=[];let total=0;
  try{
   while(true){
    const part=await reader.read();
    if(controller.signal.aborted)throw new DiscoveryError('OAuth discovery timed out');
    if(part.done)break;
    if(!(part.value instanceof Uint8Array))throw new DiscoveryError('OAuth discovery did not return readable JSON');
    total+=part.value.byteLength;
    if(total>65536)throw new DiscoveryError('OAuth discovery response is too large');
    chunks.push(part.value);
   }
  }catch(error){cancelBody();throw error;}
  finally{try{reader.releaseLock();}catch{}}
  let metadata;
  try{metadata=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total)));}
  catch{throw new DiscoveryError('OAuth discovery did not return valid JSON');}
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw new DiscoveryError('OAuth discovery must return a JSON object');
  if(metadata.resource!==url)throw new DiscoveryError('OAuth discovery resource does not match this exact MCP endpoint');
  const issuers=metadata.authorization_servers;
  if(!Array.isArray(issuers)||issuers.length===0)throw new DiscoveryError('OAuth discovery did not advertise an authorization server');
  for(const issuer of issuers){
   let auth;try{if(typeof issuer!=='string')throw Error();auth=new URL(issuer);}catch{throw new DiscoveryError('OAuth authorization server URL is invalid');}
   if(auth.protocol!=='https:'||auth.username||auth.password||auth.search||auth.hash||auth.href.endsWith('?')||auth.href.endsWith('#'))throw new DiscoveryError('OAuth authorization server URL must use plain HTTPS');
  }
  return {endpoint:url,metadataURL};
 })();
 try{return await Promise.race([readMetadata,deadline]);}
 catch(error){cancelBody();if(error instanceof DiscoveryError)throw error;throw unavailable();}
 finally{clearTimeout(timer);}
}
function options(args){
 const out={configOnly:false};
 for(let i=0;i<args.length;i++){
  const arg=args[i];
  if(arg==='--help'||arg==='-h')return {help:true};
  if(arg==='--config-only'){out.configOnly=true;continue;}
  if(!['--endpoint','--output','--server-name'].includes(arg))throw Error('Unknown argument; use --help');
  if(!args[i+1]||args[i+1].startsWith('--'))throw Error(arg+' needs a value');
  if(out[arg.slice(2)]!==undefined)throw Error('Duplicate argument '+arg);
  out[arg.slice(2)]=args[++i];
 }
 if(!out.endpoint||!out.output)throw Error('--endpoint and --output are required');
 if(out.configOnly&&!out['server-name'])throw Error('--config-only requires --server-name to preserve the existing connection identity');
 if(out['server-name'])out.serverName=checkedServerName(out['server-name']);
 delete out['server-name'];
 return out;
}
async function exportPlugin({endpoint,output,configOnly=false,serverName,fetchImpl=globalThis.fetch,discoveryTimeoutMs=10000}){
 if(configOnly&&!serverName)throw Error("Config-only export requires the existing server name");
 serverName=checkedServerName(serverName||SERVER_NAME);
 const destination=path.resolve(output);
 if(fs.existsSync(destination))throw Error('Output already exists; choose a new directory to preserve existing files');
 const parent=path.dirname(destination);
 if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw Error('Output parent directory must already exist');
 const verified=await verifyDiscovery(endpoint,fetchImpl,{timeoutMs:discoveryTimeoutMs}),config=configuration(verified.endpoint,serverName);
 const entries=new Map([['mcp.json',JSON.stringify(config.portable,null,2)+'\n'],['.mcp.json',JSON.stringify(config.legacy,null,2)+'\n']]);
 if(!configOnly){
  for(const name of ['plugin.json','.codex-plugin/plugin.json','skills/red-xai-task-router/SKILL.md','assets/bridge-icon.png']){
   const source=path.join(TEMPLATE,name);
   if(fs.lstatSync(source).isSymbolicLink())throw Error('Template contains an unexpected symbolic link');
   entries.set(name,fs.readFileSync(source));
  }
 }
 // Exclusive creation never replaces an existing connection or credential.
 fs.mkdirSync(destination,{mode:0o700});
 for(const [name,content] of entries){
  const file=path.join(destination,name);
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});
  fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
 }
 return {directory:destination,files:entries.size,mode:configOnly?'config-only':'new-private-plugin',version:VERSION,serverName,oauthApprovalRequired:true};
}
async function main(args){
 const opts=options(args);if(opts.help){console.log(HELP);return;}
 const result=await exportPlugin(opts);console.log(JSON.stringify(result,null,2));
 console.log('Keep this endpoint-bound package private. Use your client OAuth flow and approve pairing on your Bridge computer.');
 if(result.mode==='config-only')console.log('Update the existing private plugin configuration without replacing its identity, listing, skills or permissions.');
}
if(require.main===module)main(process.argv.slice(2)).catch(error=>{console.error('Bridge plugin setup: '+error.message);process.exitCode=1;});
module.exports={VERSION,SERVER_NAME,HELP,endpointURL,checkedServerName,configuration,verifyDiscovery,options,exportPlugin,main};
