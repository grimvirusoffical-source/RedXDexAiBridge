'use strict';
const fs = require('node:fs');
const {atomicJSON} = require('./clients.cjs');
const vortex = require('./vortex.cjs');

function validate(value = {}) {
  const endpoint = vortex.normalizeEndpoint(value.endpoint || vortex.ENDPOINT);
  const model = value.model === undefined ? vortex.DEFAULT_MODEL : value.model;
  if (typeof model !== 'string' || !model.trim() || model.length > 256) throw Error('Invalid Vortex model selection.');
  return {endpoint, model:model.trim()};
}
function load(file) {
  if (!fs.existsSync(file)) return validate();
  return validate(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function save(file, value) {
  const clean = validate(value);
  atomicJSON(file, clean);
  return clean;
}
function editorConfiguration(value) {
  const clean = validate(value);
  return ['name: Vortex Pro', 'version: 1.0.0', 'schema: v1', 'models:', '  - name: Vortex Pro',
    '    provider: openai', '    model: ' + JSON.stringify(clean.model),
    '    apiBase: ' + JSON.stringify(clean.endpoint),
    '    apiKey: ${{ secrets.VORTEX_API_KEY }}', '    roles:', '      - chat', '      - edit', '      - apply', ''].join('\n');
}
module.exports = {validate, load, save, editorConfiguration};
