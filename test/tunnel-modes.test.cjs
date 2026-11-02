'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {validateRemoteConfig,namedTunnelArguments}=require('../app/tunnel-modes.cjs');
const {Tunnel}=require('../app/tunnel.cjs');
const named={mode:'named',publicOrigin:'https://bridge.example.com',localPort:17775,configFile:path.join(os.tmpdir(),'redx-config.yml'),autoConnect:true};
test('named Cloudflare mode uses a fixed hostname, YAML path and a fixed local port',()=>{
 assert.equal(validateRemoteConfig(named).publicOrigin,'https://bridge.example.com');
 for(const origin of ['https://abc.trycloudflare.com','http://bridge.example.com','https://user:pass@bridge.example.com','https://bridge.example.com/path','https://localhost'])
  assert.throws(()=>validateRemoteConfig({...named,publicOrigin:origin}));
 assert.throws(()=>validateRemoteConfig({...named,localPort:0}));
 assert.throws(()=>validateRemoteConfig({...named,configFile:'config.yml'}));
});
test('named mode never exposes stored secrets or invents DNS',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redx-named-'));
 const configFile=path.join(dir,'config.yml');
 fs.writeFileSync(configFile,'tunnel: fixture\ncredentials-file: /secured/private.json\nurl: http://127.0.0.1:17775\n');
 const config={...named,configFile};
 fs.writeFileSync(path.join(dir,'remote.json'),JSON.stringify(config));
 const args=namedTunnelArguments(config,'http://127.0.0.1:17775/mcp');
 assert.deepEqual(args,['tunnel','--config',configFile,'run']);
 assert.throws(()=>namedTunnelArguments(config,'http://127.0.0.1:9000/mcp'));
 const calls=[];const spawn=(binary,argv)=>{
  calls.push({binary,args:argv});
  const proc=new EventEmitter();proc.stderr=new EventEmitter();
  proc.kill=()=>proc.emit('exit',0,'SIGTERM');return proc;
 };
 const t=new Tunnel(()=>{},{root:dir,spawn,temporaryBinary:process.execPath,fetch:async()=>{throw Error('offline')}});
 try{
  await t.start('http://127.0.0.1:17775/mcp');
  assert.equal(t.status().mode,'named');
  assert.equal(t.status().url,'https://bridge.example.com/mcp');
  assert.deepEqual(calls[0].args,args);
  await t.check();await t.check();
  assert.equal(t.status().phase,'unreachable');
  assert.equal(t.status().mode,'named');
  assert.equal(t.status().url,'https://bridge.example.com/mcp');
  assert.equal(calls.length,1,'Never create a quick tunnel on named-hostname failure');
 }finally{t.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('local mode does not start a tunnel or replace the local gateway',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redx-local-'));
 try{
  fs.writeFileSync(path.join(dir,'remote.json'),JSON.stringify({mode:'local'}));
  const t=new Tunnel(()=>{},{root:dir,spawn:()=>{throw Error('should not launch public relay')}});
  const state=await t.start('http://127.0.0.1:17775/mcp');
  assert.equal(state.mode,'local');assert.equal(state.url,null);assert.equal(t.child,null);assert.equal(t.desired,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
