'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {downloadCli,selectCli,officialAsset}=require('../app/cli-download.cjs');
const bytes=Buffer.from('test-only-cli-package'),sha=crypto.createHash('sha256').update(bytes).digest('hex');
const asset=name=>({name,size:name==='SHA256SUMS-cli'?100:bytes.length,digest:name==='SHA256SUMS-cli'?null:'sha256:'+sha,browser_download_url:'https://github.com/grimvirusoffical-source/RedXDexAiBridge/releases/download/cli-v0.3.0/'+name});
const metadata=[{tag_name:'cli-v0.3.0',draft:false,prerelease:false,assets:[asset('redxai-cli-0.3.0.tgz'),asset('SHA256SUMS-cli')]}];
const request=async url=>new Response(url.includes('/releases?')?JSON.stringify(metadata):url.endsWith('SHA256SUMS-cli')?sha+'  redxai-cli-0.3.0.tgz\n':bytes);
test('CLI version is independent and private/draft/preview downloads are refused',()=>{
 assert.equal(selectCli(metadata).version,'0.3.0');
 assert.throws(()=>selectCli([{...metadata[0],prerelease:true}]),/not been published/);
 assert.throws(()=>officialAsset({...asset('x'),browser_download_url:'https://github.com/grimvirusoffical-source/red-xai-installers/releases/download/cli-v0.3.0/x'},'cli-v0.3.0'),/origin/);
});
test('CLI is downloaded, checksummed and reported without executing anything',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-cli-')),progress=[];
 try{const result=await downloadCli({directory,request,onProgress:p=>progress.push(p)});assert.deepEqual(await fs.readFile(result.path),bytes);assert.equal(result.executed,false);assert.equal(result.requiresNode,true);assert.equal(result.version,'0.3.0');assert.equal(progress.at(-1).percent,100);assert.ok(progress.some(p=>p.phase==='verifying'));const again=await downloadCli({directory,request});assert.equal(again.sha256,result.sha256);}finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('a corrupt CLI archive or an existing different file cannot be published',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'bridge-cli-bad-'));
 try{
  await assert.rejects(downloadCli({directory,request:async url=>url.endsWith('.tgz')?new Response(Buffer.alloc(bytes.length)):request(url)}),/checksum/);
  assert.deepEqual(await fs.readdir(directory),[]);
  await fs.writeFile(path.join(directory,'redxai-cli-0.3.0.tgz'),'user file');
  await assert.rejects(downloadCli({directory,request}),/different file/);
  assert.equal(await fs.readFile(path.join(directory,'redxai-cli-0.3.0.tgz'),'utf8'),'user file');
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('native CLI download requires an explicit absolute directory',async()=>{await assert.rejects(downloadCli({directory:'relative',request}),/absolute/);});
