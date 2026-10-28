'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const out=path.resolve(process.env.BRIDGE_SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'rxb-gui-')));
fs.mkdirSync(out,{recursive:true});
const binary=process.env.BRIDGE_BINARY || require('electron');
const env={...process.env,REDXDEX_DATA_DIR:path.join(out,'data'),REDXDEX_SMOKE_OUTPUT:out};
delete env.ELECTRON_RUN_AS_NODE;
const run=cp.spawnSync(binary,process.env.BRIDGE_BINARY?[]:[root],{cwd:root,env,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024});
fs.writeFileSync(path.join(out,'process.log'),(run.stdout||'')+(run.stderr||''));
if(run.error || run.status!==0){console.error(run.error?.message || run.stderr || 'GUI launch failed');process.exit(1);}
const result=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));
if(result.version!==require('../package.json').version || result.pages!==9 || !result.gateway || !result.preload || result.rendererErrors?.length){console.error(result);process.exit(1);}
console.log(JSON.stringify({platform:process.platform,arch:process.arch,...result,reportDirectory:out},null,2));
