'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {Tunnel, validateRelay, sshArguments, probeEndpoint} = require('../app/tunnel.cjs');
const config = {mode:'ssh', host:'45.77.105.187', user:'redxdex-relay', remotePort:18765,
  identityFile:path.join(os.tmpdir(),'relay-key'), knownHostsFile:path.join(os.tmpdir(),'relay-known-hosts'), publicOrigin:'https://bridge.example'};

test('relay validation rejects injection, insecure origins and invalid forwarding ports', () => {
  assert.equal(validateRelay(config).publicOrigin, 'https://bridge.example');
  for (const change of [{host:'-oProxyCommand=bad'}, {user:'root;bad'}, {publicOrigin:'http://bridge.example'},
    {publicOrigin:'https://user:secret@bridge.example'}, {publicOrigin:'https://bridge.example/path'},
    {identityFile:'relative'}, {remotePort:22}, {remotePort:70000}]) {
    assert.throws(() => validateRelay({...config,...change}));
  }
});

test('relay SSH uses strict host checking and forwards only a loopback port', () => {
  const args = sshArguments(config, 'http://127.0.0.1:45678/mcp');
  assert.ok(args.includes('StrictHostKeyChecking=yes'));
  assert.ok(args.includes('ExitOnForwardFailure=yes'));
  assert.ok(args.includes('127.0.0.1:18765:127.0.0.1:45678'));
  assert.equal(args.at(-1), 'redxdex-relay@45.77.105.187');
  assert.throws(() => sshArguments(config, 'http://192.168.1.4:45678/mcp'));
});

test('remote readiness requires matching live OAuth metadata, not a logged URL', async () => {
  const url='https://bridge.example/mcp';
  await assert.rejects(probeEndpoint(url, async()=>({ok:false,status:502})), /502/);
  await assert.rejects(probeEndpoint(url, async()=>({ok:true,json:async()=>({resource:'https://other.example/mcp',authorization_servers:['https://other.example']})})), /does not match/);
  assert.equal(await probeEndpoint(url, async(_url, options)=>{
    assert.equal(options.redirect,'error');
    return {ok:true,json:async()=>({resource:url,authorization_servers:['https://bridge.example']})};
  }), true);
});

test('VPS transport reports unreachable, recovers, and does not reconnect after explicit stop', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-relay-'));
  const key=path.join(dir,'key'), known=path.join(dir,'known');fs.writeFileSync(key,'test');fs.writeFileSync(known,'test');
  fs.writeFileSync(path.join(dir,'remote.json'),JSON.stringify({...config,identityFile:key,knownHostsFile:known}));
  let healthy=false, spawned=0, killed=0;
  const spawn=()=>{spawned++;const child=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{killed++;child.emit('exit',0,'SIGTERM');};return child;};
  const tunnel=new Tunnel(()=>{}, {root:dir,spawn,temporaryBinary:process.execPath,fetch:async()=>{
    if(!healthy)throw Error('network unavailable');
    return {ok:true,json:async()=>({resource:config.publicOrigin+'/mcp',authorization_servers:[config.publicOrigin]})};
  }});
  try {
    await tunnel.start('http://127.0.0.1:45678/mcp');
    assert.equal(tunnel.status().phase,'connecting');
    await tunnel.check();assert.equal(tunnel.status().phase,'unreachable');
    healthy=true;await tunnel.check();assert.equal(tunnel.status().phase,'online');
    tunnel.child.emit('exit',1,null);assert.equal(tunnel.status().phase,'connecting');
    assert.equal(tunnel.status().mode,'temporary');
    assert.equal(spawned,2);
    tunnel.stop();assert.equal(tunnel.status().phase,'off');assert.equal(tunnel.desired,false);
    assert.equal(spawned,2);assert.equal(killed,1);
  } finally {tunnel.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('two unreachable VPS probes fall back to temporary HTTPS without restarting after STOP',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-relay-'));
 try{
  const key=path.join(dir,'key'),known=path.join(dir,'known');
  fs.writeFileSync(key,'fixture');fs.writeFileSync(known,'fixture');
  fs.writeFileSync(path.join(dir,'remote.json'),JSON.stringify({...config,identityFile:key,knownHostsFile:known}));
  const started=[];let killed=0;
  const spawn=(bin,args)=>{
   started.push({bin,args});
   const proc=new EventEmitter();proc.stderr=new EventEmitter();
   proc.kill=()=>{killed++;proc.emit('exit',0,'SIGTERM');};
   return proc;
  };
  const tunnel=new Tunnel(()=>{},{root:dir,spawn,temporaryBinary:process.execPath,fetch:async()=>{throw Error('fixture offline')}});
  await tunnel.start('http://127.0.0.1:45678/mcp');
  assert.equal(tunnel.status().mode,'vps');
  await tunnel.check();assert.equal(tunnel.status().phase,'unreachable');
  await tunnel.check();
  assert.equal(tunnel.status().mode,'temporary');
  assert.equal(tunnel.status().phase,'connecting');
  assert.equal(started.length,2);
  assert.equal(started[1].bin,process.execPath);
  assert.deepEqual(started[1].args.slice(0,2),['tunnel','--url']);
  tunnel.stop();
  assert.equal(tunnel.desired,false);
  assert.equal(tunnel.status().phase,'off');
  assert.equal(killed,2);
  assert.equal(started.length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
