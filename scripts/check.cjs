'use strict';const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
for(const dir of ['app','scripts','test'])for(const file of fs.readdirSync(path.join(__dirname,'..',dir)))if(/\.(c?js)$/.test(file))cp.execFileSync(process.execPath,['--check',path.join(__dirname,'..',dir,file)],{stdio:'inherit'});
console.log('JavaScript syntax checks passed');
