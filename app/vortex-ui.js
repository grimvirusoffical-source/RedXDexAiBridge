'use strict';
(() => {
  const api = window.bridge;
  const $ = id => document.getElementById(id);
  const history = [];
  let connection = null;
  let available = [];
  let busy = false;
  const status = value => { $('vstatus').textContent = value; };
  const requestedModel = () => $('vmodel').value || 'vortex-pro';

  async function config() {
    connection = await api.vortexConfig();
    $('vbase').value = connection.endpoint;
    status(connection.hasKey ? 'A key is stored securely. Test the saved connection to load permitted models.' : 'Enter your inference API address and key. Pro is the default model.');
    $('vsend').disabled = true;
  }
  async function save() {
    connection = await api.vortexSave($('vkey').value, {endpoint:$('vbase').value, model:requestedModel()});
    $('vkey').value = '';
    $('vbase').value = connection.endpoint;
  }
  async function test(saveChanges = false) {
    if (busy) return;
    busy = true;
    $('vtest').disabled = true;
    $('vsave').disabled = true;
    $('vsend').disabled = true;
    try {
      if (saveChanges || $('vkey').value || $('vbase').value.trim() !== connection?.endpoint) await save();
      status('Testing the inference API…');
      const result = await api.vortexStatus();
      available = result.models || [];
      const selected = requestedModel();
      const select = $('vmodel'); select.replaceChildren();
      for (const model of [...new Set(['vortex-pro', ...available])]) {
        const option = document.createElement('option');
        option.value = model;
        option.textContent = model + (model === 'vortex-pro' && result.connected && !result.proAvailable ? ' — not available for this key' : '');
        select.append(option);
      }
      select.value = available.includes(selected) ? selected : 'vortex-pro';
      if (!result.connected) { status(result.error + (result.retryAfter ? ' Retry-After: ' + result.retryAfter : '')); return; }
      $('vsend').disabled = !available.includes(select.value);
      status(result.proAvailable ? 'Connected · vortex-pro available' : 'Connected, but vortex-pro is not available to this key. Choose another permitted model explicitly or change the server’s key permissions.');
    } catch (error) { available = []; status(error.message); }
    finally { busy = false; $('vtest').disabled = false; $('vsave').disabled = false; }
  }
  $('vsave').onclick = () => test(true);
  $('vtest').onclick = () => test(false);
  $('vmodel').onchange = () => { $('vsend').disabled = busy || !available.includes(requestedModel()); };
  $('vbase').oninput = () => { available = []; $('vsend').disabled = true; };
  $('vdisconnect').onclick = async () => {
    try { await api.vortexDisconnect(); available = []; history.length = 0; $('vchat').replaceChildren(); $('vsend').disabled = true; status('Vortex key removed from this bridge.'); }
    catch (error) { status(error.message); }
  };
  function append(role, text) {
    const item = document.createElement('p');
    const label = document.createElement('strong'); label.textContent = role + ': ';
    item.append(label, document.createTextNode(text));
    $('vchat').append(item); $('vchat').scrollTop = $('vchat').scrollHeight;
  }
  $('vsend').onclick = async () => {
    const prompt = $('vprompt').value.trim();
    const model = requestedModel();
    if (!prompt || busy) return;
    if (!available.includes(model)) { status('Test the connection and choose an allowed model first.'); return; }
    busy = true; $('vsend').disabled = true;
    const messages = [...history, {role:'user', content:prompt}];
    try {
      const answer = await api.vortexChat(messages, model);
      history.push({role:'user', content:prompt}, {role:'assistant', content:answer});
      append('You', prompt); append('Vortex', answer);
      $('vprompt').value = ''; status('Reply received from ' + model);
    } catch (error) { status(error.message); }
    finally { busy = false; $('vsend').disabled = !available.includes(requestedModel()); }
  };
  $('vclear').onclick = () => { history.length = 0; $('vchat').replaceChildren(); status('Chat cleared.'); };
  $('vcopy-editor').onclick = async () => {
    try {
      const text = await api.vortexEditorConfig();
      await api.copy(text);
      $('veditor').textContent = text; $('veditor').hidden = false;
      status('Continue configuration copied without a secret. Add VORTEX_API_KEY to Continue’s local .env file or secret store. Existing editor settings were not overwritten.');
    } catch (error) { status(error.message); }
  };
  config().catch(error => status(error.message));
})();
