'use strict';
const cp=require('node:child_process');
const {promisify}=require('node:util');
const {installed}=require('./optional-tools.cjs');
const execFile=promisify(cp.execFile);
const DEVICE_URL='https://github.com/login/device';
const DEVICE_CODE=/\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/;
let active=null;
async function status({platform=process.platform,find=installed,run=execFile}={}){
 const bin=find('gh',{platform});
 if(!bin)return {installed:false,authenticated:false,message:'GitHub CLI is optional. Bridge updates work without it.'};
 try{
  await run(bin,['auth','status','--hostname','github.com'],{timeout:10000,maxBuffer:32768,windowsHide:true});
  return {installed:true,authenticated:true,message:'GitHub CLI is signed in for repository workflows.'};
 }catch{
  return {installed:true,authenticated:false,message:'GitHub CLI is installed but not signed in. Choose Connect GitHub CLI.'};
 }
}
function deviceCodeFrom(output){
 const match=DEVICE_CODE.exec(String(output).toUpperCase());
 return match?.[1]||null;
}
async function beginLogin({platform=process.platform,find=installed,spawn=cp.spawn,run=execFile,open=()=>Promise.resolve(),timeoutMs=45000}={}){
 const initial=await status({platform,find,run});
 if(!initial.installed||initial.authenticated)return {...initial,started:false};
 if(active?.pending)return {...initial,started:true,...(active.code?{deviceCode:active.code,url:DEVICE_URL}:{}),message:active.code?'GitHub sign-in is running. Enter '+active.code+' at '+DEVICE_URL:'GitHub sign-in is starting.'};
 const bin=find('gh',{platform});
 if(!bin)return {...initial,started:false};
 const job={pending:true,code:null,child:null};
 active=job;
 return new Promise(resolve=>{
  let settled=false,buffer='',timer;
  const done=result=>{
   if(settled)return;settled=true;clearTimeout(timer);
   resolve(result);
  };
  try{
   const child=spawn(bin,['auth','login','--hostname','github.com','--git-protocol','https','--web'],{windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});
   job.child=child;
   timer=setTimeout(()=>{if(!job.code){try{child.kill()}catch{};job.pending=false;active=null;done({...initial,started:false,message:'GitHub CLI did not produce a device code. Open a terminal and run gh auth login --web.'});}},timeoutMs);
   timer.unref?.();
   const capture=data=>{
    buffer=(buffer+String(data)).slice(-8000);
    if(job.code)return;
    const code=deviceCodeFrom(buffer);
    if(code){
     job.code=code;
     Promise.resolve(open(DEVICE_URL)).catch(()=>{}).finally(()=>{
      done({installed:true,authenticated:false,started:true,deviceCode:code,url:DEVICE_URL,message:'GitHub authorization is ready. Open '+DEVICE_URL+' and enter code '+code+'. Then select Check GitHub CLI in Bridge.'});
     });
    }
   };
   child.stdout?.on('data',capture);child.stderr?.on('data',capture);
   child.on('error',e=>{job.pending=false;active=null;done({...initial,started:false,message:'Could not launch GitHub CLI: '+e.message});});
   child.on('close',code=>{
    job.pending=false;active=null;
    if(!settled)done({...initial,started:code===0,authenticated:code===0,message:code===0?'GitHub CLI authorization completed.':'GitHub CLI exited without a device code. Open a terminal and run gh auth login --web.'});
   });
  }catch(e){job.pending=false;active=null;done({...initial,started:false,message:'Could not start GitHub CLI: '+e.message});}
 });
}
module.exports={status,beginLogin,deviceCodeFrom,DEVICE_URL};
