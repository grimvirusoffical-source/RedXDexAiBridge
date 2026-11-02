'use strict';
// Read-only public-release integration. No installer or downloaded code runs.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {downloadCli}=require('../app/cli-download.cjs');
async function main(){
 if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP)throw Error('Live download verification runs in hosted CI only');
 const root=fs.realpathSync(process.env.RUNNER_TEMP),directory=fs.mkdtempSync(path.join(root,'redx-cli-live-'));
 assert.equal(path.dirname(fs.realpathSync(directory)),root);
 const result=await downloadCli({directory});
 assert.equal(result.executed,false);assert.equal(result.requiresNode,true);
 assert.match(result.version,/^\d+\.\d+\.\d+$/);assert.match(result.sha256,/^[a-f0-9]{64}$/);
 assert.equal(fs.statSync(result.path).size,result.bytes);
 const output=path.join(__dirname,'../verification/cli-download');fs.mkdirSync(output,{recursive:true});
 fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({passed:true,version:result.version,bytes:result.bytes,sha256:result.sha256,executed:result.executed},null,2));
 console.log('Public CLI download verified: '+result.version+'; downloaded code was not executed.');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={main};
