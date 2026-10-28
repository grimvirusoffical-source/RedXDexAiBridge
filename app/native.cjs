'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {promisify} = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const linux = require('./linux-control.cjs');
let capture = null;

async function helper() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'redxdex-control');
  if (packaged && fs.existsSync(packaged)) return packaged;
  const built = path.join(__dirname, '..', 'build', 'redxdex-control');
  if (fs.existsSync(built)) return built;
  throw Error('The macOS control helper is missing. Use the packaged Mac application or run npm run prepare:native.');
}

async function control(input) {
  if (process.platform === 'linux') return linux.control(input);
  if (process.platform === 'win32') {
    if (input.action === 'status') return {
      accessibility:false, screenRecording:true, inputBackend:'Not included in this Windows preview',
      message:'Windows files, managed terminals, application launching, Vortex chat and screen capture are supported. Native mouse and keyboard injection are not included in this preview.'
    };
    throw Error('Windows mouse and keyboard control is not included in this preview. Other bridge capabilities remain available.');
  }
  if (process.platform !== 'darwin') throw Error('Unsupported desktop platform.');
  const {stdout} = await execFile(await helper(), [JSON.stringify(input)], {timeout:15000, maxBuffer:100000});
  return JSON.parse(stdout);
}

function permissionStatus(helperState, screenStatus, platform = process.platform) {
  if (platform !== 'darwin') return {
    ...helperState,
    screenRecording:screenStatus === 'available',
    screenRecordingStatus:screenStatus,
    screenRecordingMessage:helperState.message || 'Screen access is managed by the operating system and may require a screen-sharing selection.'
  };
  return {
    ...helperState,
    helperScreenRecording:!!helperState.screenRecording,
    screenRecording:screenStatus === 'granted',
    screenRecordingStatus:screenStatus,
    screenRecordingMessage:screenStatus === 'granted'
      ? 'The signed app has Screen Recording permission. Use the screenshot test to verify capture.'
      : 'Enable RedXDexAiBridge in macOS Screen & System Audio Recording, then quit and reopen the app. A helper permission does not authorize the app itself.'
  };
}

function setCaptureAdapter(fn) {
  if (typeof fn !== 'function') throw Error('Invalid screenshot adapter.');
  capture = fn;
}
async function screenshot() {
  if (!capture) throw Error('Capture must be requested through the running desktop app.');
  return capture();
}

module.exports = {control, screenshot, helper, permissionStatus, setCaptureAdapter};
