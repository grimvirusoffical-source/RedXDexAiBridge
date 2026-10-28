'use strict';
(() => {
  const api = window.bridge;
  const $ = id => document.getElementById(id);
  const history = [];
  const status = message => { $('vstatus').textContent = message; };
  let busy = false;

  async function settings() {
    const config = await api.vortexConnection();
    $('vendpoint').value = config.endpoint;
    return config;
  }
  async function test() {
    try {
      const result = await api.vortexStatus();
      if (!result.connected) { status(result.error); $('vsend').disabled = true; return; }
      const select = $('vmodel');
      select.replaceChildren();
      if (!result.proAvailable) {
        const option = document.createElement('option');
        option.value = ''; option.textContent = 'Pro unavailable — explicitly choose another model';
        select.append(option);
      }
      for (const model of result.models) {
        const option = document.createElement('option'); option.value = model; option.textContent = model;
        select.append(option);
      }
      select.value = result.proAvailable ? 'vortex-pro' : '';
      $('vsend').disabled = !select.value;
      status(result.proAvailable
        ? 'Connected to ' + result.endpoint + ' · vortex-pro ready'
        : 'Key accepted. Pro is not currently offered by this server/key. No model was silently substituted.');
    } catch (error) { status(error.message); }
  }
  async function setEndpoint(endpoint) {
    try {
      const result = await api.vortexSetEndpoint(endpoint);
      if (result.cancelled) return;
      $('vendpoint').value = result.endpoint;
      history.length = 0; $('vchat').replaceChildren();
      status('Endpoint saved. Testing your existing key…'); await test();
    } catch (error) { status(error.message); }
  }
  $('vendpoint-save').onclick = () => setEndpoint($('vendpoint').value);
  $('vlocal').onclick = () => setEndpoint('http://127.0.0.1:18091/v1');
  $('vsave').onclick = async () => {
    try { await api.vortexSave($('vkey').value); $('vkey').value = ''; await test(); }
    catch (error) { status(error.message); }
  };
  $('vtest').onclick = test;
  $('vmodel').onchange = () => { $('vsend').disabled = busy || !$('vmodel').value; };
  $('vdisconnect').onclick = async () => {
    try { await api.vortexDisconnect(); history.length = 0; $('vchat').replaceChildren(); status('Saved Vortex key removed'); }
    catch (error) { status(error.message); }
  };
  $('vscode-copy').onclick = async () => {
    try {
      const config = await settings();
      await api.copy('Provider: OpenAI compatible\nBase URL: ' + config.endpoint + '\nModel: ' + ($('vmodel').value || 'vortex-pro') + '\nAPI key: use your Vortex key in the extension’s secure key field.\nMCP tools: use Connect VS Code in the bridge.');
      status('VS Code connection settings copied without exposing your API key.');
    } catch (error) { status(error.message); }
  };
  function append(role, text) {
    const row = document.createElement('p'), label = document.createElement('strong');
    label.textContent = role + ': '; row.append(label, document.createTextNode(text));
    $('vchat').append(row); $('vchat').scrollTop = $('vchat').scrollHeight;
  }
  $('vsend').onclick = async () => {
    if (busy) return;
    const prompt = $('vprompt').value.trim(), model = $('vmodel').value;
    if (!prompt) return;
    if (!model) { status('Choose an available model explicitly.'); return; }
    if (history.length >= 58) { status('This chat reached its history limit. Clear it before starting a new conversation.'); return; }
    busy = true; $('vsend').disabled = true;
    history.push({role: 'user', content: prompt}); append('You', prompt); $('vprompt').value = '';
    try {
      const answer = await api.vortexChat(history, model);
      history.push({role: 'assistant', content: answer}); append('Vortex', answer); status('Reply received · ' + model);
    } catch (error) {
      history.pop(); $('vprompt').value = prompt; status(error.message + ' Your unsent prompt has been restored.');
    } finally { busy = false; $('vsend').disabled = !model; }
  };
  $('vclear').onclick = () => { if (busy) return; history.length = 0; $('vchat').replaceChildren(); status('Chat cleared'); };
  settings().catch(error => status(error.message));
})();
