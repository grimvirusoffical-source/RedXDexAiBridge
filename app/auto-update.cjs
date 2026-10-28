'use strict';
function createUpdateController({app, autoUpdater, store, emit=()=>{}, platform=process.platform}){
 let state={phase:'idle',installedVersion:app.getVersion(),availableVersion:null,progress:0,autoDownload:!!store.get('autoDownload'),canInstall:false,message:'Update service idle'};
 const push=(partial)=>{state={...state,...partial};emit({...state});};
 const eligible=()=>app.isPackaged && ['darwin','win32','linux'].includes(platform) && !process.env.REDXDEX_DISABLE_UPDATES;
 function init(){
  if(!eligible()){push({phase:'unavailable',message:'Automatic installation requires an installed release package and a published GitHub release.'});return;}
  autoUpdater.autoDownload=state.autoDownload;autoUpdater.autoInstallOnAppQuit=true;autoUpdater.allowPrerelease=false;autoUpdater.allowDowngrade=false;
  autoUpdater.on('checking-for-update',()=>push({phase:'checking',message:'Checking GitHub release metadata…'}));
  autoUpdater.on('update-available',i=>push({phase:'available',availableVersion:i.version,message:`Version ${i.version} available.`}));
  autoUpdater.on('update-not-available',()=>push({phase:'current',message:'You are up to date.'}));
  autoUpdater.on('download-progress',i=>push({phase:'downloading',progress:Math.round(i.percent),message:`Downloading release · ${Math.round(i.percent)}%`}));
  autoUpdater.on('update-downloaded',i=>push({phase:'ready',canInstall:true,availableVersion:i.version,message:`Version ${i.version} downloaded. Restart to install.`}));
  autoUpdater.on('error',e=>push({phase:'error',canInstall:false,message:`Update failed: ${e.message}`}));
 }
 async function check(){if(!eligible())throw Error('Updates require an installed release package.');return autoUpdater.checkForUpdates();}
 async function download(){if(!eligible())throw Error('Updates require an installed release package.');if(state.phase!=='available')throw Error('Check for a new version first.');return autoUpdater.downloadUpdate();}
 function install(){if(!state.canInstall||state.phase!=='ready')throw Error('No downloaded update available.');autoUpdater.quitAndInstall(false,true);return {restarting:true};}
 function setAutoDownload(on){if(typeof on!=='boolean')throw Error('Expected boolean');store.set('autoDownload',on);autoUpdater.autoDownload=on;push({autoDownload:on});return {...state};}
 return {init,check,download,install,setAutoDownload,status:()=>({...state})};
}
module.exports={createUpdateController};
