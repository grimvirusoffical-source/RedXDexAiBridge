'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../app/vortex.cjs');
const key = 'redx_ai_example_valid_key';

test('Vortex endpoint allows HTTPS or explicit loopback only, with no credential-bearing redirects', async () => {
  assert.equal(v.normalizeEndpoint('https://vortex.example/'), 'https://vortex.example/v1');
  assert.equal(v.normalizeEndpoint(v.LOCAL_ENDPOINT), v.LOCAL_ENDPOINT);
  for (const endpoint of ['http://remote.example/v1', 'https://user:secret@vortex.example/v1', 'https://x.test/v1?key=oops', 'https://x.test/v1#x', 'https://x.test/v1/models']) assert.throws(() => v.normalizeEndpoint(endpoint));
  const fetcher = async (url, options) => {
    assert.equal(url, v.LOCAL_ENDPOINT + '/models');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    return {ok: true, json: async () => ({data: [{id: 'vortex-pro'}]})};
  };
  assert.deepEqual(await v.models(key, fetcher, {endpoint: v.LOCAL_ENDPOINT}), ['vortex-pro']);
});

test('Vortex accepts recognized key syntax regardless of server-side admin status', () => {
  assert.equal(v.validateKey(' Bearer ' + key + ' '), key);
  assert.equal(v.validateKey('redx_xai_scoped_example_key'), 'redx_xai_scoped_example_key');
  assert.throws(() => v.validateKey('redx_ai_' + 'x'.repeat(200)));
});

test('Vortex reports DNS, connection, proxy and model failures separately', async () => {
  await assert.rejects(v.models(key, async () => { throw {cause: {code: 'ENOTFOUND'}}; }), /DNS problem/);
  await assert.rejects(v.models(key, async () => { throw {cause: {code: 'ECONNREFUSED'}}; }), /not listening/);
  await assert.rejects(v.models(key, async () => ({ok: false, status: 403, json: async () => ({type: 'https://developers.cloudflare.com/errors'})})), /before Vortex could validate/);
  await assert.rejects(v.chat(key, [{role: 'user', content: 'hi'}], 'vortex-pro', async () => ({ok: false, status: 403, json: async () => ({})})), /not authorized/);
});

test('Vortex never silently falls back to another endpoint or a weaker model', async () => {
  let calls = 0;
  await assert.rejects(v.chat(key, [{role: 'user', content: 'hi'}], undefined, async (url, options) => {
    calls++; assert.equal(JSON.parse(options.body).model, 'vortex-pro');
    return {ok: false, status: 404, json: async () => ({})};
  }), /unavailable/);
  assert.equal(calls, 1);
});

test('Vortex rejects HTML responses and oversized history rather than losing messages', async () => {
  await assert.rejects(v.models(key, async () => ({ok: true, text: async () => '<html>login</html>'})), /web page/);
  await assert.rejects(v.chat(key, [{role: 'user', content: 'x'.repeat(30001)}]), /oversized/);
  assert.throws(() => v.parseModels({error: 'invalid response'}), /model list/);
});
