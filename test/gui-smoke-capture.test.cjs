'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {build,validateCapture}=require('../scripts/gui-smoke-capture.cjs');
// A committed real PNG exercises evidence byte/dimension binding without desktop access.
const png=fs.readFileSync(path.join(__dirname,'../app/assets/bridge-icon.png'));
function fixture(){
 const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
 return{png,ownerPid:1234,windowHandle:'123456',metadata:{schema:1,captureMode:'desktopOwnedClientRect',ownerPid:1234,windowHandle:'123456',foreground:true,unobscured:true,coordinateSystem:'physical-pixels',bounds:{x:30,y:40,width,height},windowBounds:{x:20,y:10,width:width+20,height:height+40},distinctSampleColors:100,minBrightness:10,maxBrightness:240,sha256:crypto.createHash('sha256').update(png).digest('hex')}};
}
test('native GUI evidence binds actual PNG bytes, dimensions and exact window/process identity',()=>{
 const actual=fixture();assert.equal(validateCapture(actual),actual.metadata);
 for(const change of [{ownerPid:4321},{windowHandle:'654321'},{foreground:false},{unobscured:false},{captureMode:'unverifiedDesktop'},{coordinateSystem:'logical-pixels'}]){
  const bad=fixture();Object.assign(bad.metadata,change);assert.throws(()=>validateCapture(bad),/verified foreground fixture/);
 }
 const wrongBytes=fixture();wrongBytes.png=Buffer.from(png);wrongBytes.png[wrongBytes.png.length-1]^=1;assert.throws(()=>validateCapture(wrongBytes),/native capture evidence/);
 const wrongSize=fixture();wrongSize.metadata.bounds.width--;assert.throws(()=>validateCapture(wrongSize),/native capture evidence/);
});
test('blank, cropped or unbounded native GUI captures fail closed',()=>{
 for(const change of [{distinctSampleColors:1},{minBrightness:20,maxBrightness:21},{minBrightness:-1},{maxBrightness:256}]){
  const bad=fixture();Object.assign(bad.metadata,change);assert.throws(()=>validateCapture(bad),/rendered page detail/);
 }
 for(const change of [{x:0},{width:5000},{height:0},{x:NaN}]){
  const bad=fixture();Object.assign(bad.metadata.bounds,change);assert.throws(()=>validateCapture(bad),/bounds are invalid/);
 }
 const bad=fixture();bad.png=Buffer.from('not a PNG');assert.throws(()=>validateCapture(bad),/native capture evidence/);
});
test('capture compiler refuses execution outside hosted Windows CI',async context=>{
 if(process.platform==='win32'&&process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.env.RUNNER_OS==='Windows')return context.skip('The actual hosted-CI compiler and capture run in the GUI smoke step');
 await assert.rejects(build(),/requires hosted Windows CI/);
});
