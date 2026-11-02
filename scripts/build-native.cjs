"use strict";
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),build=path.join(root,'build');fs.mkdirSync(build,{recursive:true});
if(process.platform==='darwin') {
 cp.execFileSync('/usr/bin/xcrun',['swiftc','-O',path.join(root,'app','control.swift'),'-o',path.join(build,'redxdex-control')],{stdio:'inherit'});
 fs.chmodSync(path.join(build,'redxdex-control'),0o755);
} else if(process.platform==='win32') {
 const compiler=path.join(process.env.WINDIR||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
 if(!fs.existsSync(compiler))throw Error('Windows .NET Framework compiler is required to build the native input helper.');
 cp.execFileSync(compiler,['/nologo','/optimize+','/target:exe','/platform:x64','/reference:System.Web.Extensions.dll','/out:'+path.join(build,'redxdex-control.exe'),path.join(root,'app','control-windows.cs')],{stdio:'inherit'});
 cp.execFileSync(compiler,['/nologo','/optimize+','/target:winexe','/platform:x86','/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll','/win32manifest:'+path.join(build,'installer-theme.manifest'),'/win32icon:'+path.join(build,'installer-icon.ico'),'/out:'+path.join(build,'redx-installer-theme.exe'),path.join(root,'scripts','installer-theme-ui.cs')],{stdio:'inherit'});
} else if(process.platform==='linux') {
 console.log('Linux uses X11 xdotool for input and Electron desktop capture. Wayland input is not silently emulated.');
} else throw Error('Unsupported build platform');
