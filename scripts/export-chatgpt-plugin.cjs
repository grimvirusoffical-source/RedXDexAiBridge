#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
const VERSION='0.1.9',SERVER_NAME='red-xai-bridge';
const TEMPLATE=path.join(__dirname,'../distribution/chatgpt-plugin/template');
const HELP='Red-XAI Bridge private plugin setup '+VERSION+'\n'+
 'node scripts/export-chatgpt-plugin.cjs --endpoint HTTPS_MCP_URL --output NEW_DIRECTORY [--config-only]\n\n'+
 'Use the verified URL from your own Bridge Connections page. This checks public OAuth\n'+
 'discovery and writes configuration only; it never signs in or changes permissions.\n'+
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
 // Native Codex rejects server-level extensions. OAuth remains the host's
 // default and is established through protected-resource discovery.
 const servers={[serverName]:{type:'streamable-http',url,headers:{}}};
 return {portable:{$schema:'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',mcpServers:servers},legacy:{mcpServers:servers}};
}
async function verifyDiscovery(endpoint,fetchImpl=globalThis.fetch){
 const url=endpointURL(endpoint);
 if(typeof fetchImpl!=='function')throw Error('Node.js 20 or newer is required');
 const metadataURL=new URL('/.well-known/oauth-protected-resource/mcp',url).href;
 let response;try{response=await fetchImpl(metadataURL,{redirect:'error',signal:AbortSignal.timeout(10000),headers:{Accept:'application/json'}});}
 catch{throw Error('OAuth discovery could not be verified; check Bridge is online');}
 if(!response?.ok)throw Error('OAuth discovery returned HTTP '+(response?.status??'error'));
 const body=await response.text();
 if(body.length>65536)throw Error('OAuth discovery response is too large');
 let metadata;try{metadata=JSON.parse(body);}catch{throw Error('OAuth discovery did not return valid JSON');}
 if(metadata.resource!==url)throw Error('OAuth discovery resource does not match this exact MCP endpoint');
 const issuers=metadata.authorization_servers;
 if(!Array.isArray(issuers)||issuers.length===0)throw Error('OAuth discovery did not advertise an authorization server');
 for(const issuer of issuers){
  let auth;try{auth=new URL(issuer);}catch{throw Error('OAuth authorization server is invalid');}
  if(auth.protocol!=='https:'||auth.username||auth.password||auth.search||auth.hash)throw Error('OAuth authorization server must use plain HTTPS');
 }
 return {endpoint:url,metadataURL};
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
async function exportPlugin({endpoint,output,configOnly=false,serverName,fetchImpl=globalThis.fetch}){
 if(configOnly&&!serverName)throw Error("Config-only export requires the existing server name");
 serverName=checkedServerName(serverName||SERVER_NAME);
 const destination=path.resolve(output);
 if(fs.existsSync(destination))throw Error('Output already exists; choose a new directory to preserve existing files');
 const parent=path.dirname(destination);
 if(!fs.existsSync(parent)||!fs.statSync(parent).isDirectory())throw Error('Output parent directory must already exist');
 const verified=await verifyDiscovery(endpoint,fetchImpl),config=configuration(verified.endpoint,serverName);
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
