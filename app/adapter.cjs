'use strict';
// Self-contained stdio-to-HTTP proxy. Runs with bundled Electron in Node mode.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),readline=require('node:readline');
const root=process.env.REDXDEX_DATA_DIR||path.join(os.homedir(),'.redxdex-ai-bridge');
let active=0;
async function send(m){
 const file=process.env.REDXDEX_CLIENT_KEY_FILE;if(!file)throw Error('Use Connect an AI in the running RedXDexAiBridge app to configure this client');
 const cred=JSON.parse(fs.readFileSync(file,'utf8')),runtime=JSON.parse(fs.readFileSync(path.join(root,'runtime.json'),'utf8'));
 const url=new URL(runtime.url);if(url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||url.pathname!=='/mcp'||url.username||url.password)throw Error('Invalid local gateway address');
 const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':'Bearer '+cred.token},body:JSON.stringify(m),signal:AbortSignal.timeout(115000)});
 if(res.status===202)return null;
 if(!res.ok)throw Error(res.status===401?'Client access was revoked. Pair the AI again in the bridge.':'Bridge returned HTTP '+res.status);
 return res.json();
}
const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
rl.on('line',async line=>{
 let m;try{
  if(Buffer.byteLength(line)>1048576)throw Error('Request too large');m=JSON.parse(line);
  if(active>=24)throw Error('Too many concurrent MCP requests');active++;
  try{const result=await send(m);if(result)process.stdout.write(JSON.stringify(result)+'\n');}finally{active--;}
 }catch(e){if(m?.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,error:{code:-32000,message:'RedXDexAiBridge: '+e.message}})+'\n');else process.stderr.write('RedXDexAiBridge: '+e.message+'\n');}
});
