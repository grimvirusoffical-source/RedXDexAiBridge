'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app/main.cjs'),'utf8'),start=source.indexOf('const CI_SMOKE='),end=source.indexOf('const AUTH_SMOKE=',start),diagnostics=source.slice(start,end);
function load({packaged=false,hosted=true,actions='true',output}={}){
 const printed=[],hooks={};const context={app:{isPackaged:packaged,on:(event,fn)=>{hooks['app-'+event]=fn;}},process:{pid:321,platform:'darwin',env:{REDXDEX_SMOKE_OUTPUT:output,GITHUB_ACTIONS:actions,RUNNER_ENVIRONMENT:hosted?'github-hosted':'self-hosted'},once:(event,fn)=>{hooks['node-'+event]=fn;}},console:{error:value=>printed.push(value)},fs:output?fs:new Proxy({},{get(){throw Error('Unexpected diagnostic disk access');}}),path,Date};
 vm.createContext(context);vm.runInContext(diagnostics,context);return{context,printed,hooks};
}
test('lifecycle diagnostics write ordered timestamped capture and exit evidence only in hosted unpackaged smoke',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'redx-smoke-trace-'));
 try{
  const {context,hooks}=load({output:directory});
  vm.runInContext("smokeTrace('capture-return',{attempt:0});smokeTrace('result-write-complete');smokeTrace('exit-requested',{code:0});",context);
  hooks['app-quit']({},0);hooks['node-exit'](0);
  const records=fs.readFileSync(path.join(directory,'smoke-lifecycle.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(records.map(r=>r.event),['capture-return','result-write-complete','exit-requested','app-quit','node-exit']);
  for(const record of records){assert.equal(new Date(record.utc).toISOString(),record.utc);assert.ok(record.elapsedMs>=0);assert.equal(record.pid,321);assert.equal(record.platform,'darwin');}
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('ordinary, packaged and self-hosted sessions never register diagnostic hooks or write lifecycle files',()=>{
 for(const options of [{},{packaged:true,output:'/unused'},{hosted:false,output:'/unused'},{actions:'false',output:'/unused'}]){
  const {context,printed,hooks}=load(options);vm.runInContext("smokeTrace('must-not-write')",context);assert.deepEqual(hooks,{});assert.deepEqual(printed,[]);
 }
});
test('macOS cancellation remains failure and lifecycle evidence is uploaded after timeout',()=>{
 const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/desktop-release.yml'),'utf8');
 assert.match(workflow,/trap 'smoke_shell_marker SIGINT; exit 130' INT/);assert.match(workflow,/trap 'smoke_shell_marker SIGTERM; exit 143' TERM/);assert.ok(workflow.includes('bridge-mac-background-smoke/smoke-lifecycle.jsonl'));
 assert.match(source,/smokeTrace\('exit-requested',\{code:0\}\);app\.exit\(0\);smokeTrace\('exit-returned'/);
});
