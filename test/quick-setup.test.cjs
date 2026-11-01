'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const quick=require('../app/quick-setup.cjs'),{ClientStore}=require('../app/clients.cjs');
test('one-click options support local AIs, generic MCP and remote OAuth without other kinds',()=>{
 assert.deepEqual(quick.AI_TYPES,['codex','claude','vscode','cursor','gemini','generic','remote']);
 for(const kind of quick.AI_TYPES)assert.equal(quick.validateType(kind),kind);
 for(const kind of ['admin','terminal','file:///etc/passwd','other\nkind',''])assert.throws(()=>quick.validateType(kind));
});
test('generic AI validates its display name and only accepts a local loopback gateway',()=>{
 const t='a'.repeat(43);
 assert.equal(quick.validateName('  Home AI  '),'Home AI');
 for(const n of ['', ' '.repeat(3),'evil\nname','a'.repeat(81),null])assert.throws(()=>quick.validateName(n));
 assert.match(quick.instructionsFor('generic',{clientName:'Another AI',url:'http://127.0.0.1:51234/mcp',token:t}),/Authorization header: Bearer/);
 for(const url of ['https://evil.example/mcp','http://0.0.0.0:5000/mcp','http://localhost:51234/mcp','file:///tmp/mcp']){
  assert.throws(()=>quick.instructionsFor('generic',{clientName:'Another AI',url,token:t}),/loopback/);
 }
});
test('Windows one-click readiness reports native result but never claims to grant OS permissions',()=>{
 const result=quick.readiness({platform:'win32',nativeStatus:{inputSupported:true}});
 assert.equal(result.readyForLocalMCP,true);
 assert.equal(result.readyForFullDesktop,true);
 assert.equal(result.requiresConsent,true);
 const blocked=quick.readiness({platform:'win32',nativeStatus:{inputSupported:false}});
 assert.equal(blocked.readyForFullDesktop,false);
 assert.match(blocked.advice.join(' '),/UAC/);
});
test('Linux X11 readiness detects xdotool and session; Wayland does not claim global input',()=>{
 const lookup=(name)=>name==='xdotool'?'/usr/bin/xdotool':null;
 const x11=quick.readiness({platform:'linux',env:{DISPLAY:':99',XDG_SESSION_TYPE:'x11',DBUS_SESSION_BUS_ADDRESS:'unix:path=/tmp/bus'},lookup});
 assert.equal(x11.readyForFullDesktop,true);assert.equal(x11.session,'x11');assert.equal(x11.missing.length,0);
 const missing=quick.readiness({platform:'linux',env:{DISPLAY:':99',XDG_SESSION_TYPE:'x11'},lookup:()=>null});
 assert.deepEqual(missing.missing,['xdotool']);
 const wayland=quick.readiness({platform:'linux',env:{DISPLAY:':1',WAYLAND_DISPLAY:'wayland-0',XDG_SESSION_TYPE:'wayland'},lookup});
 assert.equal(wayland.session,'wayland');assert.equal(wayland.readyForDesktopInput,false);
 assert.match(wayland.advice.join(' '),/not supported/);
 const headless=quick.readiness({platform:'linux',env:{},lookup:()=>null});
 assert.equal(headless.readyForFullDesktop,false);
});
test('new generic client is hashed, separately revocable and carries no default permissions',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-quick-'));
 try{
  const client=new ClientStore(path.join(root,'clients.json')),created=client.create('Another Model','manual');
  const text=quick.instructionsFor('generic',{clientName:created.name,url:'http://127.0.0.1:52341/mcp',token:created.token});
  assert.match(text,/Permissions remain Ask/);
  const onDisk=fs.readFileSync(client.file,'utf8');
  assert.equal(onDisk.includes(created.token),false);
  assert.equal(client.verify(created.token).id,created.id);
  client.revoke(created.id);
  assert.equal(client.verify(created.token),null);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('one-click UI is linked into the packaged app and handlers are exposed by preload',()=>{
 const html=fs.readFileSync(path.join(__dirname,'..','app','index.html'),'utf8'),preload=fs.readFileSync(path.join(__dirname,'..','app','preload.cjs'),'utf8');
 const main=fs.readFileSync(path.join(__dirname,'..','app','main.cjs'),'utf8');
 for(const id of ['quick-computer-setup','quick-ai-kind','quick-add-ai','quick-copy-connection'])assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/quick-setup-ui\.js/);assert.match(preload,/setup:quick/);assert.match(preload,/setup:addAI/);
 assert.match(main,/ipc\('setup:quick'/);assert.match(main,/ipc\('setup:addAI'/);
 assert.match(main,/connectionPending:!verified/);assert.doesNotMatch(main,/if\(!status\?\.url\)throw/);
 const setupUI=fs.readFileSync(path.join(__dirname,'..','app','quick-setup-ui.js'),'utf8');
 assert.match(setupUI,/api\.on\?\.\('remote',remoteChanged\)/);
 assert.match(html,/value="gemini"/);
});
