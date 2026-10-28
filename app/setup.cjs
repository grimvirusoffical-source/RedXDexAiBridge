'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');

function nodeCommand(){
  const fromPath=process.env.REDXDEX_NODE_PATH;
  if(fromPath&&path.isAbsolute(fromPath)&&fs.existsSync(fromPath))return fromPath;
  if(!process.versions.electron&&/node(?:\.exe)?$/i.test(process.execPath))return process.execPath;
  const foundNode=require('./platform.cjs').findExecutable('node');if(foundNode)return foundNode;
  for(const p of ['/opt/homebrew/bin/node','/usr/local/bin/node','/usr/bin/node'])if(fs.existsSync(p))return p;
  try{const found=cp.execFileSync('/usr/bin/which',['node'],{encoding:'utf8',timeout:2000}).trim();if(found&&path.isAbsolute(found))return found;}catch{}
  throw Error('Node.js not found. Install Node.js 22+ and restart the bridge.');
}
function mcpEntry(){return path.join(__dirname,'mcp.cjs');}
function serverSpec(){return {command:nodeCommand(),args:[mcpEntry()]};}
function configFor(client,spec=serverSpec()){return client==='vscode'?{servers:{RedXDexAiBridge:{type:'stdio',...spec}}}:{mcpServers:{RedXDexAiBridge:spec}};}
function configPath(client){
 if(client==='codex')return path.join(os.homedir(),'.codex','config.toml');
 if(client==='claude')return process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Claude','claude_desktop_config.json'):process.platform==='win32'?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Claude','claude_desktop_config.json'):path.join(os.homedir(),'.config','Claude','claude_desktop_config.json');
 if(client==='vscode')return process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Code','User','mcp.json'):process.platform==='win32'?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Code','User','mcp.json'):path.join(os.homedir(),'.config','Code','User','mcp.json');
 if(client==='cursor')return path.join(os.homedir(),'.cursor','mcp.json');
 throw Error('Unsupported client: '+client);
}
function configureCodex(spec, destination) {
 if(destination!==configPath('codex'))throw Error('Only the default Codex configuration is supported');
 const bin=require('./platform.cjs').findExecutable('codex')||['/opt/homebrew/bin/codex','/usr/local/bin/codex',path.join(os.homedir(),'.local/bin/codex'),'/Applications/Codex.app/Contents/Resources/codex'].find(p=>fs.existsSync(p));
 if(!bin)throw Error('Codex CLI is not installed. Install the official Codex desktop/CLI first.');
 const previous=cp.spawnSync(bin,['mcp','get','RedXDexAiBridge','--json'],{encoding:'utf8',timeout:10000,maxBuffer:65536});
 if(previous.status===0){
  const entry=JSON.parse(previous.stdout),transport=entry.transport||entry;
  if(transport.env?.REDXDEX_MANAGED!=='1')throw Error('Existing Codex bridge entry is not managed by this app; refusing to replace it');
 }else if(fs.existsSync(destination)&&fs.readFileSync(destination,'utf8').includes('mcp_servers.RedXDexAiBridge')){
  throw Error('Cannot inspect the existing Codex bridge configuration safely');
 }
 const backup=fs.existsSync(destination)?destination+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-'):null;
 if(backup)fs.copyFileSync(destination,backup,fs.constants.COPYFILE_EXCL);
 const args=['mcp','add','RedXDexAiBridge'];
 for(const [key,value] of Object.entries(spec.env||{})){
  if(!/^[A-Z0-9_]+$/.test(key)||typeof value!=='string')throw Error('Invalid MCP environment');
  args.push('--env',key+'='+value);
 }
 args.push('--',spec.command,...spec.args);
 cp.execFileSync(bin,args,{encoding:'utf8',timeout:15000,maxBuffer:65536});
 return {client:'codex',path:destination,backup,message:'Codex MCP configured with the official CLI and its own bridge credentials. Reload Codex to discover the tools.'};
}
function addClient(client,{destination=configPath(client),spec=serverSpec()}={}){
 if(client==='codex')return configureCodex(spec,destination);
 if(!['claude','vscode','cursor'].includes(client))throw Error('Unsupported client');
 if(!path.isAbsolute(destination))throw Error('Config destination must be absolute');
 // Only the two documented default config locations are accepted by the UI.
 if(destination!==configPath(client))throw Error('Only the default client config is supported');
 fs.mkdirSync(path.dirname(destination),{recursive:true,mode:0o700});
 let doc={};let existed=fs.existsSync(destination);
 if(existed){doc=JSON.parse(fs.readFileSync(destination,'utf8'));if(!doc||Array.isArray(doc)||typeof doc!=='object')throw Error('Existing configuration is not a JSON object');}
 const section=client==='vscode'?'servers':'mcpServers';
 if(doc[section]!==undefined&&(!doc[section]||Array.isArray(doc[section])||typeof doc[section]!=='object'))throw Error('Existing MCP server section has an unexpected format');
 const prev=doc[section]?.RedXDexAiBridge;
 if(prev!==undefined&&prev.env?.REDXDEX_MANAGED!=='1'&&!String(prev.args?.[0]||'').toLowerCase().includes('redxdexaibridge'))throw Error('Existing RedXDexAiBridge entry is not managed by this app; refusing to overwrite');
 const backup=existed?destination+'.backup-'+new Date().toISOString().replace(/[:.]/g,'-'):null;
 if(backup)fs.copyFileSync(destination,backup,fs.constants.COPYFILE_EXCL);
 doc[section]={...(doc[section]||{}),RedXDexAiBridge:client==='vscode'?{type:'stdio',...spec}:spec};
 const temp=destination+'.tmp-'+process.pid;
 try{fs.writeFileSync(temp,JSON.stringify(doc,null,2)+'\n',{flag:'wx',mode:0o600});fs.renameSync(temp,destination);}catch(e){try{fs.unlinkSync(temp)}catch{}throw e;}
 return {client,path:destination,backup,message:'Installed '+client+' MCP configuration. Restart the AI client to load it.'};
}
function selfCheck(){const spec=serverSpec();const r=cp.spawnSync(spec.command,[...spec.args],{input:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'redxdex-self-test',version:'1'}}})+'\n',encoding:'utf8',timeout:4000,maxBuffer:200000});if(r.error)throw r.error;const line=r.stdout.split(/\r?\n/).find(Boolean);const parsed=JSON.parse(line);if(parsed.id!==1||!parsed.result?.serverInfo)throw Error('MCP server failed initialization');return {ok:true,version:parsed.result.serverInfo.version,entry:spec.args[0],node:spec.command};}
module.exports={nodeCommand,serverSpec,configFor,configPath,addClient,selfCheck};
