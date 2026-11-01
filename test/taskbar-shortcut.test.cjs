'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {marker,pending,dismiss,HELP_URL}=require('../app/taskbar-onboarding.cjs');
const root=path.resolve(__dirname,'..');
test('taskbar guide opt-in is a regular file scoped to user data and only on Windows',()=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'bridge-pin-hint-'));
 try{
  assert.equal(pending(home,{platform:'win32'}),false);
  fs.writeFileSync(marker(home),'requested');
  assert.equal(pending(home,{platform:'win32'}),true);
  assert.equal(pending(home,{platform:'darwin'}),false);
  assert.deepEqual(dismiss(home,{platform:'win32'}),{dismissed:true});
  assert.equal(pending(home,{platform:'win32'}),false);
  fs.symlinkSync(path.join(home,'missing-file'),marker(home));
  assert.equal(pending(home,{platform:'win32'}),false);
  assert.deepEqual(dismiss(home,{platform:'win32'}),{dismissed:false});
 }finally{fs.rmSync(home,{recursive:true,force:true});}
});
test('interactive NSIS installer offers independent desktop shortcut and taskbar choice',()=>{
 const script=fs.readFileSync(path.join(root,'build','installer.nsh'),'utf8');
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(pkg.build.nsis.oneClick,true);
 assert.equal(pkg.build.nsis.createDesktopShortcut,true);
 assert.equal(pkg.build.nsis.createStartMenuShortcut,true);
 assert.match(script,/IfSilent shortcut_done/);
 assert.match(script,/\$\{IfNot\} \$\{isUpdated\}/);
 assert.match(script,/Create a Red-XAI Bridge desktop shortcut\?/);
 assert.match(script,/Delete "\$newDesktopLink"/);
 assert.match(script,/Would you like help pinning Red-XAI Bridge to the Windows taskbar\?/);
 assert.match(script,/taskbar-pin-request\.txt/);
 assert.match(script,/Windows requires you to confirm the pin yourself/);
 assert.ok(script.indexOf('IfSilent shortcut_done')<script.indexOf('Create a Red-XAI Bridge desktop shortcut?'));
});
test('taskbar choice is surfaced in app on user request only',()=>{
 const index=fs.readFileSync(path.join(root,'app','index.html'),'utf8');
 const renderer=fs.readFileSync(path.join(root,'app','ui.js'),'utf8');
 const main=fs.readFileSync(path.join(root,'app','main.cjs'),'utf8');
 const preload=fs.readFileSync(path.join(root,'app','preload.cjs'),'utf8');
 for(const id of ['taskbar-pin-nudge','taskbar-pin-help','taskbar-pin-dismiss'])assert.ok(index.includes('id="'+id+'"'));
 for(const key of ["taskbar:pin-status","taskbar:pin-dismiss","taskbar:pin-guide"])assert.ok(main.includes(key));
 for(const name of ['taskbarPinStatus','taskbarPinGuide','taskbarPinDismiss'])assert.ok(preload.includes(name));
 assert.match(renderer,/attempt\(refreshTaskbarPinOffer\)/);
 assert.match(HELP_URL,/^https:\/\/support\.microsoft\.com\//);
});
