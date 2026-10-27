'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');

function nodeCommand(){
  const fromPath=process.env.REDXDEX_NODE_PATH;
  if(fromPath&&path.isAbsolute(fromPath)&&fs.existsSync(fromPath))return fromPath;
  if(!process.versions.electron&&process.execPath.endsWith('node'))return process.execPath;
  for(const p of ['/opt/homebrew/bin/node','/usr/local/bin/node','/usr/bin/node'])if(fs.existsSync(p))return p;
  try{const found=cp.execFileSync('/usr/bin/which',['node'],{encoding:'utf8',timeout:2000}).trim();if(found&&path.isAbsolute(found))return found;}catch{}
  throw Error('Node.js not found. Install Node.js 22+ and restart the bridge.');
}
function mcpEntry(){return path.join(__dirname,'mcp.cjs');}
function serverSpec(){return {command:nodeCommand(),args:[mcpEntry()]};}
function configFor(client,spec=serverSpec()){return client==='vscode'?{servers:{RedXDexAiBridge:{type:'stdio',...spec}}}:{mcpServers:{RedXDexAiBridge:spec}};}
function configPath(client){
 if(client==='claude')return process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Claude','claude_desktop_config.json'):process.platform==='win32'?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Claude','claude_desktop_config.json'):path.join(os.homedir(),'.config','Claude','claude_desktop_config.json');
 if(client==='vscode')return process.platform==='darwin'?path.join(os.homedir(),'Library','Application Support','Code','User','mcp.json'):process.platform==='win32'?path.join(process.env.APPDATA||path.join(os.homedir(),'AppData','Roaming'),'Code','User','mcp.json'):path.join(os.homedir(),'.config','Code','User','mcp.json');
 if(client==='cursor')return path.join(os.homedir(),'.cursor','mcp.json');
 throw Error('Unsupported client: '+client);
}
function addClient(client,{destination=configPath(client),spec=serverSpec()}={}){
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
