'use strict';
const cp=require('node:child_process'),path=require('node:path');
const {promisify}=require('node:util');
const {installed}=require('./optional-tools.cjs');
const execFile=promisify(cp.execFile);
async function status({platform=process.platform,find=installed,run=execFile}={}){
 const bin=find('gh',{platform});
 if(!bin)return {installed:false,authenticated:false,message:'GitHub CLI is optional and is not installed. You can still update the Bridge.'};
 try{
  await run(bin,['auth','status','--hostname','github.com'],{timeout:10000,maxBuffer:32768,windowsHide:true});
  return {installed:true,authenticated:true,message:'GitHub CLI is signed in for repository workflows.'};
 }catch{
  return {installed:true,authenticated:false,message:'GitHub CLI is installed but not signed in. Choose Connect GitHub CLI to sign in.'};
 }
}
function commandForLogin(bin){
 if(typeof bin!=='string'||!path.isAbsolute(bin)||/[\r\n\0]/.test(bin))throw Error('Invalid GitHub CLI executable path');
 return "& '"+bin.replace(/'/g,"''")+"' auth login --hostname github.com --git-protocol https --web";
}
async function beginLogin({platform=process.platform,find=installed,spawn=cp.spawn,run=execFile}={}){
 const initial=await status({platform,find,run});
 if(!initial.installed)return {...initial,started:false};
 if(initial.authenticated)return {...initial,started:false};
 const bin=find('gh',{platform});
 if(platform==='win32'){
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  const encoded=Buffer.from(commandForLogin(bin),'utf16le').toString('base64');
  const child=spawn(ps,['-NoLogo','-NoProfile','-NoExit','-EncodedCommand',encoded],{windowsHide:false,detached:true,stdio:'ignore'});
  child.unref?.();
  return {installed:true,authenticated:false,started:true,message:'GitHub CLI sign-in opened in a terminal. Finish the browser/device authorization, then click Check GitHub CLI.'};
 }
 if(platform==='darwin'){
  const command=commandForLogin(bin).replace(/^& /,'') .replace(/''/g,"'") ;
  const script='tell application "Terminal" to do script '+JSON.stringify(command);
  await run('/usr/bin/osascript',['-e',script],{timeout:15000,maxBuffer:8192});
  return {installed:true,authenticated:false,started:true,message:'GitHub CLI sign-in opened in Terminal. Complete browser authorization.'};
 }
 if(platform==='linux'){
  const quote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
  const term=['x-terminal-emulator','gnome-terminal','konsole','xterm'].map(x=>find(x,{platform})).find(Boolean);
  if(!term)return {...initial,started:false,message:'Open a terminal and run: gh auth login --hostname github.com --web'};
  const script=quote(bin)+' auth login --hostname github.com --web; exec sh';
  const args=path.basename(term).startsWith('gnome-terminal')?['--','sh','-c',script]:['-e','sh','-c',script];
  const child=spawn(term,args,{detached:true,stdio:'ignore'});child.unref?.();
  return {installed:true,authenticated:false,started:true,message:'GitHub CLI sign-in opened in a terminal.'};
 }
 return {...initial,started:false,message:'Open Terminal and run: gh auth login --hostname github.com --web'};
}
module.exports={status,beginLogin,commandForLogin};
