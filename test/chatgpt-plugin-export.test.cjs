'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const setup=require('../scripts/export-chatgpt-plugin.cjs');
const endpoint='https://paired-device.example/mcp';
function discovery(resource=endpoint,issuers=['https://paired-device.example']){
 return async(url,options)=>{
  assert.equal(url,'https://paired-device.example/.well-known/oauth-protected-resource/mcp');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(options.headers.Authorization,undefined);
  const response=new Response(JSON.stringify({resource,authorization_servers:issuers}));response.text=()=>{throw Error('unbounded reader must not run');};return response;
 };
}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'redx-plugin-export-'));
 // Only this exact test-created temporary root is recursively removed.
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return {root,destination:path.join(root,'private-bridge')};
}
test('portable declaration uses accepted fields and keeps devices separate',()=>{
 const a=setup.configuration(endpoint),b=setup.configuration('https://another-owner.example/mcp');
 const server=a.portable.mcpServers[setup.SERVER_NAME];
 assert.deepEqual(Object.keys(server).sort(),['headers','type','url']);
 assert.equal(server.type,'streamable-http');
 assert.equal(server.url,endpoint);
 assert.deepEqual(server.headers,{});
 assert.deepEqual(a.legacy.mcpServers,a.portable.mcpServers);
 assert.notEqual(b.portable.mcpServers[setup.SERVER_NAME].url,server.url);
 assert.equal(JSON.stringify(a).includes('"extensions"'),false);
});
test('endpoint validation rejects credentials, query tokens and local addresses',()=>{
 for(const url of ['http://paired-device.example/mcp','https://paired-device.example/mcp?token=secret','https://user:password@paired-device.example/mcp','https://paired-device.example/mcp#fragment','https://paired-device.example/other','https://localhost/mcp','https://127.0.0.1/mcp','https://[::1]/mcp','https://machine.local/mcp','not a url']){
  assert.throws(()=>setup.endpointURL(url),/HTTPS|public/);
 }
});
test('verified export has synchronized manifests, skill and real icon without app bindings',async t=>{
 const {destination}=fixture(t);
 const result=await setup.exportPlugin({endpoint,output:destination,fetchImpl:discovery()});
 assert.equal(result.mode,'new-private-plugin');assert.equal(result.files,6);assert.equal(result.oauthApprovalRequired,true);
 const manifest=JSON.parse(fs.readFileSync(path.join(destination,'plugin.json'),'utf8'));
 const overlay=JSON.parse(fs.readFileSync(path.join(destination,'.codex-plugin','plugin.json'),'utf8'));
 assert.deepEqual(overlay,manifest);assert.equal(manifest.name,'red-xai-bridge');assert.equal(manifest.version,'0.1.9');
 assert.equal(manifest.extensions['com.openai'].interface.category,'Developer Tools');
 assert.ok(manifest.extensions['com.openai'].interface.shortDescription.length<=30);
 assert.equal(manifest.apps,undefined);assert.equal(manifest.extensions['com.openai'].apps,undefined);
 assert.equal(fs.existsSync(path.join(destination,'.app.json')),false);
 const png=fs.readFileSync(path.join(destination,'assets','bridge-icon.png'));
 assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),256);
 const skill=fs.readFileSync(path.join(destination,'skills','red-xai-task-router','SKILL.md'),'utf8');
 assert.match(skill,/paired|owner-approved/);
 assert.doesNotMatch(skill,/(?:DESKTOP|LAPTOP)-[A-Z0-9]{6,}|trycloudflare\.com|Authorization: Bearer/);
});
test('config-only export leaves existing plugin identity and source untouched',async t=>{
 const {root,destination}=fixture(t),original=path.join(root,'existing-plugin');fs.mkdirSync(original);
 const before=Buffer.from('{"name":"owners-existing-plugin","version":"7.2.0"}\n');
 fs.writeFileSync(path.join(original,'plugin.json'),before);
 const result=await setup.exportPlugin({endpoint,output:destination,configOnly:true,serverName:'owners-existing-bridge',fetchImpl:discovery()});
 assert.equal(result.files,2);
 assert.equal(result.serverName,'owners-existing-bridge');
 assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(destination,'mcp.json'),'utf8')).mcpServers),['owners-existing-bridge']);
 assert.deepEqual(fs.readdirSync(destination).sort(),['.mcp.json','mcp.json']);
 assert.deepEqual(fs.readFileSync(path.join(original,'plugin.json')),before);
});
test('mismatched resources and missing or unsafe OAuth issuers create no output',async t=>{
 const {destination}=fixture(t);
 for(const fetchImpl of [
  discovery('https://different-device.example/mcp'),discovery(endpoint,[]),
  discovery(endpoint,['http://paired-device.example']),discovery(endpoint,['https://user:secret@paired-device.example']),
  async()=>new Response('',{status:503}),async()=>new Response('{not-json'),async()=>{throw Error('offline');}
 ]){
  await assert.rejects(setup.exportPlugin({endpoint,output:destination,fetchImpl}),/OAuth/);
  assert.equal(fs.existsSync(destination),false);
 }
});
test('existing output is never replaced and discovery is not attempted',async t=>{
 const {destination}=fixture(t);fs.mkdirSync(destination);fs.writeFileSync(path.join(destination,'keep.txt'),'existing owner data');
 await assert.rejects(setup.exportPlugin({endpoint,output:destination,fetchImpl:async()=>{throw Error('must not fetch');}}),/already exists/);
 assert.equal(fs.readFileSync(path.join(destination,'keep.txt'),'utf8'),'existing owner data');
 assert.deepEqual(fs.readdirSync(destination),['keep.txt']);
});
test('CLI validates arguments and help does not open a connection',()=>{
 assert.deepEqual(setup.options(['--help']),{help:true});
 assert.throws(()=>setup.options(['--endpoint',endpoint,'--endpoint',endpoint,'--output','new']),/Duplicate/);
 assert.throws(()=>setup.options(['--token','secret']),/Unknown/);
 assert.throws(()=>setup.options(['--endpoint',endpoint,'--output','new','--config-only']),/server-name/);
 assert.throws(()=>setup.configuration(endpoint,'wrong name'),/server name/);
 const p=cp.spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/export-chatgpt-plugin.cjs'),'--help'],{encoding:'utf8',timeout:5000,windowsHide:true});
 assert.equal(p.status,0);assert.match(p.stdout,/OAuth/);assert.doesNotMatch(p.stdout,/(?:DESKTOP|LAPTOP)-[A-Z0-9]{6,}|trycloudflare\.com/);
});

