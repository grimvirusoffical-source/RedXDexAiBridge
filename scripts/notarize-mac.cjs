'use strict';
// electron-builder afterSign hook. Credentials stay in a user-approved
// notarytool Keychain profile; this script never reads or exports them.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process');
const execFile=require('node:util').promisify(cp.execFile);
module.exports=async context=>{
 if(context.electronPlatformName!=='darwin')return;
 const reportDir=path.resolve(context.packager.projectDir,'verification');fs.mkdirSync(reportDir,{recursive:true});
 const reportFile=path.join(reportDir,'notarization.json');
 const profile=process.env.REDXAI_NOTARY_PROFILE||process.env.APPLE_NOTARY_PROFILE||process.env.APPLE_KEYCHAIN_PROFILE;
 if(!profile){
  fs.writeFileSync(reportFile,JSON.stringify({status:'not-submitted',reason:'No approved notarytool Keychain profile was supplied.',signed:true},null,2));
  if(process.env.REDXAI_REQUIRE_NOTARIZATION==='1')throw Error('Set REDXAI_NOTARY_PROFILE to an approved notarytool Keychain profile. No credentials are bundled.');
  console.log('Developer ID signed only: Apple notarization was not submitted because a Keychain profile was not supplied.');return;
 }
 if(profile.length>128||/[\r\n\0]/.test(profile))throw Error('Invalid notarization profile name');
 const app=path.join(context.appOutDir,context.packager.appInfo.productFilename+'.app');
 await execFile('/usr/bin/codesign',['--verify','--deep','--strict',app]);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxai-notary-')),zip=path.join(dir,'Bridge-notarization.zip');
 try{
  await execFile('/usr/bin/ditto',['-c','-k','--keepParent',app,zip],{timeout:180000});
  const {stdout}=await execFile('/usr/bin/xcrun',['notarytool','submit',zip,'--keychain-profile',profile,'--wait','--output-format','json'],{timeout:1200000,maxBuffer:1048576});
  const result=JSON.parse(stdout);
  fs.writeFileSync(reportFile,JSON.stringify({id:result.id,status:result.status,signed:true},null,2));
  if(result.status!=='Accepted')throw Error('Apple did not accept this notarization submission; release publication must remain blocked.');
  await execFile('/usr/bin/xcrun',['stapler','staple',app],{timeout:120000});
  await execFile('/usr/bin/xcrun',['stapler','validate',app],{timeout:60000});
  await execFile('/usr/sbin/spctl',['--assess','--type','execute','--verbose=2',app],{timeout:60000});
  fs.writeFileSync(reportFile,JSON.stringify({id:result.id,status:'Accepted',stapled:true,gatekeeperPassed:true,signed:true},null,2));
 }catch(error){
  // Never include command output that might contain authentication diagnostics.
  if(!fs.existsSync(reportFile))fs.writeFileSync(reportFile,JSON.stringify({status:'failed',signed:true,reason:'Notarization or stapling failed. Inspect the local Apple tooling with your approved profile.'},null,2));
  throw Error('Apple notarization/stapling did not complete. See verification/notarization.json; no release should claim notarized status.');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
};
