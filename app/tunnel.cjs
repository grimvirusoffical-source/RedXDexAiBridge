'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const {findExecutable}=require('./platform.cjs');

function validateRelay(value) {
  if (!value || value.mode !== 'ssh') throw Error('Unsupported relay configuration');
  const origin = new URL(value.publicOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) {
    throw Error('Relay public origin must be a plain HTTPS origin');
  }
  if (typeof value.host !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value.host)) throw Error('Invalid relay hostname');
  if (typeof value.user !== 'string' || !/^[a-z_][a-z0-9_-]{0,31}$/.test(value.user)) throw Error('Invalid relay username');
  if (!Number.isInteger(value.remotePort) || value.remotePort < 1024 || value.remotePort > 65535) throw Error('Invalid relay port');
  for (const key of ['identityFile', 'knownHostsFile']) {
    if (typeof value[key] !== 'string' || !path.isAbsolute(value[key])) throw Error('Relay key paths must be absolute');
  }
  return {...value, publicOrigin: origin.origin};
}

function sshArguments(config, localURL) {
  const c = validateRelay(config), url = new URL(localURL);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) throw Error('Tunnel upstream must be loopback');
  return ['-nNT', '-i', c.identityFile,
    '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'UserKnownHostsFile=' + c.knownHostsFile, '-o', 'ExitOnForwardFailure=yes',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ConnectTimeout=10',
    '-o', 'RequestTTY=no', '-o', 'ControlMaster=no',
    '-R', `127.0.0.1:${c.remotePort}:127.0.0.1:${url.port}`, `${c.user}@${c.host}`];
}

