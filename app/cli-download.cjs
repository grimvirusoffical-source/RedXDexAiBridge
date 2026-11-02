'use strict';
// Anonymous downloads contain only the selected CLI package, never the private
// source repository, a GitHub token, or account credentials.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const REPO='grimvirusoffical-source/RedXDexAiBridge';
const MAX_PACKAGE=64*1024*1024;
async function boundedText(response,limit){
 const chunks=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>limit)throw Error('CLI release metadata exceeded its size limit');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks).toString('utf8');
}
function officialAsset(asset,tag){
 if(!asset||!/^[-A-Za-z0-9._]+$/.test(asset.name||'')||!Number.isSafeInteger(asset.size)||asset.size<1||asset.size>MAX_PACKAGE)throw Error('Invalid CLI release asset');
 const url=new URL(asset.browser_download_url||'');
 const expected='/'+REPO+'/releases/download/'+encodeURIComponent(tag)+'/'+asset.name;
 if(url.protocol!=='https:'||url.hostname!=='github.com'||url.username||url.password||url.search||url.hash||url.pathname!==expected)throw Error('Unexpected CLI download origin');
 return {...asset,url:url.href};
}
function versionCompare(a,b){const aa=a.split('.').map(Number),bb=b.split('.').map(Number);return bb[0]-aa[0]||bb[1]-aa[1]||bb[2]-aa[2];}
function selectCli(releases){
 if(!Array.isArray(releases))throw Error('Invalid public CLI release response');
 const candidates=[];
 for(const release of releases){
  if(release.draft!==false||release.prerelease!==false||typeof release.tag_name!=='string'||!Array.isArray(release.assets))continue;
  for(const asset of release.assets){
   const m=/^redxai-cli-(\d+\.\d+\.\d+)\.tgz$/.exec(asset.name||'');
   if(m)candidates.push({release,version:m[1],asset});
  }
 }
 candidates.sort((a,b)=>versionCompare(a.version,b.version));
 if(!candidates.length)throw Error('The public REDXAI CLI package has not been published yet');
 const selected=candidates[0],sums=selected.release.assets.find(a=>a.name==='SHA256SUMS-cli');
 if(!sums)throw Error('The CLI release is missing SHA256SUMS-cli');
 return {version:selected.version,tag:selected.release.tag_name,asset:officialAsset(selected.asset,selected.release.tag_name),sums:officialAsset(sums,selected.release.tag_name)};
}
function expectedHash(text,name){
 const entries=new Map();
 for(const line of text.trim().split(/\r?\n/)){
  const m=/^([a-fA-F0-9]{64})\s+\*?([-A-Za-z0-9._]+)$/.exec(line);
  if(!m||entries.has(m[2]))throw Error('Invalid CLI checksum metadata');entries.set(m[2],m[1].toLowerCase());
 }
 const hash=entries.get(name);if(!hash)throw Error('The CLI package is not covered by SHA256SUMS-cli');return hash;
}
async function downloadCli({directory,request=globalThis.fetch,onProgress=()=>{}}={}){
 if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('Choose an absolute download directory first');
 if(typeof request!=='function')throw Error('An HTTPS download transport is required');
 const notify=value=>{try{onProgress(value);}catch{}};
 notify({phase:'discovery',message:'Finding the verified REDXAI CLI download…'});
 const metadata=await request('https://api.github.com/repos/'+REPO+'/releases?per_page=100',{headers:{accept:'application/vnd.github+json','user-agent':'Red-XAI-Bridge-CLI-Download'},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!metadata.ok)throw Error('Public CLI release discovery failed (HTTP '+metadata.status+')');
 const selected=selectCli(JSON.parse(await boundedText(metadata,4*1024*1024)));
 const sumsResponse=await request(selected.sums.url,{redirect:'follow',signal:AbortSignal.timeout(30000)});
 if(!sumsResponse.ok)throw Error('The CLI release checksum could not be downloaded');
 const hash=expectedHash(await boundedText(sumsResponse,65536),selected.asset.name);
 if(selected.asset.digest&&selected.asset.digest!=='sha256:'+hash)throw Error('CLI checksum and GitHub digest disagree');
 await fs.mkdir(directory,{recursive:true});const dest=path.join(directory,selected.asset.name);
 const temp=await fs.mkdtemp(path.join(directory,'.redx-cli-')),partial=path.join(temp,'package.tgz');
 try{
  const response=await request(selected.asset.url,{redirect:'follow',signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error('CLI package download failed (HTTP '+response.status+')');
  const file=await fs.open(partial,'wx',0o600),digest=crypto.createHash('sha256');let received=0;
  try{
   for await(const chunk of response.body){
    received+=chunk.length;if(received>selected.asset.size)throw Error('The CLI download exceeded its advertised size');
    digest.update(chunk);await file.write(chunk);
    notify({phase:'downloading',received,total:selected.asset.size,percent:Math.floor(received*100/selected.asset.size),message:'Downloading REDXAI CLI…'});
   }
   await file.sync();
  }finally{await file.close();}
  notify({phase:'verifying',received,total:selected.asset.size,message:'Verifying the CLI package checksum…'});
  if(received!==selected.asset.size||digest.digest('hex')!==hash)throw Error('The CLI download failed checksum verification');
  // Publish only verified bytes, with exclusive creation. copyFile also works
  // on Windows restricted sessions and filesystems that do not support links.
  try{await fs.copyFile(partial,dest,require('node:fs').constants.COPYFILE_EXCL);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const current=await fs.lstat(dest);
   if(!current.isFile()||current.isSymbolicLink()||current.size!==received||crypto.createHash('sha256').update(await fs.readFile(dest)).digest('hex')!==hash)throw Error('A different file already exists at the CLI download path');
  }
  const result={path:dest,version:selected.version,bytes:received,sha256:hash,requiresNode:true,minimumNodeVersion:20,executed:false,installHint:'Install Node.js 20 or later, then install this verified archive with npm.',commands:['REDXAI bridge download','REDXAI bridge install','REDXAI update']};
  notify({phase:'downloaded',received,total:received,percent:100,message:'REDXAI CLI downloaded and verified.'});return result;
 }finally{await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={downloadCli,selectCli,expectedHash,officialAsset};
