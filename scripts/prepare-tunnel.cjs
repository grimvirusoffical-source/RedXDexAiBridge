'use strict';
// Pin both version and independent release digest: never execute an unverified download.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const VERSION = '2026.10.5';
const ASSETS = {
  'darwin-arm64': ['cloudflared-darwin-arm64.tgz', '184c7d4f5f977348243a6d7ca8f6cf6073b9b2746cfe8c1fe15aa59e9a522bf0'],
  'win32-x64': ['cloudflared-windows-amd64.exe', 'db4e4c413612a0916f3e1679d3caaf376f94911952d163028fb726fb2e0516a9'],
  'linux-x64': ['cloudflared-linux-amd64', 'e1bc0cf084fd9e590554fe769a86b1db46701c3f847a43d902f7b974a4e16298']
};
async function main() {
  const requested=process.argv.find(x=>x.startsWith('--target='));
  const targetKey=requested?requested.slice(9):process.platform+'-'+process.arch;
  const platform=targetKey.split('-')[0];
  const selected = ASSETS[targetKey];
  if (!selected) throw Error('No pinned tunnel binary for ' + process.platform + '-' + process.arch);
  const [name, sha256] = selected;
  const dir = path.resolve(__dirname, '../build/tunnel');
  fs.mkdirSync(dir, {recursive: true});
  const archive = path.join(dir, name);
  let bytes = fs.existsSync(archive) ? fs.readFileSync(archive) : null;
  if (!bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) {
    const url = `https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${name}`;
    const r = await fetch(url, {signal: AbortSignal.timeout(120000)});
    if (!r.ok) throw Error('Tunnel download failed: HTTP ' + r.status);
    bytes = Buffer.from(await r.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) throw Error('Tunnel SHA-256 mismatch; refusing to package it');
    fs.writeFileSync(archive, bytes);
  }
  const target = path.join(dir, platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (name.endsWith('.tgz')) {
    const entries = cp.execFileSync('/usr/bin/tar', ['-tzf', archive], {encoding: 'utf8'}).trim().split('\n');
    if (entries.some(p => p.startsWith('/') || p.split('/').includes('..'))) throw Error('Unsafe archive path');
    cp.execFileSync('/usr/bin/tar', ['-xzf', archive, '-C', dir]);
    if (!fs.existsSync(target)) throw Error('Tunnel archive did not contain cloudflared');
  } else fs.copyFileSync(archive, target);
  fs.chmodSync(target, 0o755);
  fs.copyFileSync(path.resolve(__dirname,'../app/assets/cloudflared-LICENSE.txt'),path.join(dir,'LICENSE'));
  fs.writeFileSync(path.join(dir, 'PROVENANCE.json'), JSON.stringify({version: VERSION, source: name, sha256}, null, 2));
  console.log('Bundled checksum-verified Cloudflare tunnel ' + VERSION + ' for ' + process.platform + '-' + process.arch);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
