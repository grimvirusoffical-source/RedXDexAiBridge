'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const quick=require('../app/quick-setup.cjs'),{ClientStore}=require('../app/clients.cjs');
test('one-click options support local AIs, generic MCP and remote OAuth without other kinds',()=>{
 assert.deepEqual(quick.AI_TYPES,['codex','claude','vscode','cursor','generic','remote']);
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
});

test('remote AI one-click waits for a verified HTTPS endpoint instead of a connecting URL',async()=>{
 const phases=[
  {phase:'connecting',url:null},
  {phase:'connecting',url:'https://bridge.example/mcp'},
  {phase:'online',url:'https://bridge.example/mcp'}
 ];
 let index=0;
 const tunnel={desired:true,status:()=>phases[Math.min(index,phases.length-1)]};
 const result=await quick.waitForVerifiedRemote(tunnel,{attempts:4,intervalMs:1,sleep:async()=>{index++}});
 assert.equal(result.phase,'online');assert.equal(result.url,'https://bridge.example/mcp');
 assert.equal(index,2);
 await assert.rejects(quick.waitForVerifiedRemote({desired:true,status:()=>({phase:'online',url:'http://bridge.example/mcp'})},{attempts:1}),/HTTPS/);
 await assert.rejects(quick.waitForVerifiedRemote({desired:true,status:()=>({phase:'online',url:'https://user:pass@bridge.example/mcp'})},{attempts:1}),/HTTPS/);
 await assert.rejects(quick.waitForVerifiedRemote({desired:true,status:()=>({phase:'connecting',url:null})},{attempts:2,sleep:async()=>{}}),/timeout/);
 await assert.rejects(quick.waitForVerifiedRemote({desired:false,status:()=>({phase:'off',message:'Stopped by user'})},{attempts:2}),/Stopped by user/);
});
test('remote intent in settings and connection toggles are wired into runtime',()=>{
 const main=fs.readFileSync(path.join(__dirname,'..','app','main.cjs'),'utf8');
 const core=fs.readFileSync(path.join(__dirname,'..','app','core.cjs'),'utf8');
 const startup=fs.readFileSync(path.join(__dirname,'..','app','startup.cjs'),'utf8');
 assert.match(core,/remoteAutoConnect:false/);
 assert.match(core,/Invalid preference/);
 assert.match(main,/setRemoteAutoConnect\(true\)/);
 assert.match(main,/setRemoteAutoConnect\(false\)/);
 assert.match(main,/waitForVerifiedRemote\(tunnel\)/);
 assert.match(startup,/enabled&&remoteAutoConnect/);
});
