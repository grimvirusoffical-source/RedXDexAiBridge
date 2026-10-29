'use strict';
// Native controls are exercised only in this disposable, verified-focus window.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {app,BrowserWindow,screen}=require('electron');
const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-native-fixture-'));
app.setPath('userData',path.join(fixture,'userData'));
const native=require(process.env.REDXDEX_NATIVE_SOURCE||'../app/native.cjs');
const platform=require('../app/platform.cjs');
const control=process.env.REDXDEX_NATIVE_HELPER?async request=>{platform.validateInput(request);return JSON.parse(await platform.execute(path.resolve(process.env.REDXDEX_NATIVE_HELPER),[],JSON.stringify(request)));}:request=>native.control(request);
const output=process.env.REDXDEX_NATIVE_TEST_OUTPUT||path.resolve('verification/native.json');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[];let window;
async function focused(){
 assert.ok(window&&!window.isDestroyed()&&window.isFocused(),'Fixture lost focus; no input sent');
 assert.equal(await window.webContents.executeJavaScript('document.hasFocus()'),true);
}
async function input(request){await focused();await control(request);}
function point(x,y){
 const b=window.getContentBounds(),p={x:b.x+x,y:b.y+y};
 return process.platform==='win32'?screen.dipToScreenPoint(p):p;
}
function report(value){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(value,null,2));console.log(JSON.stringify(value));}
app.whenReady().then(async()=>{
 const area=screen.getPrimaryDisplay().workArea;
 window=new BrowserWindow({width:Math.min(660,area.width),height:Math.min(440,area.height),show:true,alwaysOnTop:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
 await window.loadURL('data:text/html,'+encodeURIComponent('<html><body style="margin:0;background:white;font:16px sans-serif;height:2000px"><h2>Red-XAI Bridge input verification</h2><p>Temporary fixture; no documents are edited.</p><textarea id="input" style="position:absolute;left:30px;top:100px;width:430px;height:170px"></textarea></body></html>'));
 window.show();window.focus();await pause(700);
 const status=await control({action:'status'});
 assert.equal(status.inputSupported??status.accessibility,true);checks.push('native status');
 await input({action:'move',...point(100,155)});
 await input({action:'click',...point(100,155)});await pause(150);await focused();
 assert.equal(await window.webContents.executeJavaScript('document.activeElement.id'),'input');checks.push('DPI-aware mouse move/click');
 await input({action:'type',text:'BRIDGE_NATIVE_TEST \u2713'});await pause(150);
 assert.equal(await window.webContents.executeJavaScript('document.getElementById("input").value'),'BRIDGE_NATIVE_TEST \u2713');checks.push('Unicode text');
 await input({action:'key',key:'a',modifiers:[process.platform==='darwin'?'command':'control']});
 await input({action:'type',text:'REPLACED_OK'});await pause(150);
 assert.equal(await window.webContents.executeJavaScript('document.getElementById("input").value'),'REPLACED_OK');checks.push('keyboard shortcut');
 await input({action:'key',key:'enter'});await pause(150);
 assert.equal(await window.webContents.executeJavaScript('document.getElementById("input").value'),'REPLACED_OK\n');checks.push('key without optional modifiers');
 await input({action:'move',...point(500,200)});
 await input({action:'scroll',dx:0,dy:-480});await pause(250);
 assert.ok(await window.webContents.executeJavaScript('window.scrollY>0'));checks.push('verified scrolling');
 const capture=await native.screenshotCapture(),png=Buffer.from(capture.data,'base64');
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length>1000);checks.push('real desktop PNG');
 let geometry;
 if(process.platform==='win32'){
  geometry=JSON.parse(capture.text);assert.equal(geometry.coordinateSystem,'physical-pixels');
  assert.deepEqual(geometry.imageSize,{width:png.readUInt32BE(16),height:png.readUInt32BE(20)});
  const p=point(100,155),m=geometry.imageToScreen;
  const imagePoint={x:(p.x-m.offsetX)/m.scaleX,y:(p.y-m.offsetY)/m.scaleY};
  assert.ok(imagePoint.x>=0&&imagePoint.x<geometry.imageSize.width&&imagePoint.y>=0&&imagePoint.y<geometry.imageSize.height);
  assert.equal(Math.round(m.offsetX+imagePoint.x*m.scaleX),p.x);assert.equal(Math.round(m.offsetY+imagePoint.y*m.scaleY),p.y);
  checks.push('PNG dimensions and physical-pixel mapping');
 }
 report({platform:process.platform,passed:true,checks,captureBytes:png.length,geometry});
 window.destroy();app.quit();
}).catch(error=>{report({platform:process.platform,passed:false,checks,error:error.stack});if(window&&!window.isDestroyed())window.destroy();app.exit(1);});
