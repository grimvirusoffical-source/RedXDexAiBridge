'use strict';const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-suite-'));
const files=fs.readdirSync(path.join(__dirname,'..','test')).filter(f=>f.endsWith('.test.cjs')).map(f=>path.join(__dirname,'..','test',f));
try{const r=cp.spawnSync(process.execPath,['--test','--test-concurrency=1',...files],{stdio:'inherit',env:{...process.env,REDXDEX_DATA_DIR:dir}});process.exitCode=r.status??1;}finally{fs.rmSync(dir,{recursive:true,force:true});}
