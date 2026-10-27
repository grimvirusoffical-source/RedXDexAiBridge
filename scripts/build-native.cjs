'use strict';
const cp=require('node:child_process'),path=require('node:path'),fs=require('node:fs');
if(process.platform!=='darwin')throw Error('Compile the macOS helper on a Mac');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'build'),{recursive:true});
cp.execFileSync('/usr/bin/xcrun',['swiftc','-O',path.join(root,'app','control.swift'),'-o',path.join(root,'build','redxdex-control')],{stdio:'inherit'});
fs.chmodSync(path.join(root,'build','redxdex-control'),0o755);
