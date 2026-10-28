'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vortex = require('../app/vortex.cjs');

function response(status, value, headers = {}) {
  return new Response(JSON.stringify(value), {status, headers: {'content-type': 'application/json', ...headers}});
}

test('compatible API keys are opaque, including server-admin keys and new prefixes', async () => {
  for (const key of ['redx_ai_owner_admin_123456', 'redx_xai_custom_123456', 'sk-other-provider-123456', 'opaque.token+with/symbols=']) {
    const ids = await vortex.models(key, async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer ' + key);
      assert.equal(options.redirect, 'error');
      return response(200, {data: [{id: 'vortex-pro'}]});
    });
    assert.deepEqual(ids, ['vortex-pro']);
  }
  assert.equal(vortex.validateKey('  Bearer opaque-key-123456  '), 'opaque-key-123456');
});

test('unsafe or empty credentials fail before sending a request', async () => {
  for (const value of ['', 'short', 'key with spaces', 'test-key\r\nX-Injected: true', 'test-key\u0000', 'a'.repeat(4097)]) {
    let called = false;
    await assert.rejects(vortex.models(value, async () => { called = true; throw Error('must not send'); }));
    assert.equal(called, false);
  }
});

test('only the explicitly configured endpoint receives a credential; no host fallback', async () => {
  const calls = [];
  await assert.rejects(vortex.models('opaque-key-1234', async (url, options) => {
    calls.push({url, authorization: options.headers.Authorization});
    return response(401, {error: {message: 'denied'}});
  }, {endpoint: 'https://models.example.test/inference/v1'}), /rejected/);
  assert.deepEqual(calls, [{url: 'https://models.example.test/inference/v1/models', authorization: 'Bearer opaque-key-1234'}]);
});

test('an upstream permission error behind Cloudflare is not mislabeled as a proxy block', async () => {
  await assert.rejects(vortex.models('opaque-key-1234', async () => response(403, {
    error: {message: 'model permission denied'}
  }, {server: 'cloudflare', 'cf-ray': 'unit-test'})), /not authorized/);
});

test('real proxy challenge and rate limit diagnostics remain distinct', async () => {
  await assert.rejects(vortex.models('opaque-key-1234', async () => new Response('<html>challenge</html>', {
    status: 403, headers: {server: 'cloudflare', 'content-type': 'text/html', 'cf-mitigated': 'challenge'}
  })), /proxy.*challenge/i);
  await assert.rejects(vortex.models('opaque-key-1234', async () => response(429, {}, {'retry-after': '12'})), /retry after 12s/);
});

test('server errors never echo secret credentials or automatically downgrade Pro', async () => {
  const key = 'private-key-not-for-logs';
  let count = 0;
  try {
    await vortex.chat(key, [{role: 'user', content: 'hello'}], undefined, async (_url, options) => {
      count++;
      assert.equal(JSON.parse(options.body).model, 'vortex-pro');
      return response(403, {error: {message: 'Rejected ' + key}});
    });
    assert.fail('expected authorization error');
  } catch (error) {
    assert.match(error.message, /not authorized/);
    assert.ok(!error.message.includes(key));
  }
  assert.equal(count, 1);
});

test('compatible chat validates content and token limits without silently replacing input', async () => {
  const never = async () => { throw Error('unexpected network call'); };
  await assert.rejects(vortex.chat('opaque-key-1234', [{role: 'user', content: {bad: true}}], undefined, never), /content/);
  await assert.rejects(vortex.chat('opaque-key-1234', [{role: 'user', content: 'hello'}], undefined, never, {maxTokens: NaN}), /positive integer/);
  await assert.rejects(vortex.models('opaque-key-1234', async () => response(200, null)), /invalid response/);
});

test('loopback inference adapter discovers models and chats through the real HTTP stack', async () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    calls.push({path: req.url, key: req.headers.authorization});
    if (req.headers.authorization !== 'Bearer local-test-key-1234') {
      res.writeHead(401, {'content-type': 'application/json'}).end('{"error":{"message":"invalid"}}');
      return;
    }
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/models') {
      res.end(JSON.stringify({data: [{id: 'vortex-pro'}]}));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    const input = JSON.parse(body);
    res.end(JSON.stringify({choices: [{message: {content: 'echo: ' + input.messages[0].content}}]}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    assert.deepEqual(await vortex.models('local-test-key-1234', globalThis.fetch, {endpoint}), ['vortex-pro']);
    assert.equal(await vortex.chat('local-test-key-1234', [{role: 'user', content: 'hello'}], undefined, globalThis.fetch, {endpoint}), 'echo: hello');
    assert.deepEqual(calls.map(c => c.path), ['/v1/models', '/v1/chat/completions']);
    assert.ok(calls.every(c => c.key === 'Bearer local-test-key-1234'));
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
