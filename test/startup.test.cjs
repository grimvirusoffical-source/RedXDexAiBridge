'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configureStartup}=require('../app/startup.cjs');
test('macOS and Windows use native login startup without bypassing user settings',()=>{
 let value;const app={setLoginItemSettings:v=>{value=v;}};
 assert.equal(configureStartup(app,true,{platform:'darwin'}).enabled,true);
 assert.deepEqual(value,{openAtLogin:true});
 configureStartup(app,false,{platform:'darwin'});assert.deepEqual(value,{openAtLogin:false});
 assert.throws(()=>configureStartup(app,'yes',{platform:'darwin'}),/boolean/);
});
test('Windows startup preserves existing tunnel identity and reconnects temporary relays',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-win-startup-'));
 let value;const app={setLoginItemSettings:v=>{value=v;}};
 try{
  let result=configureStartup(app,true,{platform:'win32',homeDirectory:home,remoteAutoConnect:false});
  assert.equal(result.secureTunnelConfigured,false);
  assert.deepEqual(value,{openAtLogin:true});
  result=configureStartup(app,true,{platform:'win32',homeDirectory:home,remoteAutoConnect:true});
  assert.deepEqual(value,{openAtLogin:true,args:['--connect-remote']});
  const dir=path.join(home,'.redxdex-ai-bridge');fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,'openai-tunnel-id.txt'),'fixture');
  result=configureStartup(app,true,{platform:'win32',homeDirectory:home});
  assert.equal(result.secureTunnelConfigured,true);
  assert.deepEqual(value,{openAtLogin:true});
  configureStartup(app,false,{platform:'win32',homeDirectory:home});
  assert.deepEqual(value,{openAtLogin:false});
  assert.throws(()=>configureStartup(app,'yes',{platform:'win32',homeDirectory:home}),/boolean/);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('Linux startup quotes its executable and removes only its managed entry',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-startup-'));
 try{
  const executable=path.join(root,'Bridge 100% $test.AppImage');fs.writeFileSync(executable,'fixture');
  const options={platform:'linux',configDirectory:root,env:{APPIMAGE:executable}};
  configureStartup({getPath:()=>executable},true,options);
  const file=path.join(root,'autostart','redxdex-ai-bridge.desktop'),text=fs.readFileSync(file,'utf8');
  assert.match(text,/X-RedXAI-Managed=true/);assert.ok(text.includes('100%% \\$test.AppImage'));assert.match(text,/Exec="/);
  configureStartup({},false,options);assert.equal(fs.existsSync(file),false);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Linux refuses to replace custom autostart configuration',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-startup-'));
 try{
  const dir=path.join(root,'autostart');fs.mkdirSync(dir);const file=path.join(dir,'redxdex-ai-bridge.desktop');
  fs.writeFileSync(file,'custom entry');const options={platform:'linux',configDirectory:root,env:{}};
  assert.throws(()=>configureStartup({},false,options),/unmanaged/);assert.equal(fs.readFileSync(file,'utf8'),'custom entry');

 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Linux refuses symlinked startup entries',{skip:process.platform==='win32'?'Windows symlink creation needs additional OS privileges; this Linux-only case runs on Linux CI':false},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-startup-link-'));
 try{const dir=path.join(root,'autostart');fs.mkdirSync(dir);const file=path.join(dir,'redxdex-ai-bridge.desktop');fs.symlinkSync(path.join(root,'absent'),file);assert.throws(()=>configureStartup({},false,{platform:'linux',configDirectory:root,env:{}}),/unmanaged/);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
