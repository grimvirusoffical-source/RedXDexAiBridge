'use strict';
const cp=require('node:child_process'),crypto=require('node:crypto');
const {childEnvironment}=require('./platform.cjs');
class ProcessManager {
 constructor({limit=12,maxBytes=262144}={}) { this.limit=limit;this.maxBytes=maxBytes;this.sessions=new Map(); }
 start({command,args=[],cwd,clientId='local',timeoutMs=300000}) {
  if([...this.sessions.values()].filter(x=>x.running).length>=this.limit)throw Error('Concurrent process limit reached');
  if(typeof command!=='string'||!command||command.length>4096||!Array.isArray(args)||args.length>128||!args.every(x=>typeof x==='string'&&x.length<16384))throw Error('Invalid command or arguments');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>3600000)throw Error('Timeout must be 1 second to 1 hour');
  while(this.sessions.size>=100){const old=[...this.sessions.entries()].find(([,v])=>!v.running);if(!old)break;this.sessions.delete(old[0]);}
  const child=cp.spawn(command,args,{cwd,shell:false,detached:process.platform!=='win32',env:childEnvironment(),stdio:['pipe','pipe','pipe']});
  const id=crypto.randomUUID(),s={id,clientId,pid:child.pid,command,cwd,startedAt:Date.now(),running:true,output:'',offset:0,exitCode:null,child};
  this.sessions.set(id,s);
  const append=b=>{s.output+=b.toString();if(Buffer.byteLength(s.output)>this.maxBytes){const buf=Buffer.from(s.output);s.offset+=buf.length-this.maxBytes;s.output=buf.subarray(-this.maxBytes).toString();}};
  child.stdout.on('data',append);child.stderr.on('data',append);child.stdin.on('error',()=>{});
  child.on('error',e=>append('\n'+e.message));
  child.on('close',(code,signal)=>{s.running=false;s.exitCode=code;s.signal=signal;clearTimeout(s.timer);});
  s.timer=setTimeout(()=>{append('\nProcess timed out');this.stop(id,clientId);},timeoutMs);s.timer.unref();
  return this.info(s);
 }
 info({child,timer,output,...s}) { return {...s,outputBytes:Buffer.byteLength(output)}; }
 own(id,clientId){const s=this.sessions.get(id);if(!s||s.clientId!==clientId)throw Error('Process does not belong to this client');return s;}
 read(id,clientId){const s=this.own(id,clientId);return {...this.info(s),output:s.output};}
 input(id,clientId,text){const s=this.own(id,clientId);if(!s.running)throw Error('Process is not running');if(typeof text!=='string'||Buffer.byteLength(text)>65536)throw Error('Input too large');s.child.stdin.write(text);return this.info(s);}
 stop(id,clientId){const s=this.own(id,clientId);if(s.running){try{if(process.platform!=='win32'&&s.pid)process.kill(-s.pid,'SIGTERM');else s.child.kill();}catch{}const t=setTimeout(()=>{if(s.running){try{if(process.platform!=='win32'&&s.pid)process.kill(-s.pid,'SIGKILL');else s.child.kill('SIGKILL');}catch{}}},1500);t.unref();}return this.info(s);}
 list(clientId){return [...this.sessions.values()].filter(s=>s.clientId===clientId).map(s=>this.info(s));}
 stopClient(clientId){for(const s of this.sessions.values())if(s.clientId===clientId&&s.running)this.stop(s.id,clientId);}
 stopAll(){for(const s of this.sessions.values())if(s.running)this.stop(s.id,s.clientId);}
}
module.exports={ProcessManager};
