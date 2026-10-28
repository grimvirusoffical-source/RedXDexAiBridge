'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vortex = require('./vortex.cjs');

// Explicit local developer diagnostic. Only sanitized results leave this process.
// The app decrypts its OWN saved key internally; no key is printed or exported.
async function run({app, safeStorage, root, argv}) {
  const result = {version: app.getVersion(), connected: false, keySaved: false};
  const file = path.join(app.getPath('userData'), 'vortex-key.enc');
  const endpointFlag = argv.find(s => s.startsWith('--vortex-endpoint='));
  const endpoint = vortex.normalizeEndpoint(endpointFlag ? endpointFlag.slice('--vortex-endpoint='.length) : vortex.ENDPOINT);
  result.endpoint = endpoint;
  try {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw Error('OS credential storage is unavailable');
    if (!fs.existsSync(file)) throw Error('No Vortex key has been saved in this app');
    result.keySaved = true;
    const key = safeStorage.decryptString(fs.readFileSync(file));
    result.models = await vortex.models(key, globalThis.fetch, {endpoint});
    result.connected = true;
    result.proAvailable = result.models.includes(vortex.DEFAULT_MODEL);
    if (argv.includes('--vortex-test-chat') && result.proAvailable) {
      const reply = await vortex.chat(key, [{role: 'user', content: 'Reply only with BRIDGE_OK.'}], vortex.DEFAULT_MODEL, globalThis.fetch, {endpoint, maxTokens: 16});
      result.chat = {passed: typeof reply === 'string' && reply.length > 0, model: vortex.DEFAULT_MODEL, replyLength: reply.length};
    }
    if (argv.includes('--vortex-save-endpoint')) {
      const config = path.join(app.getPath('userData'), 'vortex-connection.json');
      require('./clients.cjs').atomicJSON(config, {endpoint});
      result.endpointSaved = true;
    }
  } catch (error) { result.error = error.message; }
  const output = path.join(root, 'diagnostics', 'vortex-status.json');
  require('./clients.cjs').atomicJSON(output, {...result, checkedAt: new Date().toISOString()});
  console.log(JSON.stringify(result));
  return result;
}
module.exports = {run};
