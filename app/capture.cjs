'use strict';

// Capture inside the running Electron application's OS permission boundary.
// Never use another application's recording permission as a fallback.
async function captureDesktop({desktopCapturer, screen, systemPreferences, platform = process.platform}) {
  if (!desktopCapturer?.getSources || !screen?.getPrimaryDisplay) throw Error('Screen capture requires the running desktop application.');
  if (platform === 'darwin' && systemPreferences?.getMediaAccessStatus('screen') !== 'granted') {
    throw Error('Enable RedXDexAiBridge in macOS Settings → Privacy & Security → Screen & System Audio Recording, then quit and reopen it.');
  }
  const display = screen.getPrimaryDisplay();
  const scale = display.scaleFactor || 1;
  const requestedWidth = Math.max(1, Math.round(display.size.width * scale));
  const requestedHeight = Math.max(1, Math.round(display.size.height * scale));
  const shrink = Math.min(1, 4096 / Math.max(requestedWidth, requestedHeight));
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {width:Math.round(requestedWidth * shrink), height:Math.round(requestedHeight * shrink)},
    fetchWindowIcons: false
  });
  const source = sources.find(item => item.display_id === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw Error('No screen was shared. On Wayland, approve the system screen-sharing portal; an interactive desktop is required.');
  let image = source.thumbnail;
  let bytes = image.toPNG();
  if (bytes.length > 8 * 1024 * 1024) {
    const size = image.getSize();
    image = image.resize({width:Math.max(1, Math.round(size.width / 2)), height:Math.max(1, Math.round(size.height / 2))});
    bytes = image.toPNG();
  }
  if (bytes.length > 8 * 1024 * 1024 || bytes.length < 8) throw Error('Screen capture exceeds the image-size limit or returned an empty image.');
  return bytes.toString('base64');
}
module.exports = {captureDesktop};
