'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),cp=require('node:child_process'),crypto=require('node:crypto');
const execFile=require('node:util').promisify(cp.execFile);
async function helper(){
 const packaged=process.resourcesPath&&path.join(process.resourcesPath,'redxdex-control');if(packaged&&fs.existsSync(packaged))return packaged;
 const built=path.join(__dirname,'..','build','redxdex-control');if(fs.existsSync(built))return built;
 throw Error('Native helper is not built. Run npm run prepare:native, or use the signed application.');
}
async function control(input){if(process.platform!=='darwin')throw Error('Desktop input currently requires macOS');const {stdout}=await execFile(await helper(),[JSON.stringify(input)],{timeout:15000,maxBuffer:100000});return JSON.parse(stdout);}
async function screenshot(){
 if(process.platform!=='darwin')throw Error('Screenshot currently requires macOS');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-screen-'));fs.chmodSync(dir,0o700);const file=path.join(dir,'screen.png');
 try{await execFile('/usr/sbin/screencapture',['-x','-t','png',file],{timeout:15000});if(!fs.existsSync(file))throw Error('Screen capture failed. Grant Screen Recording permission in macOS Settings.');const bytes=fs.readFileSync(file);if(bytes.length>8*1024*1024)throw Error('Screenshot exceeds the 8 MB limit');return bytes.toString('base64');}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
module.exports={control,screenshot,helper};
