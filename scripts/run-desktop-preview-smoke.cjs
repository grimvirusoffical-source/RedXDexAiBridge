'use strict';
const cp=require('node:child_process'),path=require('node:path');
function runDesktopPreviewSmoke(){
 const script=path.join(__dirname,'desktop-preview-ui-smoke.cjs'),kind=process.env.BRIDGE_TEST_ASAR?'packaged':'source';
 // A separate hidden Electron process gives the preview fixture its own IPC
 // namespace/profile while the existing production/sign-in proof is retained.
 return new Promise((resolve,reject)=>cp.execFile(process.execPath,[script,...(process.platform==='linux'?['--no-sandbox']:[])],{windowsHide:true,timeout:30000,killSignal:'SIGKILL',maxBuffer:1024*1024,env:{...process.env,REDXDEX_DESKTOP_PREVIEW_SMOKE_OUTPUT:path.join(__dirname,'..','verification','desktop-preview-ui',kind)}},(error,stdout,stderr)=>{
  if(error){const failure=Error('Inactive shop '+kind+' UI smoke failed: '+String(stderr||stdout||error.message).slice(0,4000));reject(failure);return;}
  process.stdout.write(stdout);if(stderr)process.stderr.write(stderr);resolve();
 }));
}
module.exports={runDesktopPreviewSmoke};
