'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {configureStartup}=require('../app/startup.cjs');
test('macOS and Windows use the native startup API and validate preferences',()=>{
 for(const platform of ['darwin','win32']){
  let value;const app={setLoginItemSettings:v=>{value=v;}};
  assert.equal(configureStartup(app,true,{platform}).enabled,true);assert.deepEqual(value,{openAtLogin:true});
  configureStartup(app,false,{platform});assert.deepEqual(value,{openAtLogin:false});
  assert.throws(()=>configureStartup(app,'yes',{platform}),/boolean/);
 }
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
test('Linux refuses to replace custom or symlinked autostart configuration',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-startup-'));
 try{
  const dir=path.join(root,'autostart');fs.mkdirSync(dir);const file=path.join(dir,'redxdex-ai-bridge.desktop');
  fs.writeFileSync(file,'custom entry');const options={platform:'linux',configDirectory:root,env:{}};
  assert.throws(()=>configureStartup({},false,options),/unmanaged/);assert.equal(fs.readFileSync(file,'utf8'),'custom entry');
  fs.unlinkSync(file);fs.symlinkSync(path.join(root,'absent'),file);
  assert.throws(()=>configureStartup({},false,options),/unmanaged/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
