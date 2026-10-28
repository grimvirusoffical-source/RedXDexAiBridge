'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
module.exports = async context => {
  if (context.electronPlatformName !== 'win32') return;
  const tool = process.env.REDXDEX_WINRES;
  if (!tool || !path.isAbsolute(tool) || !fs.existsSync(tool)) throw Error('Set REDXDEX_WINRES to the pinned go-winres 0.3.3 build tool');
  const root = context.packager.projectDir;
  const version = context.packager.appInfo.version;
  const exe = path.join(context.appOutDir, 'RedXDexAiBridge.exe');
  const spec = {
    RT_GROUP_ICON: {APP: {'0000': path.join(root, 'build/icon.ico')}},
    RT_VERSION: {'#1': {'0000': {
      fixed: {file_version: version + '.0', product_version: version + '.0'},
      info: {'0409': {CompanyName: 'Red-XAI', FileDescription: 'Red-XAI Bridge', ProductName: 'Red-XAI Bridge', FileVersion: version, ProductVersion: version, OriginalFilename: 'RedXDexAiBridge.exe'}}
    }}}
  };
  const config = path.join(root, 'verification', 'windows-resources.json');
  fs.mkdirSync(path.dirname(config), {recursive: true});
  fs.writeFileSync(config, JSON.stringify(spec, null, 2));
  cp.execFileSync(tool, ['patch', '--in', config, '--no-backup', '--authenticode', 'remove', exe], {stdio: 'inherit', timeout: 60000});
  console.log('Windows icon/version resources applied; executable is intentionally unsigned.');
};
