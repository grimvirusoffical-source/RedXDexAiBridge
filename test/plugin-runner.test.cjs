'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PluginRunner, verifyLicense } = require('../app/plugin-runner.cjs');

// All tools and secret storage are in-memory fakes. These tests never touch a
// real file, command, desktop, account service, or network connection.
const keys = crypto.generateKeyPairSync('ed25519');
const sub = 'fixture-account';
const deviceId = 'fixture-device';
const pluginId = 'workflow-checkpoints';

function signRaw(json) {
  const encoded = Buffer.from(json).toString('base64url');
  const signature = crypto.sign(null, Buffer.from(encoded), keys.privateKey).toString('base64url');
  return { token: encoded + '.' + signature };
}

function sign(payload) {
  return signRaw(JSON.stringify(payload));
}

function payload(now = Date.now()) {
  return { issuer: 'https://red-xai.com', app: 'bridge', kind: 'plugin', sub, deviceId, pluginId,
    issuedMs: now - 1000, expiresMs: now + 60000 };
}

function info(path, extra = {}) {
  return { path, type: 'file', size: 4, modified: '2026-11-02T10:00:00.000Z', ...extra };
}

function fixture({ records = [], perform = async () => { throw Error('Unexpected tool call'); } } = {}) {
  let secret = JSON.stringify(records);
  const calls = [], saves = [];
  const platform = {
    catalog: async () => ({ licensePublicKey: keys.publicKey,
      plugins: [{ id: pluginId, recipe: ['task.checkpoint', 'task.report'] }] }),
    identity: async () => ({ sub }),
    keys: async () => ({ deviceId }),
    call: async (route, data) => {
      assert.equal(route, '/plugins/license');
      assert.deepEqual(data, { pluginId });
      return sign(payload());
    },
  };
  const runner = new PluginRunner({ platform,
    perform: async (name, data, context) => {
      calls.push({ name, data: structuredClone(data), context });
      return perform(name, data, context);
    },
    loadSecret: async name => { assert.equal(name, 'plugin-checkpoints'); return secret; },
    saveSecret: async (name, value) => {
      assert.equal(name, 'plugin-checkpoints');
      saves.push(value);
      secret = value;
    },
  });
  return { runner, calls, saves, saved: () => JSON.parse(secret) };
}

test('checkpoint capture stores canonical files under the current account and device, then restores through approved tools', async () => {
  const canonical = '/approved/project/a.txt';
  const context = { connectionId: 'fixture-approved-connection' };
  const written = [];
  const f = fixture({ perform: async (name, data, actualContext) => {
    assert.equal(actualContext, context);
    if (name === 'file_info') return { text: JSON.stringify(info(canonical)) };
    if (name === 'read_text_file') {
      assert.equal(data.path, canonical);
      return { text: 'one\n' };
    }
    if (name === 'write_text_file') { written.push(data); return { text: 'saved' }; }
    throw Error('Unexpected tool: ' + name);
  } });
  const result = await f.runner.run({ pluginId, files: ['/approved/selected-alias.txt'] }, context);
  assert.equal(f.saves.length, 1);
  const [record] = f.saved();
  assert.equal(record.sub, sub);
  assert.equal(record.deviceId, deviceId);
  assert.equal(typeof record.id, 'string');
  assert.ok(Number.isSafeInteger(record.at));
  assert.deepEqual(record.files, [{ path: canonical, content: 'one\n' }]);
  assert.equal(result.steps[0].id, record.id);
  assert.deepEqual(written, []);
  assert.deepEqual(f.calls.map(c => c.name), ['file_info', 'read_text_file', 'file_info']);

  const restored = await f.runner.run({ pluginId, action: 'restore', checkpointId: record.id }, context);
  assert.deepEqual(restored, { restored: 1, checkpointId: record.id });
  assert.deepEqual(written, [{ path: canonical, content: 'one\n' }]);
  assert.equal(f.saves.length, 1, 'restore must not rewrite checkpoint history');
});

for (const [label, changed] of [
  ['canonical path', { path: '/outside/replacement.txt' }],
  ['size', { size: 5 }],
  ['modified time', { modified: '2026-11-02T10:00:01.000Z' }],
  ['file type', { type: 'directory' }],
]) {
  test('capture rejects a changed ' + label + ' during a read without saving partial history', async () => {
    const original = [{ id: 'existing', sub, deviceId, at: 1, files: [] }];
    let checks = 0;
    const f = fixture({ records: original, perform: async name => {
      if (name === 'file_info') return { text: JSON.stringify(info('/approved/a.txt', checks++ ? changed : {})) };
      if (name === 'read_text_file') return { text: 'one\n' };
      throw Error('Unexpected tool: ' + name);
    } });
    await assert.rejects(f.runner.run({ pluginId, files: ['/approved/a.txt'] }), /changed while being read/);
    assert.equal(f.saves.length, 0);
    assert.deepEqual(f.saved(), original);
    assert.equal(f.calls.some(c => c.name === 'write_text_file'), false);
  });
}

test('a failed or oversized read never saves a partial checkpoint', async () => {
  for (const oversized of [false, true]) {
    const f = fixture({ perform: async name => {
      if (name === 'file_info') return { text: JSON.stringify(info('/approved/a.txt')) };
      if (name === 'read_text_file') {
        if (!oversized) throw Error('Permission denied');
        return { text: 'x'.repeat(5 * 1024 * 1024 + 1) };
      }
      throw Error('Unexpected tool: ' + name);
    } });
    await assert.rejects(f.runner.run({ pluginId, files: ['/approved/a.txt'] }), oversized ? /larger than 5 MiB/ : /Permission denied/);
    assert.equal(f.saves.length, 0);
    assert.deepEqual(f.saved(), []);
  }
});