async function probeEndpoint(mcpURL, request = globalThis.fetch) {
  const u = new URL(mcpURL);
  const response = await request(u.origin + '/.well-known/oauth-protected-resource/mcp', {
    redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw Error('Relay returned HTTP ' + response.status);
  const metadata = await response.json();
  if (metadata.resource !== mcpURL || !Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.includes(u.origin)) {
    throw Error('Relay OAuth metadata does not match this bridge');
  }
  return true;
}

class Tunnel {
  constructor(emit = () => {}, options = {}) {
    this.emit = emit;
    this.root = options.root || process.env.REDXDEX_DATA_DIR || path.join(os.homedir(), '.redxdex-ai-bridge');
    this.spawn = options.spawn || cp.spawn;
    this.request = options.fetch || globalThis.fetch;
    this.child = null;
    this.desired = false;
    this.generation = 0;
    this.retries = 0;
    this.probing = false;
    this.state = {phase: 'off', url: null, mode: null, lastCheckedAt: null, message: 'Remote access is off'};
  }
  config() {
    const file = path.join(this.root, 'remote.json');
    return fs.existsSync(file) ? validateRelay(JSON.parse(fs.readFileSync(file, 'utf8'))) : null;
  }
  status() { return {...this.state}; }
  set(value) { this.state = {...this.state, ...value}; this.emit(this.status()); }
  async start(localURL) {
    if (this.desired && this.child) return this.status();
    const upstream = new URL(localURL);
    if (upstream.protocol !== 'http:' || upstream.hostname !== '127.0.0.1' || !upstream.port || upstream.username || upstream.password) throw Error('Tunnel upstream must be loopback');
    this.configValue = this.config();
    if (this.configValue) {
      for (const file of [this.configValue.identityFile, this.configValue.knownHostsFile]) {
        if (!fs.statSync(file).isFile()) throw Error('Relay key configuration is missing');
      }
    }
    this.localURL = localURL;
    this.desired = true;
    this.retries = 0;
    const generation = ++this.generation;
    this.launch(generation);
    return this.status();
  }
  launch(generation) {
    if (!this.desired || generation !== this.generation) return;
    let binary, args;
    if (this.configValue) {
      binary = findExecutable('ssh');if(!binary)throw Error('Install the operating system OpenSSH client to use this relay'); args = sshArguments(this.configValue, this.localURL);
      this.set({phase: 'connecting', mode: 'vps', url: this.configValue.publicOrigin + '/mcp', message: 'Connecting to your VPS relay; verifying public OAuth endpoint…'});
    } else {
      const bundled=process.resourcesPath&&path.join(process.resourcesPath,'tunnel',process.platform==='win32'?'cloudflared.exe':'cloudflared');
      const built=path.join(__dirname,'..','build','tunnel',process.platform==='win32'?'cloudflared.exe':'cloudflared');
      binary=[bundled,built].find(p=>p&&fs.existsSync(p))||findExecutable('cloudflared');
      if (!binary) { this.desired = false; this.set({phase: 'error', url: null, message: 'Configure a VPS relay or install the official cloudflared client.'}); return; }
      args = ['tunnel', '--url', new URL(this.localURL).origin, '--no-autoupdate', '--protocol', 'http2', '--edge-ip-version', '4'];
      this.set({phase: 'connecting', mode: 'temporary', url: null, message: 'Starting temporary HTTPS tunnel…'});
    }
    const child = this.spawn(binary, args, {stdio: ['ignore', 'ignore', 'pipe'],windowsHide:true});
    this.child = child;
    let stderr = '';
    const failed = reason => {
      if (this.child !== child || generation !== this.generation) return;
      this.child = null; clearInterval(this.healthTimer);
      if (!this.desired) return;
      const delay = Math.min(30000, 2000 * 2 ** Math.min(this.retries++, 4));
      this.set({phase: 'retrying', message: 'Relay disconnected. Retrying in ' + (delay / 1000) + 's. ' + String(reason || '').slice(-180)});
      this.retryTimer = setTimeout(() => this.launch(generation), delay); this.retryTimer.unref?.();
    };
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk.toString()).slice(-4096);
      if (!this.configValue && !this.state.url) {
        const match = stderr.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
        if (match) { this.set({url: match[0] + '/mcp', message: 'Checking the temporary HTTPS address…'}); this.check(generation); }
      }
    });
    child.once('error', e => failed(e.message));
    child.once('exit', (code, signal) => failed('Transport exit ' + (signal || code) + '. ' + stderr.trim().split('\n').pop()));
    clearInterval(this.healthTimer);
    this.healthTimer = setInterval(() => this.check(generation), 15000); this.healthTimer.unref?.();
    this.initialTimer = setTimeout(() => this.check(generation), 1500); this.initialTimer.unref?.();
  }
  async check(generation = this.generation) {
    if (!this.desired || !this.child || !this.state.url || generation !== this.generation || this.probing) return;
    this.probing = true;
    const url = this.state.url;
    try {
      await probeEndpoint(url, this.request);
      if (!this.desired || generation !== this.generation || !this.child || this.state.url !== url) return;
      this.retries = 0;
      this.set({phase: 'online', lastCheckedAt: Date.now(), message: this.configValue
        ? 'Public endpoint verified. Your VPS relay keeps this address across app restarts. OAuth approval is required for new AIs.'
        : 'Public endpoint verified. Temporary address changes when this tunnel restarts; update remote clients afterward.'});
    } catch (error) {
      if (this.desired && generation === this.generation && this.child) this.set({phase: 'unreachable', lastCheckedAt: Date.now(), message: 'Remote endpoint is not reachable: ' + error.message + '. Local MCP remains available; checking again automatically.'});
    } finally { this.probing = false; }
  }
  stop() {
    this.desired = false; ++this.generation;
    clearInterval(this.healthTimer); clearTimeout(this.retryTimer); clearTimeout(this.initialTimer);
    const child = this.child; this.child = null; child?.kill('SIGTERM');
    this.set({phase: 'off', url: null, message: 'Remote access is off'});
    return this.status();
  }
}
module.exports = {Tunnel, validateRelay, sshArguments, probeEndpoint};
