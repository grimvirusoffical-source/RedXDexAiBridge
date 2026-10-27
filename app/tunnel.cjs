'use strict';
const fs=require('node:fs'),cp=require('node:child_process');
class Tunnel {
 constructor(emit=()=>{}){this.emit=emit;this.child=null;this.state={phase:'off',url:null,message:'Remote access is off'};}
 status(){return {...this.state};}
 set(v){this.state={...this.state,...v};this.emit(this.status());}
 start(localURL){
  if(this.child)return Promise.resolve(this.status());
  const bin=['/opt/homebrew/bin/cloudflared','/usr/local/bin/cloudflared'].find(p=>fs.existsSync(p));if(!bin)throw Error('Install the official cloudflared client first. No tunnel software is bundled or silently downloaded.');
  const url=new URL(localURL);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('Tunnel upstream must be loopback');
  this.set({phase:'starting',url:null,message:'Starting authenticated remote access…'});
  return new Promise((resolve,reject)=>{
   const child=cp.spawn(bin,['tunnel','--url',url.origin,'--no-autoupdate','--protocol','http2'],{stdio:['ignore','ignore','pipe']});this.child=child;let settled=false,buffer='';
   const timer=setTimeout(()=>{if(!settled){settled=true;this.stop();reject(Error('Tunnel did not become ready. Check network access.'));}},45000);
   child.stderr.on('data',b=>{buffer=(buffer+b.toString()).slice(-8192);const m=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(m&&!settled){settled=true;clearTimeout(timer);this.set({phase:'online',url:m[0]+'/mcp',message:'Temporary HTTPS endpoint. Its address changes after stopping the tunnel; reconnect remote clients afterward.'});resolve(this.status());}});
   child.on('error',e=>{clearTimeout(timer);this.child=null;this.set({phase:'error',url:null,message:e.message});if(!settled){settled=true;reject(e);}});
   child.on('exit',()=>{clearTimeout(timer);if(this.child===child)this.child=null;this.set({phase:'off',url:null,message:'Remote tunnel is stopped'});if(!settled){settled=true;reject(Error('Tunnel exited before connecting'));}});
  });
 }
 stop(){this.child?.kill('SIGTERM');this.child=null;this.set({phase:'off',url:null,message:'Remote access is off'});return this.status();}
}
module.exports={Tunnel};
