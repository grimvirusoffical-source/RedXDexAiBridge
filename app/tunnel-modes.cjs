'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
function safeOrigin(value) {
 const u=new URL(value);
 if(u.protocol!=='https:'||u.pathname!=='/'||u.search||u.hash||u.username||u.password||
    u.port||u.hostname==='localhost'||u.hostname.endsWith('.localhost')||
    u.hostname.endsWith('.trycloudflare.com')||!u.hostname.includes('.'))
  throw Error('A persistent Cloudflare Tunnel requires your own HTTPS hostname, not trycloudflare.com');
 return u.origin;
}
function validateRemoteConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid MCP tunnel configuration');
 if(value.mode==='local'||value.mode==='temporary')
  return {mode:value.mode,autoConnect:value.autoConnect===true};
 if(value.mode==='named'){
  if(typeof value.configFile!=='string'||!path.isAbsolute(value.configFile)||
     !/\.ya?ml$/i.test(value.configFile))throw Error('Named tunnel requires an absolute Cloudflare YAML configuration path');
  if(!Number.isInteger(value.localPort)||value.localPort<1024||value.localPort>65535)
   throw Error('Named tunnel local port must be 1024-65535');
  return {mode:'named',configFile:path.normalize(value.configFile),
    localPort:value.localPort,publicOrigin:safeOrigin(value.publicOrigin),
    autoConnect:value.autoConnect===true};
 }
 if(value.mode==='ssh')return require('./tunnel.cjs').validateRelay(value);
 throw Error('Unsupported MCP tunnel mode');
}
function namedTunnelArguments(config,localURL){
 const c=validateRemoteConfig(config),u=new URL(localURL);
 if(c.mode!=='named'||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||
    Number(u.port)!==c.localPort||u.pathname!=='/mcp'||u.username||u.password)
  throw Error('Named tunnel must use its configured loopback MCP port');
 if(!fs.statSync(c.configFile).isFile())throw Error('Cloudflare YAML configuration file does not exist');
 // Cloudflare's external config file carries tunnel credentials; never read or print them.
 return ['tunnel','--config',c.configFile,'run'];
}
function defaultRemoteRoot(){return process.env.REDXDEX_DATA_DIR||path.join(os.homedir(),'.redxdex-ai-bridge');}
module.exports={safeOrigin,validateRemoteConfig,namedTunnelArguments,defaultRemoteRoot};
