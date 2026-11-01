'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {ClientStore} = require('../app/clients.cjs');
const {startServer} = require('../app/http-mcp.cjs');
// Never allow a fixture to read or overwrite the owner's live Bridge settings.
const fixtureRoot=process.env.REDXDEX_DATA_DIR;
assert.ok(fixtureRoot && path.resolve(fixtureRoot)!==path.join(os.homedir(),'.redxdex-ai-bridge'),
 'Device-isolation tests require REDXDEX_DATA_DIR pointing to isolated fixture data');
const core = require('../app/core.cjs');

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'redxdex-device-boundary-'));
async function invoke(url, token, name, args = {}) {
 const response = await fetch(url, {
  method: 'POST',
  headers: {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token},
  body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name, arguments: args}})
 });
 return {status: response.status, body: await response.json()};
}

test('distinct device installations never accept each other\'s client credentials', async () => {
 const a = temp(), b = temp();
 const clientsA = new ClientStore(path.join(a, 'clients.json'));
 const clientsB = new ClientStore(path.join(b, 'clients.json'));
 // Deliberately repeat the public-facing client identifier to ensure tokens,
 // not a client-provided ID or a plugin name, establish device ownership.
 const clientA = clientsA.create('Same plugin name', 'local', 'ai_shared_client_label');
 const clientB = clientsB.create('Same plugin name', 'local', 'ai_shared_client_label');
 assert.notEqual(clientA.token, clientB.token);
 const serverA = await startServer({clients: clientsA});
 const serverB = await startServer({clients: clientsB});
 try {
  const aOwn = await invoke(serverA.url, clientA.token, 'get_profile');
  const bOwn = await invoke(serverB.url, clientB.token, 'get_profile');
  assert.equal(aOwn.status, 200);
  assert.equal(bOwn.status, 200);
  assert.equal(aOwn.body.result.isError, undefined);
  assert.equal(bOwn.body.result.isError, undefined);
  assert.equal((await invoke(serverB.url, clientA.token, 'get_profile')).status, 401);
  assert.equal((await invoke(serverA.url, clientB.token, 'get_profile')).status, 401);
  clientsA.revoke(clientA.id);
  assert.equal((await invoke(serverA.url, clientA.token, 'get_profile')).status, 401);
  assert.equal((await invoke(serverB.url, clientB.token, 'get_profile')).status, 200);
 } finally {
  await serverA.stop();await serverB.stop();
  fs.rmSync(a, {recursive: true, force: true});
  fs.rmSync(b, {recursive: true, force: true});
 }
});

test('unconfigured authenticated clients never inherit global file permissions', async () => {
 const dir = temp(), before = core.settings(), file = path.join(dir, 'sample.txt');
 fs.writeFileSync(file, 'device-private-data');
 try {
  core.saveSettings({...before, directories: [dir], emergencyStop: false,
   permissions: {...before.permissions, list: true, read: true},
   clientPolicies: {}});
  await assert.rejects(
   core.perform('read_text_file', {path: file}, {clientId:'ai_new_remote', transport:'http'}),
   /Approval required/
  );
  let requests = 0;
  const answer = async detail => {requests++;assert.equal(detail.clientId,'ai_new_remote');return 'once'};
  assert.equal((await core.perform('read_text_file', {path: file},
    {clientId:'ai_new_remote', transport:'http', authorize:answer})).text,'device-private-data');
  assert.equal(requests, 1);
  // A one-time approval does not turn into a grant on subsequent calls.
  await assert.rejects(core.perform('read_text_file', {path: file},
   {clientId:'ai_new_remote', transport:'http'}), /Approval required/);
  core.saveSettings({...core.settings(), clientPolicies:{ai_new_remote:{read:'deny'}}});
  await assert.rejects(core.perform('read_text_file',{path:file},
   {clientId:'ai_new_remote',transport:'http',authorize:answer}), /Permission disabled/);
  assert.equal(requests,1);
 } finally {
  core.saveSettings(before);
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
