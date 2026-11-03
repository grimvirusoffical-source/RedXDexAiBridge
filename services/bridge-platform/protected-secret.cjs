'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const FAILURE='Protected Sandbox credential could not be opened';
// Use the native, signed Windows module, rather than an inherited PowerShell 7
// module path. Execution policy is preserved; an OS refusal fails closed.
const DECRYPT_COMMAND="$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $secure=ConvertTo-SecureString $env:REDX_BRIDGE_ENCRYPTED_SECRET; $pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }";
const PROTECT_COMMAND="$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $secure=ConvertTo-SecureString ([Console]::In.ReadToEnd()) -AsPlainText -Force; try { [Console]::Out.WriteLine([Security.Principal.WindowsIdentity]::GetCurrent().User.Value); [Console]::Out.Write((ConvertFrom-SecureString $secure)) } finally { $secure.Dispose() }";
const keyPattern=kind=>kind==='sandbox-api'?/^rk_test_[A-Za-z0-9]{16,512}$/:kind==='sandbox-webhook'?/^whsec_[A-Za-z0-9]{16,512}$/:null;
const powershell=()=>path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
function outsideRepository(file){for(let directory=path.dirname(file);;){if(fs.existsSync(path.join(directory,'.git')))throw Error(FAILURE);const parent=path.dirname(directory);if(parent===directory)return;directory=parent;}}
function readProtected(file,{expectedAccount,kind,platform=process.platform,execute=cp.execFileSync}={}){
 try{
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||!/^acct_[A-Za-z0-9]+$/.test(expectedAccount||''))throw Error();
  outsideRepository(file);const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>16384)throw Error();outsideRepository(fs.realpathSync(file));let value;
  if(platform==='win32'){
   const envelope=JSON.parse(fs.readFileSync(file,'utf8'));
   if(envelope.version!==1||envelope.protection!=='windows-dpapi-current-user'||envelope.mode!=='sandbox'||envelope.kind!==kind||envelope.account!==expectedAccount||typeof envelope.ciphertext!=='string'||!/^[A-Za-z0-9+/=]{32,15000}$/.test(envelope.ciphertext))throw Error();
   const executable=powershell();
   value=execute(executable,['-NoProfile','-NonInteractive','-Command',DECRYPT_COMMAND],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','pipe'],env:{...process.env,REDX_BRIDGE_ENCRYPTED_SECRET:envelope.ciphertext}});
  }else{
   if((stat.mode&0o077)!==0||(typeof process.getuid==='function'&&stat.uid!==process.getuid()))throw Error();value=fs.readFileSync(file,'utf8');
  }
  if(typeof value!=='string')throw Error();value=value.trim();const valid=keyPattern(kind);
  if(!valid||!valid.test(value))throw Error();return value;
 }catch{throw Error(FAILURE);}
}
const readSandboxKey=(file,options)=>readProtected(file,{...options,kind:'sandbox-api'});
const readWebhookSecret=(file,options)=>readProtected(file,{...options,kind:'sandbox-webhook'});
function writeSandboxSecret(file,secret,{expectedAccount,kind,platform=process.platform,execute=cp.execFileSync}={}){
 let descriptor,created=false;
 try{
  if(typeof file!=='string'||!path.isAbsolute(file)||file.includes('\0')||!/^acct_[A-Za-z0-9]+$/.test(expectedAccount||'')||typeof secret!=='string'||!keyPattern(kind)?.test(secret))throw Error();
  outsideRepository(file);
  for(let directory=path.dirname(file);;){if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error();const parent=path.dirname(directory);if(parent===directory)break;directory=parent;}
  fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});outsideRepository(fs.realpathSync(path.dirname(file)));
  let content=secret,sid;
  if(platform==='win32'){
   // Fixed OS encryption commands receive the value over a private stdin pipe.
   // No script file is loaded and execution policy is neither changed nor bypassed.
   const encrypted=execute(powershell(),['-NoProfile','-NonInteractive','-Command',PROTECT_COMMAND],{input:secret,encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:16384,stdio:['pipe','pipe','pipe']});
   const lines=String(encrypted).trim().split(/\r?\n/);sid=lines.shift();const ciphertext=lines.join('');if(!/^S-1-5-(?:\d+-)*\d+$/.test(sid||'')||!/^[A-Za-z0-9+/=]{32,15000}$/.test(ciphertext))throw Error();
   content=JSON.stringify({version:1,protection:'windows-dpapi-current-user',mode:'sandbox',kind,account:expectedAccount,ciphertext});
  }else{const parent=fs.statSync(path.dirname(file));if((parent.mode&0o077)!==0||(typeof process.getuid==='function'&&parent.uid!==process.getuid()))throw Error();}
  descriptor=fs.openSync(file,'wx',0o600);created=true;
  if(platform==='win32')execute(path.win32.join(process.env.SystemRoot||'C:\\Windows','System32','icacls.exe'),[file,'/inheritance:r','/grant:r','*'+sid+':(F)','*S-1-5-18:(F)'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4096,stdio:['ignore','pipe','pipe']});
  fs.writeFileSync(descriptor,content,'utf8');fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=undefined;
  return Object.freeze({saved:true,protection:platform==='win32'?'windows-dpapi-current-user':'private-unix-file'});
 }catch{
  if(descriptor!==undefined)try{fs.closeSync(descriptor);}catch{}
  if(created)try{fs.unlinkSync(file);}catch{}
  throw Error('Protected Sandbox credential could not be saved');
 }
}
module.exports={readSandboxKey,readWebhookSecret,writeSandboxSecret};
