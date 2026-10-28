'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const {promisify} = require('node:util');
const {validateInput, windowsControl, linuxControl} = require('./platform.cjs');
const execFile = promisify(cp.execFile);

async function helper() {
  const packaged = process.resourcesPath && path.join(process.resourcesPath, 'redxdex-control');
  if (packaged && fs.existsSync(packaged)) return packaged;
  const built = path.join(__dirname, '..', 'build', 'redxdex-control');
  if (fs.existsSync(built)) return built;
  throw Error('Native macOS helper is not built. Run npm run prepare:native or use the signed application.');
}

async function control(input) {
  validateInput(input);
  if (process.platform === 'win32') return windowsControl(input);
  if (process.platform === 'linux') return linuxControl(input);
  if (process.platform !== 'darwin') throw Error('Unsupported desktop platform');
  const {stdout} = await execFile(await helper(), [JSON.stringify(input)], {timeout: 15000, maxBuffer: 100000});
  return JSON.parse(stdout);
}

function permissionStatus(native, screenStatus, platform = process.platform) {
  if (platform !== 'darwin') return {...native, screenRecording: null, screenRecordingStatus: 'test-required', screenRecordingMessage: platform === 'linux' ? 'Screen capture requires an active graphical session. Wayland may show a system portal chooser.' : 'Capture is limited to your active desktop; lock screens and protected content are not accessible.'};
  return {...native, helperScreenRecording: !!native.screenRecording,
    screenRecording: screenStatus === 'granted', screenRecordingStatus: screenStatus,
    screenRecordingMessage: screenStatus === 'granted'
      ? 'The signed app has Screen Recording permission. Use the screenshot test to verify capture.'
      : 'Enable RedXDexAiBridge in macOS Screen & System Audio Recording, then quit and reopen the app.'};
}

async function screenshot() {
  try {
    if (process.versions.electron && process.env.ELECTRON_RUN_AS_NODE !== '1') {
      const {desktopCapturer, systemPreferences} = require('electron');
      if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') {
        throw Error('Enable RedXDexAiBridge in macOS Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen it.');
      }
      const sources = await desktopCapturer.getSources({types: ['screen'], thumbnailSize: {width: 1920, height: 1080}});
      const source = sources.find(item => item.thumbnail && !item.thumbnail.isEmpty());
      if (!source) throw Error('No screen capture was granted or no interactive display is available');
      const bytes = source.thumbnail.toPNG();
      if (bytes.length > 8 * 1024 * 1024) throw Error('Screenshot exceeds the 8 MB limit');
      return bytes.toString('base64');
    }
    if (process.platform !== 'darwin') throw Error('Start the desktop app to capture the screen on Windows or Linux');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'redxdex-screen-'));
    fs.chmodSync(dir, 0o700);
    const file = path.join(dir, 'screen.png');
    try {
      await execFile('/usr/sbin/screencapture', ['-x', '-t', 'png', file], {timeout: 15000});
      const bytes = fs.readFileSync(file);
      if (bytes.length > 8 * 1024 * 1024) throw Error('Screenshot exceeds the 8 MB limit');
      return bytes.toString('base64');
    } finally { fs.rmSync(dir, {recursive: true, force: true}); }
  } catch (error) {
    if (/could not create image|not authorized|permission|denied/i.test(String(error.stderr || error.message))) {
      throw Error(process.platform === 'darwin'
        ? 'Screen capture requires permission for RedXDexAiBridge itself in macOS Screen & System Audio Recording. Quit and reopen after granting it.'
        : 'The desktop session did not authorize screen capture. Check the system screen-sharing prompt and active display.');
    }
    throw error;
  }
}

async function openApplication(name) {
  validateInput({action: 'launch', name});
  if (process.platform === 'darwin') await execFile('/usr/bin/open', ['-a', name], {timeout: 15000});
  else await control({action: 'launch', name});
  return {text: 'Application launch requested'};
}

module.exports = {control, screenshot, helper, permissionStatus, openApplication};
