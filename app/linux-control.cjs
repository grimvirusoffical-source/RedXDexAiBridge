'use strict';
const cp = require('node:child_process');
const {promisify} = require('node:util');
const {findExecutable} = require('./platform.cjs');
const execFile = promisify(cp.execFile);

function environment(env = process.env) {
  const wayland = env.XDG_SESSION_TYPE === 'wayland' || !!env.WAYLAND_DISPLAY;
  return {wayland, x11:!!env.DISPLAY && !wayland, displayAvailable:!!(env.DISPLAY || env.WAYLAND_DISPLAY)};
}
function coordinate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 50000) throw Error('Invalid desktop coordinate.');
  return String(Math.round(value));
}
function keyName(key) {
  const special = {enter:'Return', tab:'Tab', space:'space', backspace:'BackSpace', escape:'Escape', left:'Left', right:'Right', up:'Up', down:'Down', delete:'Delete', home:'Home', end:'End', pageup:'Prior', pagedown:'Next'};
  if (typeof key !== 'string') throw Error('Invalid key.');
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  if (/^f(?:[1-9]|1[0-2])$/i.test(key)) return key.toUpperCase();
  if (special[key.toLowerCase()]) return special[key.toLowerCase()];
  throw Error('Unsupported key.');
}
async function control(input, options = {}) {
  const env = options.env || process.env;
  const info = environment(env);
  const binary = options.binary || findExecutable('xdotool');
  const execute = options.execute || ((args) => execFile(binary, args, {timeout:15000, maxBuffer:100000}));
  if (input.action === 'status') return {
    accessibility:!!(info.x11 && binary), screenRecording:info.displayAvailable,
    inputBackend:info.x11 ? 'X11 / xdotool' : info.wayland ? 'Wayland (input unavailable)' : 'No desktop session',
    message:info.wayland ? 'Wayland screenshot access uses the desktop portal. This release does not inject Wayland input; use an X11 session for mouse and keyboard control.' : binary ? 'Input is available only in the current interactive X11 session.' : 'Install xdotool using your Linux package manager to enable mouse and keyboard controls.'
  };
  if (!info.x11) throw Error(info.wayland ? 'Mouse and keyboard automation require an X11 desktop session in this release. Wayland input permissions are not bypassed.' : 'No interactive X11 display is available.');
  if (!binary) throw Error('xdotool is required for Linux X11 input. Install it using your distribution’s package manager.');
  const point = (x = input.x, y = input.y) => ['mousemove', '--sync', '--', coordinate(x), coordinate(y)];
  switch (input.action) {
    case 'move': await execute(point()); break;
    case 'click': {
      const count = input.count === undefined ? 1 : input.count;
      if (![1, 2].includes(count) || ![undefined, 'left', 'right'].includes(input.button)) throw Error('Invalid click options.');
      await execute(point());
      await execute(['click', '--repeat', String(count), '--delay', '70', input.button === 'right' ? '3' : '1']);
      break;
    }
    case 'drag':
      coordinate(input.toX); coordinate(input.toY);
      await execute(point()); await execute(['mousedown', '1']);
      try { await execute(point(input.toX, input.toY)); } finally { await execute(['mouseup', '1']); }
      break;
    case 'scroll':
      for (const [value, positive, negative] of [[input.dy || 0, '4', '5'], [input.dx || 0, '7', '6']]) {
        if (!Number.isInteger(value) || Math.abs(value) > 10000) throw Error('Invalid scroll distance.');
        if (value) await execute(['click', '--repeat', String(Math.min(50, Math.max(1, Math.ceil(Math.abs(value) / 40)))), '--delay', '10', value > 0 ? positive : negative]);
      }
      break;
    case 'type':
      if (typeof input.text !== 'string' || input.text.length > 8000 || input.text.includes('\0')) throw Error('Text must contain at most 8000 characters and no NUL.');
      if (input.text) await execute(['type', '--clearmodifiers', '--delay', '1', '--', input.text]);
      break;
    case 'key': {
      const map = {command:'super', control:'ctrl', option:'alt', shift:'shift'};
      const modifiers = input.modifiers || [];
      if (!Array.isArray(modifiers) || modifiers.length > 4 || modifiers.some(item => !Object.hasOwn(map, item))) throw Error('Invalid keyboard modifiers.');
      const chord = [...modifiers.map(item => map[item]), keyName(input.key)].join('+');
      await execute(['key', '--clearmodifiers', '--', chord]);
      break;
    }
    default: throw Error('Unsupported Linux desktop action.');
  }
  return {ok:true, action:input.action};
}
module.exports = {control, environment, coordinate, keyName};
