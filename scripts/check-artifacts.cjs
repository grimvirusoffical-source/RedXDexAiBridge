'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const dir=path.join(root,'dist');
const version=require('../package.json').version;
const wanted=process.platform==='win32'?['.exe']:process.platform==='linux'?['.AppImage','.deb']:['.dmg','.zip'];
const sums=[];
for(const extension of wanted){
 const matches=fs.readdirSync(dir).filter(name=>name.includes(version)&&name.endsWith(extension));
 if(!matches.length)throw Error('Missing '+extension+' installer');
 for(const name of matches){
  const data=fs.readFileSync(path.join(dir,name));
  if(data.length<1024*1024)throw Error('Installer unexpectedly small: '+name);
  if(extension==='.exe'&&data.subarray(0,2).toString()!=='MZ')throw Error('Invalid Windows executable');
  if(extension==='.AppImage'&&data.subarray(0,4).compare(Buffer.from([0x7f,0x45,0x4c,0x46]))!==0)throw Error('Invalid AppImage');
  if(extension==='.deb'&&!data.subarray(0,8).equals(Buffer.from('!<arch>\n')))throw Error('Invalid Debian package');
  if(extension==='.zip'&&data.readUInt32LE(0)!==0x04034b50)throw Error('Invalid ZIP');
  sums.push(crypto.createHash('sha256').update(data).digest('hex')+'  '+name);
 }
}
const metadata=process.platform==='darwin'?'latest-mac.yml':process.platform==='linux'?'latest-linux.yml':'latest.yml';
if(!fs.readFileSync(path.join(dir,metadata),'utf8').includes('version: '+version))throw Error('Update metadata version mismatch');
fs.writeFileSync(path.join(dir,'SHA256SUMS-'+process.platform+'.txt'),sums.join('\n')+'\n');
console.log(JSON.stringify({platform:process.platform,version,validated:sums.length,metadata},null,2));
