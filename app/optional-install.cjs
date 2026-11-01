'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {findExecutable}=require('./platform.cjs');
const {IDS,installed}=require('./optional-tools.cjs');
const names={node:{brew:'node',apt:['nodejs','npm'],dnf:['nodejs','npm'],pacman:['nodejs','npm']},
 git:{brew:'git',apt:['git'],dnf:['git'],pacman:['git']},
 gh:{brew:'gh',apt:['gh'],dnf:['gh'],pacman:['github-cli']}};
function plan(tool,{platform=process.platform,lookup=findExecutable,env=process.env,exists=fs.existsSync}={}){
 if(!Object.hasOwn(IDS,tool))throw Error('Unknown optional tool');
 if(installed(tool,{platform,env,exists,lookup}))return {tool,available:false,installed:true,message:IDS[tool].label+' is already installed.'};
 let provider,executable,args;
 if(platform==='win32'){
  executable=lookup('winget',platform,env);
  const candidate=path.win32.join(env.LOCALAPPDATA||'C:\\Users\\Default\\AppData\\Local','Microsoft','WindowsApps','winget.exe');
  if(!executable&&exists(candidate))executable=candidate;
  if(executable){provider='winget';args=['install','--id',IDS[tool].winget,'--exact','--source','winget','--silent','--accept-source-agreements','--accept-package-agreements'];}
 }else if(platform==='darwin'){
  executable=lookup('brew',platform,env);
  if(executable){provider='Homebrew';args=['install',names[tool].brew];}
 }else if(platform==='linux'){
  for(const [binary,id,parts] of [['apt-get','apt',names[tool].apt],['dnf','dnf',names[tool].dnf],['pacman','pacman',names[tool].pacman]]){
   const found=lookup(binary,platform,env);
   if(found){executable=found;provider=id;args=id==='apt'?['install','-y',...parts]:id==='dnf'?['install','-y',...parts]:['-S','--needed',...parts];break;}
  }
 }
 if(!executable)return {tool,installed:false,available:false,message:'No supported package manager detected. Install '+IDS[tool].label+' through your operating system package manager.'};
 return {tool,installed:false,available:true,provider,executable,args,reason:IDS[tool].reason};
}
function quoteShell(s){return "'"+String(s).replace(/'/g,"'\\''")+"'";}
async function begin(tool,{platform=process.platform,lookup=findExecutable,spawn=cp.spawn,run=async(...params)=>require('node:util').promisify(cp.execFile)(...params),env=process.env,exists=fs.existsSync}={}){
 const p=plan(tool,{platform,lookup,env,exists});
 if(!p.available)return {...p,started:false};
 let child;
 if(platform==='win32'){
  // Winget runs without a detached console, so the caller observes actual
  // completion and any package-manager errors. A UAC prompt can still appear.
  try{
   await run(p.executable,p.args,{timeout:300000,maxBuffer:65536,windowsHide:true});
   return {...p,started:true,completed:true,message:IDS[tool].label+' installation completed. Recheck installed tools; a new terminal may be needed for PATH changes.'};
  }catch(error){
   return {...p,started:false,completed:false,message:IDS[tool].label+' could not be installed automatically ('+(error.code||'installer error')+'). The Bridge itself remains available.'};
  }
 }else if(platform==='darwin'){
  const command=quoteShell(p.executable)+' '+p.args.map(quoteShell).join(' ');
  const applescript='tell application "Terminal" to do script '+JSON.stringify(command);
  await run('/usr/bin/osascript',['-e',applescript],{timeout:15000});
  return {...p,started:true,message:'Opened Terminal with '+IDS[tool].label+' installation. Follow the displayed instructions.'};
 }else if(platform==='linux'){
  const term=['x-terminal-emulator','gnome-terminal','konsole','xterm'].map(n=>lookup(n,platform,env)).find(Boolean);
  if(!term)return {...p,started:false,message:'Open a terminal and run: sudo '+p.executable+' '+p.args.join(' ')};
  const script='sudo '+quoteShell(p.executable)+' '+p.args.map(quoteShell).join(' ')+'; exec sh';
  const terminalArgs=path.basename(term).startsWith('gnome-terminal')?['--','sh','-c',script]:['-e','sh','-c',script];
  child=spawn(term,terminalArgs,{detached:true,windowsHide:false,stdio:'ignore'});
 }else return {...p,started:false,message:'Platform not supported for optional installation.'};
 child.on?.('error',()=>{});
 child.unref?.();
 return {...p,started:true,message:'Opened an installation terminal for '+IDS[tool].label+'. Complete any operating-system prompts there.'};
}
module.exports={plan,begin};
