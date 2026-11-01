'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {findExecutable}=require('./platform.cjs');
const IDS=Object.freeze({
 node:{label:'Node.js',winget:'OpenJS.NodeJS.LTS',reason:'Optional for Node-based scripts and source builds. The installed Bridge and its MCP adapters work without external Node.js.'},
 git:{label:'Git',winget:'Git.Git',reason:'Optional for cloning, commits and branches. Public Bridge updates work without Git.'},
 gh:{label:'GitHub CLI',winget:'GitHub.cli',reason:'Optional for GitHub repository authentication and terminal workflows. Bridge updates do not require it.'}
});
function installed(name,{platform=process.platform,env=process.env,exists=file=>fs.existsSync(file),lookup=findExecutable}={}){
 if(!Object.hasOwn(IDS,name))throw Error('Unknown optional tool');
 const native=lookup(name,platform,env);
 if(native)return native;
 if(platform!=='win32')return null;
 const roots=[env.ProgramFiles,env['ProgramFiles(x86)'],env.LOCALAPPDATA,env.USERPROFILE||path.win32.join(os.homedir(),'AppData','Local')].filter(Boolean);
 const candidates={
  node:roots.flatMap(root=>[path.win32.join(root,'nodejs','node.exe'),path.win32.join(root,'Programs','nodejs','node.exe')]),
  git:roots.flatMap(root=>[path.win32.join(root,'Git','cmd','git.exe'),path.win32.join(root,'Git','bin','git.exe'),path.win32.join(root,'Programs','Git','cmd','git.exe')]),
  gh:roots.flatMap(root=>[path.win32.join(root,'GitHub CLI','gh.exe'),path.win32.join(root,'Programs','GitHub CLI','gh.exe'),path.win32.join(root,'Microsoft','WinGet','Links','gh.exe')])
 };
 return candidates[name].find(file=>{try{return exists(file);}catch{return false;}})||null;
}
function status(options={}){
 return Object.fromEntries(Object.entries(IDS).map(([id,definition])=>{
  const found=installed(id,options);return [id,{...definition,installed:!!found,path:found||null}];
 }));
}
module.exports={IDS,installed,status};
