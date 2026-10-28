'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');

function findExecutable(name, {platform = process.platform, env = process.env} = {}) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  const p = platform === 'win32' ? path.win32 : path.posix;
  const dirs = (env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean);
  const suffixes = platform === 'win32' && !p.extname(name) ? ['.exe', '.com'] : [''];
  const candidates = p.isAbsolute(name) ? [name] : dirs.flatMap(dir => suffixes.map(ext => p.join(dir.replace(/^"|"$/g, ''), name + ext)));
  if (!p.isAbsolute(name) && /[\\/]/.test(name)) return null;
  return candidates.find(file => {
    try { fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(file).isFile(); } catch { return false; }
  }) || null;
}

function childEnvironment(env = process.env, platform = process.platform) {
  const allowed = ['PATH', 'Path', 'HOME', 'USERPROFILE', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
    'PATHEXT', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'LOGNAME',
    'DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'DBUS_SESSION_BUS_ADDRESS', 'LANG', 'LC_ALL'];
  const result = {};
  for (const key of allowed) if (typeof env[key] === 'string') result[key] = env[key];
  if (!result.LANG && platform !== 'win32') result.LANG = 'en_US.UTF-8';
  return result;
}

async function openApplication(name, {platform = process.platform, spawn = cp.spawn} = {}) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,99}$/.test(name)) throw Error('Use an application name, not shell commands or arguments.');
  let binary, args;
  if (platform === 'darwin') { binary = '/usr/bin/open'; args = ['-a', name]; }
  else if (platform === 'win32') {
    const aliases = {notepad:'notepad.exe', calculator:'calc.exe', explorer:'explorer.exe', paint:'mspaint.exe'};
    binary = findExecutable(aliases[name.toLowerCase()] || name);
    if (!binary) throw Error('Application executable not found on PATH. Use its executable name, for example notepad.exe.');
    args = [];
  } else if (platform === 'linux') {
    const launcher = findExecutable('gtk-launch');
    const executable = findExecutable(name);
    if (executable) { binary = executable; args = []; }
    else if (launcher) { binary = launcher; args = [name.replace(/\.desktop$/, '')]; }
    else throw Error('Application not found. Use an installed executable or install gtk-launch for desktop application IDs.');
  } else throw Error('Application launching is not supported on this platform.');
  await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {shell:false, detached:platform !== 'darwin', stdio:'ignore', windowsHide:false});
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = {findExecutable, childEnvironment, openApplication};