test('restore preflights every target before the first write and rechecks each target before overwriting', async () => {
  const files = [{ path: '/approved/a.txt', content: 'a' }, { path: '/approved/b.txt', content: 'b' }];
  const record = { id: 'owned', sub, deviceId, at: 1, files };
  const checked = new Set(), writes = [];
  const f = fixture({ records: [record], perform: async (name, data) => {
    if (name === 'file_info') { checked.add(data.path); return { text: JSON.stringify(info(data.path)) }; }
    if (name === 'write_text_file') {
      assert.equal(checked.size, files.length, 'all targets must have passed preflight before any overwrite');
      writes.push(data);
      return { text: 'saved' };
    }
    throw Error('Unexpected tool: ' + name);
  } });
  assert.deepEqual(await f.runner.run({ pluginId, action: 'restore', checkpointId: 'owned' }), { restored: 2, checkpointId: 'owned' });
  assert.deepEqual(writes, files);
  assert.deepEqual(f.calls.map(c => [c.name, c.data.path]), [
    ['file_info', files[0].path], ['file_info', files[1].path],
    ['file_info', files[0].path], ['write_text_file', files[0].path],
    ['file_info', files[1].path], ['write_text_file', files[1].path],
  ]);
  assert.equal(f.saves.length, 0);
});

for (const failure of ['canonical target changed', 'non-file target', 'permission denied']) {
  test('restore writes nothing when a later preflight fails: ' + failure, async () => {
    const files = [{ path: '/approved/a.txt', content: 'a' }, { path: '/approved/b.txt', content: 'b' }];
    const f = fixture({ records: [{ id: 'owned', sub, deviceId, at: 1, files }], perform: async (name, data) => {
      assert.equal(name, 'file_info', 'no write may occur until all targets pass preflight');
      if (data.path === files[1].path) {
        if (failure === 'permission denied') throw Object.assign(Error('Permission denied'), { code: 'EACCES' });
        return { text: JSON.stringify(info(data.path, failure === 'non-file target' ? { type: 'directory' } : { path: '/outside/replacement.txt' })) };
      }
      return { text: JSON.stringify(info(data.path)) };
    } });
    await assert.rejects(f.runner.run({ pluginId, action: 'restore', checkpointId: 'owned' }), /changed to a different file|Permission denied/);
    assert.equal(f.calls.some(c => c.name === 'write_text_file'), false);
    assert.equal(f.saves.length, 0);
  });
}

test('restore refuses a target that changes after the complete preflight', async () => {
  let checks = 0;
  const f = fixture({ records: [{ id: 'owned', sub, deviceId, at: 1,
    files: [{ path: '/approved/a.txt', content: 'a' }] }], perform: async name => {
    assert.equal(name, 'file_info');
    return { text: JSON.stringify(info(checks++ ? '/outside/replacement.txt' : '/approved/a.txt')) };
  } });
  await assert.rejects(f.runner.run({ pluginId, action: 'restore', checkpointId: 'owned' }), /changed to a different file/);
  assert.equal(f.calls.some(c => c.name === 'write_text_file'), false);
});

test('checkpoint listing and restore do not reveal records belonging to another account or device', async () => {
  const records = [
    { id: 'other-account', sub: 'someone-else', deviceId, at: 1, files: [{ path: '/private/other.txt', content: 'private' }] },
    { id: 'other-device', sub, deviceId: 'different-device', at: 2, files: [{ path: '/private/device.txt', content: 'private' }] },
    { id: 'own', sub, deviceId, at: 3, files: [{ path: '/approved/own.txt', content: 'own' }] },
  ];
  const f = fixture({ records });
  assert.deepEqual(await f.runner.listCheckpoints(), { checkpoints: [{ id: 'own', at: 3, files: 1 }] });
  for (const checkpointId of ['other-account', 'other-device', 'missing']) {
    await assert.rejects(f.runner.run({ pluginId, action: 'restore', checkpointId }), /Checkpoint not found for this device/);
  }
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.saved(), records);
  assert.equal(f.saves.length, 0);
});

test('valid signatures cannot authorize missing, non-finite or mistyped license timestamps', () => {
  const now = 1700000000000;
  const valid = payload(now);
  const expected = { sub, deviceId, pluginId, now };
  assert.deepEqual(verifyLicense(sign(valid), keys.publicKey, expected), valid);
  for (const field of ['issuedMs', 'expiresMs']) {
    const missing = { ...valid };
    delete missing[field];
    assert.throws(() => verifyLicense(sign(missing), keys.publicKey, expected), /not active/);
    for (const literal of ['null', '1e309', '-1e309', '"1700000000000"', '1700000000000.5']) {
      // JSON.parse accepts an overflowing numeric literal as Infinity. Sign the
      // exact malformed payload so schema rejection cannot rely on a bad signature.
      const malformed = JSON.stringify(valid).replace(new RegExp('"' + field + '":\\d+'), '"' + field + '":' + literal);
      assert.notEqual(malformed, JSON.stringify(valid));
      assert.throws(() => verifyLicense(signRaw(malformed), keys.publicKey, expected), /not active/,
        field + ' must reject ' + literal + ' despite its authentic signature');
    }
  }
});
