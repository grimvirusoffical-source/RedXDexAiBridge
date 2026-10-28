'use strict';
const fs = require('node:fs');
const path = require('node:path');
const config = structuredClone(require('../package.json').build);
config.win.signAndEditExecutable = false;
// Cross-built packages use the complete bundled PowerShell/Win32 backend.
// Native Windows builds continue to prefer the compiled C# helper.
config.win.extraResources = [];
config.afterPack = path.resolve(__dirname, 'windows-resource-hook.cjs');
config.directories.output = 'dist-windows';
const file = path.resolve(__dirname, '../verification/windows-cross.config.json');
fs.mkdirSync(path.dirname(file), {recursive: true});
fs.writeFileSync(file, JSON.stringify(config, null, 2));
console.log(file);