test('oversized streamed metadata is cancelled before export',async t=>{
 const {destination}=fixture(t);let cancelled=0;
 const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(32768));controller.enqueue(new Uint8Array(32768));controller.enqueue(new Uint8Array(1));},cancel(){cancelled++;}});
 const response=new Response(body);
 response.text=()=>{throw Error('unbounded response reader must not run');};
 await assert.rejects(setup.exportPlugin({endpoint,output:destination,fetchImpl:async()=>response}),/too large/);
 assert.equal(cancelled,1);assert.equal(response.body.locked,false);assert.equal(fs.existsSync(destination),false);
});
test('oversized content-length cancels an unread body',async t=>{
 const {destination}=fixture(t);let cancelled=0;
 const body=new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}});
 const response=new Response(body,{headers:{'content-length':'65537'}});
 await assert.rejects(setup.exportPlugin({endpoint,output:destination,fetchImpl:async()=>response}),/too large/);
 assert.equal(cancelled,1);assert.equal(fs.existsSync(destination),false);
});
test('a stalled metadata body reaches the shared deadline and releases its reader',async t=>{
 const {destination}=fixture(t);let cancelled=0,signal;
 const response=new Response(new ReadableStream({pull(){return new Promise(()=>{});},cancel(){cancelled++;}}));
 await assert.rejects(setup.exportPlugin({endpoint,output:destination,discoveryTimeoutMs:20,fetchImpl:async(url,options)=>{signal=options.signal;return response;}}),/timed out/);
 assert.equal(signal.aborted,true);assert.equal(cancelled,1);assert.equal(response.body.locked,false);assert.equal(fs.existsSync(destination),false);
});
test('a stalled fetch is bounded and late response bytes cannot create output',async t=>{
 const {destination}=fixture(t);let finishFetch,signal,cancelled=0;
 const response=new Response(new ReadableStream({cancel(){cancelled++;}}));
 await assert.rejects(setup.exportPlugin({endpoint,output:destination,discoveryTimeoutMs:20,fetchImpl:(url,options)=>{signal=options.signal;return new Promise(resolve=>{finishFetch=resolve;});}}),/timed out/);
 assert.equal(signal.aborted,true);finishFetch(response);await new Promise(resolve=>setImmediate(resolve));
 assert.equal(cancelled,1);assert.equal(fs.existsSync(destination),false);
});
test('JSON primitives and arrays fail with fixed object errors and no output',async t=>{
 const {destination}=fixture(t);
 for(const text of ['null','[]','false','1','"not an object"']){
  await assert.rejects(setup.exportPlugin({endpoint,output:destination,fetchImpl:async()=>new Response(text)}),/must return a JSON object/);
  assert.equal(fs.existsSync(destination),false);
 }
});
test('exactly64KiB valid metadata is accepted and transport errors stay private',async t=>{
 const {destination}=fixture(t);
 const metadata={resource:endpoint,authorization_servers:['https://paired-device.example'],padding:''};
 metadata.padding='x'.repeat(65536-Buffer.byteLength(JSON.stringify(metadata)));
 const text=JSON.stringify(metadata);assert.equal(Buffer.byteLength(text),65536);
 const result=await setup.exportPlugin({endpoint,output:destination,fetchImpl:async()=>new Response(text)});
 assert.equal(result.files,6);
 await assert.rejects(setup.verifyDiscovery(endpoint,async()=>{throw Error('PRIVATE_DIAGNOSTIC_MUST_NOT_APPEAR');}),error=>error.message==='OAuth discovery could not be verified; check Bridge is online');
});
