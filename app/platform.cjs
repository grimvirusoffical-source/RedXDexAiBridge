'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');

function findExecutable(name, platform = process.platform, env = process.env) {
  const dirs = (env.PATH || '').split(path.delimiter);
  const extras = platform === 'win32'
    ? [path.join(env.SystemRoot || 'C:\\Windows', 'System32'), path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'OpenSSH'), path.join(env.ProgramFiles || 'C:\\Program Files', 'GitHub CLI'), path.join(env.ProgramFiles || 'C:\\Program Files', 'cloudflared')]
    : ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin', path.join(os.homedir(), '.local', 'bin')];
  for (const dir of [...dirs, ...extras]) {
    if (!dir || !path.isAbsolute(dir)) continue;
    const file = path.join(dir, platform === 'win32' && !name.endsWith('.exe') ? name + '.exe' : name);
    try { if (fs.statSync(file).isFile()) return file; } catch {}
  }
  return null;
}

function powershell() {
  const native = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(native)) return native;
  const found = findExecutable('powershell') || findExecutable('pwsh');
  if (!found) throw Error('Windows PowerShell is required for native desktop controls');
  return found;
}

function execute(command, args, input = '', timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = cp.spawn(command, args, {shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '', stderr = '', settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(stdout);
    };
    const timer = setTimeout(() => { child.kill(); finish(Error('Native desktop helper timed out')); }, timeout);
    child.stdout.on('data', b => {
      stdout += b.toString();
      if (Buffer.byteLength(stdout) > 1024 * 1024) { child.kill(); finish(Error('Native helper output exceeded the limit')); }
    });
    child.stderr.on('data', b => { stderr = (stderr + b.toString()).slice(-4000); });
    child.on('error', finish);
    child.on('close', code => finish(code === 0 ? null : Error(stderr.trim() || 'Native helper failed with exit code ' + code)));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Invalid native request');
  const action = input.action;
  if (!['status', 'move', 'click', 'drag', 'scroll', 'type', 'key', 'launch'].includes(action)) throw Error('Unsupported native action');
  if (['move', 'click', 'drag'].includes(action)) {
    for (const field of action === 'drag' ? ['x', 'y', 'toX', 'toY'] : ['x', 'y']) {
      if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || Math.abs(input[field]) > 50000) throw Error('Invalid desktop coordinates');
    }
  }
  if (action === 'click' && ((input.button && !['left', 'right'].includes(input.button)) || (input.count !== undefined && ![1, 2].includes(input.count)))) throw Error('Invalid mouse button or count');
  if (action === 'scroll') for (const field of ['dx', 'dy']) if (input[field] !== undefined && (!Number.isInteger(input[field]) || Math.abs(input[field]) > 10000)) throw Error('Invalid scroll distance');
  if (action === 'type' && (typeof input.text !== 'string' || input.text.length > 8000)) throw Error('Text must contain at most 8000 UTF-16 units');
  if (action === 'key') {
    if (typeof input.key !== 'string' || !/^(?:[a-z0-9]|f(?:[1-9]|1[0-2])|enter|tab|space|backspace|escape|left|right|up|down|delete|home|end|pageup|pagedown)$/i.test(input.key)) throw Error('Unsupported key');
    if (input.modifiers !== undefined && (!Array.isArray(input.modifiers) || input.modifiers.length > 4 || input.modifiers.some(m => !['command', 'control', 'option', 'shift'].includes(m)))) throw Error('Unsupported modifier');
  }
  if (action === 'launch' && (typeof input.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,99}$/.test(input.name))) throw Error('Invalid application name');
  return input;
}

function linuxPlan(input, env = process.env) {
  validateInput(input);
  if (env.XDG_SESSION_TYPE === 'wayland' || env.WAYLAND_DISPLAY) {
    throw Error('Global mouse/keyboard control requires an X11 session on Linux. Wayland input injection is not supported; the app will not bypass its security controls.');
  }
  if (!env.DISPLAY) throw Error('An active Linux X11 display is required');
  const point = (x, y) => ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))];
  switch (input.action) {
    case 'move': return {args: point(input.x, input.y)};
    case 'click': return {args: [...point(input.x, input.y), 'click', '--repeat', String(input.count || 1), '--delay', '80', input.button === 'right' ? '3' : '1']};
    case 'drag': return {args: [...point(input.x, input.y), 'mousedown', '1', ...point(input.toX, input.toY), 'mouseup', '1']};
    case 'scroll': {
      const args = [];
      for (const [v, positive, negative] of [[input.dy || 0, '4', '5'], [input.dx || 0, '7', '6']]) {
        if (v) args.push('click', '--repeat', String(Math.min(100, Math.max(1, Math.ceil(Math.abs(v) / 120)))), v > 0 ? positive : negative);
      }
      return {args};
    }
    case 'type': return {args: ['type', '--clearmodifiers', '--delay', '1', '--file', '-'], stdin: input.text};
    case 'key': {
      const keys = {enter: 'Return', backspace: 'BackSpace', escape: 'Escape', pageup: 'Prior', pagedown: 'Next', delete: 'Delete', home: 'Home', end: 'End', left: 'Left', right: 'Right', up: 'Up', down: 'Down', tab: 'Tab'};
      const mods = {command: 'super', control: 'ctrl', option: 'alt', shift: 'shift'};
      const key = input.key.toLowerCase();
      return {args: ['key', '--clearmodifiers', [...(input.modifiers || []).map(m => mods[m]), keys[key] || (/^f\d+$/.test(key) ? key.toUpperCase() : key)].join('+')]};
    }
    default: throw Error('Unsupported Linux input action');
  }
}

