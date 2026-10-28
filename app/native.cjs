'use strict';
const platform=require('./platform.cjs');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const execFile=require('node:util').promisify(cp.execFile);
async function helper(){
 const packaged=process.resourcesPath&&path.join(process.resourcesPath,process.platform==='win32'?'redxdex-control.exe':'redxdex-control');if(packaged&&fs.existsSync(packaged))return packaged;
 const built=path.join(__dirname,'..','build',process.platform==='win32'?'redxdex-control.exe':'redxdex-control');if(fs.existsSync(built))return built;
 throw Error('Native helper is not built. Run npm run prepare:native, or use the signed application.');
}
async function control(input){if(process.platform==='linux')return platform.linuxInput(input);if(process.platform==='win32')return platform.windowsInput(await helper(),input);platform.validateInput(input);const {stdout}=await execFile(await helper(),[JSON.stringify(input)],{timeout:15000,maxBuffer:100000});return JSON.parse(stdout);}
function permissionStatus(helper, screenStatus) {
 return {...helper, helperScreenRecording:!!helper.screenRecording,
  screenRecording:screenStatus==='granted', screenRecordingStatus:screenStatus,
  screenRecordingMessage:screenStatus==='granted'
   ? 'The signed app has Screen Recording permission. Use the screenshot test to verify capture.'
   : 'Enable RedXDexAiBridge in macOS Screen & System Audio Recording, then quit and reopen the app. A helper permission does not authorize the app itself.'};
}
async function screenshot(){
 if(process.platform!=='darwin'){const electron=require('electron');if(!electron.desktopCapturer)throw Error('Screen capture requires the running desktop app.');const sources=await electron.desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:1920,height:1080}});if(!sources.length||sources[0].thumbnail.isEmpty())throw Error('No display capture is available. Approve the operating-system screen-sharing prompt.');const bytes=sources[0].thumbnail.toPNG();if(bytes.length>8*1024*1024)throw Error('Screenshot exceeds the 8 MB limit');return bytes.toString('base64');}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-screen-'));fs.chmodSync(dir,0o700);const file=path.join(dir,'screen.png');
 try{await execFile('/usr/sbin/screencapture',['-x','-t','png',file],{timeout:15000});if(!fs.existsSync(file))throw Error('Screen capture failed. Grant Screen Recording permission in macOS Settings.');const bytes=fs.readFileSync(file);if(bytes.length>8*1024*1024)throw Error('Screenshot exceeds the 8 MB limit');return bytes.toString('base64');}catch(error){
 const reason=String(error.stderr||error.message||error);
 if(/could not create image|not authorized|permission|denied/i.test(reason))throw Error('Screen capture was blocked or unavailable. Enable RedXDexAiBridge in macOS Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen the app. Permission granted to another app or helper does not prove this app can capture the display.');
 throw error;
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={control,screenshot,helper,permissionStatus};
