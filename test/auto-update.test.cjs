'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');const {createUpdateController}=require('../app/auto-update.cjs');
function setup(){const updater=new EventEmitter();updater.checkForUpdates=async()=>({updateInfo:{version:'0.9.0'}});updater.downloadUpdate=async()=>['download'];updater.quitAndInstall=()=>{updater.installed=true;};const storage=new Map();const control=createUpdateController({platform:'darwin',app:{getVersion:()=> '0.8.0',isPackaged:true},autoUpdater:updater,store:{get:k=>storage.get(k),set:(k,v)=>storage.set(k,v)}});control.init();return {control,updater,storage};}
test('update lifecycle checks, downloads, and installs only after ready',async()=>{const {control,updater}=setup();assert.throws(()=>control.install(),/No downloaded/);await control.check();updater.emit('update-available',{version:'0.9.0'});assert.equal(control.status().phase,'available');await control.download();updater.emit('update-downloaded',{version:'0.9.0'});control.install();assert.equal(updater.installed,true);});
test('automatic download preference persists',()=>{const {control,storage}=setup();control.setAutoDownload(true);assert.equal(storage.get('autoDownload'),true);assert.equal(control.status().autoDownload,true);});
test('update errors surface in UI state',()=>{const {control,updater}=setup();updater.emit('error',new Error('network disconnected'));assert.match(control.status().message,/network disconnected/);});

test('a tag whose latest.yml is not published becomes a nonfatal pending release',async()=>{
 const {control,updater}=setup();
 const failure=new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/example/releases/download/v0.10.12/latest.yml): HttpError: 404');
 updater.checkForUpdates=async()=>{updater.emit('error',failure);throw failure;};
 assert.equal(await control.check(),null);
 assert.equal(control.status().phase,'pending-release');
 assert.equal(control.status().canInstall,false);
 assert.match(control.status().message,/manifest is not yet available/);
 assert.match(control.status().message,/personal token are not required/);
});
test('unrelated updater failures still propagate',async()=>{
 const {control,updater}=setup();
 updater.checkForUpdates=async()=>{throw Error('Unable to verify release certificate');};
 await assert.rejects(control.check(),/Unable to verify release certificate/);
});