async function windowsControl(input) {
  validateInput(input);
  const nativeHelper=[process.resourcesPath&&path.join(process.resourcesPath,'redxdex-control.exe'),path.join(__dirname,'..','build','redxdex-control.exe')].find(file=>file&&fs.existsSync(file));
  if(nativeHelper&&input.action!=='launch')return JSON.parse((await execute(nativeHelper,[],JSON.stringify(input))).trim());
  // Static bundled program; user text travels through stdin, never code interpolation.
  const script = fs.readFileSync(path.join(__dirname, 'windows-control.ps1'), 'utf8');
  const output = await execute(powershell(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], JSON.stringify(input));
  return JSON.parse(output.replace(/^\uFEFF/, '').trim());
}

function linuxTypeSteps(text) {
  validateInput({action:'type',text});
  const steps = [];
  let plain = '', unicodeKeys = [];
  const flushPlain = () => {
    if (!plain) return;
    steps.push({args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:plain});
    plain = '';
  };
  const flushUnicode = () => {
    if (!unicodeKeys.length) return;
    steps.push({args:['key','--clearmodifiers',...unicodeKeys]});
    unicodeKeys = [];
  };
  for (const character of text) {
    const point = character.codePointAt(0);
    if (point <= 0x7f) {
      flushUnicode();
      plain += character;
    } else {
      flushPlain();
      unicodeKeys.push('U' + point.toString(16).toUpperCase());
    }
  }
  flushPlain();
  flushUnicode();
  return steps;
}

async function linuxControl(input) {
  validateInput(input);
  const wayland = process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY;
  const xdotool = findExecutable('xdotool');
  if (input.action === 'status') return {
    platform: 'linux', session: wayland ? 'wayland' : process.env.DISPLAY ? 'x11' : 'headless',
    accessibility: !wayland && !!process.env.DISPLAY && !!xdotool,
    inputSupported: !wayland && !!process.env.DISPLAY && !!xdotool,
    message: wayland ? 'Screenshots use the desktop portal; global input requires an X11 login session.' : !xdotool ? 'Install xdotool through your distribution package manager for mouse and keyboard control.' : 'X11 desktop input is available in an active graphical session.'
  };
  if (input.action === 'launch') {
    const exact = findExecutable(input.name);
    if (exact) {
      const child = cp.spawn(exact, [], {detached: true, stdio: 'ignore', shell: false});
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); }); child.unref();
      return {ok: true, action: 'launch'};
    }
    const gtk = findExecutable('gtk-launch');
    if (!gtk) throw Error('Application executable not found; gtk-launch is also unavailable');
    await execute(gtk, [input.name.replace(/\.desktop$/, '')]);
    return {ok: true, action: 'launch'};
  }
  const plan = linuxPlan(input);
  if (!xdotool) throw Error('Install xdotool to enable Linux X11 mouse and keyboard control');
  if (input.action === 'type' && /[^\x00-\x7f]/.test(input.text)) {
    // X11 xdotool UTF-8 --file loses non-ASCII symbols on some keymaps.
    // Use a separate X11 keysym for each Unicode character; no shell or clipboard.
    for (const step of linuxTypeSteps(input.text)) {
      await execute(xdotool, step.args, step.stdin || '');
    }
  } else if (plan.args.length) await execute(xdotool, plan.args, plan.stdin || '');
  return {ok: true, action: input.action};
}

function childEnvironment(env=process.env){
 const out={};
 for(const key of ['PATH','Path','HOME','USERPROFILE','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','APPDATA','LOCALAPPDATA','DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','XDG_RUNTIME_DIR','XDG_SESSION_TYPE','DBUS_SESSION_BUS_ADDRESS'])if(env[key]!==undefined)out[key]=env[key];
 out.LANG=env.LANG||'en_US.UTF-8';return out;
}
module.exports = {childEnvironment,findExecutable, execute, powershell, validateInput, linuxPlan, linuxTypeSteps, windowsControl, linuxControl};
