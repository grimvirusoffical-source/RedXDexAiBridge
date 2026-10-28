'use strict';
// Runs as an explicit application diagnostic. Credentials remain in Electron's
// protected storage and are never returned in this diagnostic or console output.
const fs = require('node:fs');
const path = require('node:path');
const vortex = require('./vortex.cjs');
const preferences = require('./vortex-settings.cjs');

async function run({app, safeStorage, argv, root}) {
  const profile = preferences.load(path.join(app.getPath('userData'),'vortex-connection.json'));
  const endpoint = argv.includes('--local-vortex') ? 'http://127.0.0.1:18091/v1' : profile.endpoint;
  const result = {endpoint, connected:false, model:vortex.DEFAULT_MODEL, chatVerified:false};
  try {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw Error('Operating-system credential storage is unavailable.');
    const file = path.join(app.getPath('userData'),'vortex-key.enc');
    if (!fs.existsSync(file)) throw Error('No Vortex key has been saved in this app.');
    const key = safeStorage.decryptString(fs.readFileSync(file));
    const models = await vortex.models(key,undefined,endpoint);
    Object.assign(result,{connected:true,models,proAvailable:models.includes(vortex.DEFAULT_MODEL)});
    if (argv.includes('--verify-chat') && result.proAvailable) {
      const reply = await vortex.chat(key,[{role:'user',content:'Reply with exactly BRIDGE_OK.'}],vortex.DEFAULT_MODEL,undefined,endpoint);
      result.chatVerified = reply.trim().includes('BRIDGE_OK');
      result.replyCharacters = reply.length;
    }
    if (argv.includes('--save-local-connection') && argv.includes('--local-vortex')) preferences.save(path.join(app.getPath('userData'),'vortex-connection.json'),{endpoint,model:vortex.DEFAULT_MODEL});
  } catch (error) {result.error=error.message;result.code=error.code || 'DIAGNOSTIC';}
  const file=path.join(root,'vortex-diagnostic.json');
  require('./clients.cjs').atomicJSON(file,result);
  console.log(JSON.stringify(result,null,2));
  return result;
}
module.exports={run};
