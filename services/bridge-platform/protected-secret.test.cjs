'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readSandboxKey,readWebhookSecret,writeSandboxSecret}=require('./protected-secret.cjs');
const account='acct_fixtureSandbox',key=['rk','test','FixtureOnlyNoProviderCredential123456'].join('_'),webhook=['whsec','FixtureOnlyNotARealSigningSecret123456'].join('_');
const nativeAclSkip=process.platform!=='win32'?'Windows only':/[\\/]Packages[\\/]sandbox\.[^\\/]+[\\/]AC[\\/]Temp/i.test(os.tmpdir())?'Private owner ACL requires a normal user token; this AppContainer is intentionally excluded':false;
function fixture(fn){const directory=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'bridge-private-secret-'));try{return fn(directory);}finally{fs.rmSync(directory,{recursive:true,force:true});}}
function envelope(kind='sandbox-api',changes={}){return{version:1,protection:'windows-dpapi-current-user',mode:'sandbox',kind,account,ciphertext:'A'.repeat(96),...changes};}
test('DPAPI reader uses static arguments and privately captures decrypted output',()=>fixture(directory=>{
 const file=path.join(directory,'sandbox.dpapi');fs.writeFileSync(file,JSON.stringify(envelope()));
 assert.equal(readSandboxKey(file,{expectedAccount:account,platform:'win32',execute:(command,args,options)=>{assert.equal(path.win32.basename(command),'powershell.exe');assert.ok(!args.some(arg=>arg.includes('A'.repeat(96))||arg.includes(key)));assert.equal(options.env.REDX_BRIDGE_ENCRYPTED_SECRET,'A'.repeat(96));assert.deepEqual(options.stdio,['ignore','pipe','pipe']);assert.equal(options.windowsHide,true);return key;}}),key);
}));
test('wrong account, kind, mode and raw Windows files fail before decryption',()=>fixture(directory=>{
 const file=path.join(directory,'sandbox.dpapi');let attempts=0;
 for(const content of [key,JSON.stringify(envelope('sandbox-api',{account:'acct_other'})),JSON.stringify(envelope('sandbox-api',{mode:'live'})),JSON.stringify(envelope('sandbox-webhook')),JSON.stringify(envelope('sandbox-api',{protection:'plaintext'}))]){
  fs.writeFileSync(file,content);assert.throws(()=>readSandboxKey(file,{expectedAccount:account,platform:'win32',execute:()=>{attempts++;return key;}}),/^Error: Protected Sandbox credential could not be opened$/);
 }assert.equal(attempts,0);
}));
test('decryption and validation failures discard private errors and reject live keys',()=>fixture(directory=>{
 const file=path.join(directory,'sandbox.dpapi');fs.writeFileSync(file,JSON.stringify(envelope()));
 for(const execute of [()=>{throw Error('stderr includes '+key);},()=>key.replace('_test_','_live_'),()=>key+'\nadditional secret',()=>['sk','test','NotARestrictedKey123456'].join('_')]){
  try{readSandboxKey(file,{expectedAccount:account,platform:'win32',execute});assert.fail('Expected refusal');}catch(error){assert.equal(error.message,'Protected Sandbox credential could not be opened');assert.equal(error.cause,undefined);assert.equal(String(error).includes(key),false);}
 }
}));
test('webhook and API key envelopes cannot be confused',()=>fixture(directory=>{
 const file=path.join(directory,'webhook.dpapi');fs.writeFileSync(file,JSON.stringify(envelope('sandbox-webhook')));
 assert.equal(readWebhookSecret(file,{expectedAccount:account,platform:'win32',execute:()=>webhook}),webhook);
 assert.throws(()=>readWebhookSecret(file,{expectedAccount:account,platform:'win32',execute:()=>key}));
}));
test('credentials inside a Git repository are refused',()=>fixture(directory=>{
 fs.mkdirSync(path.join(directory,'.git'));const file=path.join(directory,'secret.dpapi');fs.writeFileSync(file,JSON.stringify(envelope()));
 assert.throws(()=>readSandboxKey(file,{expectedAccount:account,platform:'win32',execute:()=>key}));
}));
test('protected writer sends plaintext only over stdin and applies a private file ACL',()=>fixture(directory=>{
 const file=path.join(directory,'writer.dpapi'),calls=[];
 const execute=(command,args,options)=>{assert.equal(args.some(arg=>arg.includes(key)),false);calls.push({command,args,options});if(path.win32.basename(command)==='powershell.exe'){assert.equal(options.input,key);return'S-1-5-21-123-456-789-1001\n'+'A'.repeat(96);}assert.equal(path.win32.basename(command),'icacls.exe');assert.ok(args.includes('/inheritance:r'));return'';};
 assert.equal(writeSandboxSecret(file,key,{kind:'sandbox-api',expectedAccount:account,platform:'win32',execute}).saved,true);
 assert.equal(calls.length,2);assert.equal(fs.readFileSync(file,'utf8').includes(key),false);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).account,account);
 const before=fs.readFileSync(file,'utf8');assert.throws(()=>writeSandboxSecret(file,key,{kind:'sandbox-api',expectedAccount:account,platform:'win32',execute}));assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('failed ACL setup removes only its new incomplete file and never propagates secret errors',()=>fixture(directory=>{
 const file=path.join(directory,'failed.dpapi'),execute=(command)=>{if(path.win32.basename(command)==='powershell.exe')return'S-1-5-21-123-456-789-1001\n'+'A'.repeat(96);throw Error('private error '+key);};
 assert.throws(()=>writeSandboxSecret(file,key,{kind:'sandbox-api',expectedAccount:account,platform:'win32',execute}),/^Error: Protected Sandbox credential could not be saved$/);assert.equal(fs.existsSync(file),false);
 assert.throws(()=>writeSandboxSecret(file,key.replace('_test_','_live_'),{kind:'sandbox-api',expectedAccount:account,platform:'win32',execute}));assert.equal(fs.existsSync(file),false);
}));
test('native Windows writer stores only DPAPI ciphertext with a restricted ACL',{skip:nativeAclSkip},()=>fixture(directory=>{
 const file=path.join(directory,'native.dpapi');writeSandboxSecret(file,key,{kind:'sandbox-api',expectedAccount:account});assert.equal(readSandboxKey(file,{expectedAccount:account}),key);assert.equal(fs.readFileSync(file,'utf8').includes(key),false);
 const cp=require('node:child_process'),result=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $acl=Get-Acl -LiteralPath $env:REDX_INTAKE_TEST_FILE; [Console]::Out.Write($acl.AreAccessRulesProtected)"],{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,REDX_INTAKE_TEST_FILE:file}});assert.equal(result,'True');
}));
test('Windows DPAPI round trip returns only the current-user protected fixture value',{skip:process.platform!=='win32'},()=>fixture(directory=>{
 const cp=require('node:child_process'),file=path.join(directory,'roundtrip.dpapi');
 const ciphertext=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $s=ConvertTo-SecureString $env:REDX_DUMMY_FIXTURE -AsPlainText -Force; try { ConvertFrom-SecureString $s } finally { $s.Dispose() }"],{encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe'],env:{...process.env,REDX_DUMMY_FIXTURE:key}}).trim();
 fs.writeFileSync(file,JSON.stringify(envelope('sandbox-api',{ciphertext})));
 assert.equal(readSandboxKey(file,{expectedAccount:account}),key);
}));
test('Windows private intake respects execution policy and otherwise protects new files',{skip:process.platform!=='win32'},t=>fixture(directory=>{
 const cp=require('node:child_process'),file=path.join(directory,'intake.dpapi'),script=path.resolve(__dirname,'../../scripts/save-bridge-sandbox-secret.ps1');
 const command="$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; function Read-Host { param($Prompt,[switch]$AsSecureString) ConvertTo-SecureString $env:REDX_DUMMY_FIXTURE -AsPlainText -Force }; & $env:REDX_INTAKE_TEST_SCRIPT -Kind sandbox-api -Path $env:REDX_INTAKE_TEST_FILE -Account acct_fixtureSandbox";
 const options={encoding:'utf8',windowsHide:true,timeout:10000,stdio:['ignore','pipe','pipe'],env:{...process.env,REDX_DUMMY_FIXTURE:key,REDX_INTAKE_TEST_SCRIPT:script,REDX_INTAKE_TEST_FILE:file}};
 const policy=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; Get-ExecutionPolicy"],options).trim();
 if(['Restricted','AllSigned'].includes(policy)){
  assert.throws(()=>cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],options),error=>/running scripts is disabled|not digitally signed/i.test(String(error.stderr)));
  assert.equal(fs.existsSync(file),false);t.diagnostic('OS policy refuses unsigned intake. Protected server provisioning or approved signed delivery is required; policy was not changed.');return;
 }
 const output=cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],options);
 assert.equal(output.includes(key),false);assert.equal(fs.readFileSync(file,'utf8').includes(key),false);assert.equal(readSandboxKey(file,{expectedAccount:account}),key);
 const acl=JSON.parse(cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1') -ErrorAction Stop; $acl=Get-Acl -LiteralPath $env:REDX_INTAKE_TEST_FILE; @{protected=$acl.AreAccessRulesProtected; owner=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; rules=@($acl.Access | ForEach-Object { @{sid=$_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value; rights=[int]$_.FileSystemRights; inherited=$_.IsInherited; type=[string]$_.AccessControlType} })} | ConvertTo-Json -Compress -Depth 4"],options));
 assert.equal(acl.protected,true);assert.equal(acl.rules.length,2);assert.deepEqual(acl.rules.map(rule=>rule.sid).sort(),[acl.owner,'S-1-5-18'].sort());for(const rule of acl.rules){assert.equal(rule.rights,2032127);assert.equal(rule.inherited,false);assert.equal(rule.type,'Allow');}
 const before=fs.readFileSync(file,'utf8');assert.throws(()=>cp.execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],options));assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('Unix files must be private, owned by the reader and restricted Sandbox keys',{skip:process.platform==='win32'},()=>fixture(directory=>{
 const file=path.join(directory,'sandbox.key');fs.writeFileSync(file,key,{mode:0o600});assert.equal(readSandboxKey(file,{expectedAccount:account}),key);
 fs.chmodSync(file,0o640);assert.throws(()=>readSandboxKey(file,{expectedAccount:account}));fs.chmodSync(file,0o600);
 fs.writeFileSync(file,key.replace('_test_','_live_'));assert.throws(()=>readSandboxKey(file,{expectedAccount:account}));
}));
test('native Unix writer creates a private file and preserves an existing destination',{skip:process.platform==='win32'},()=>fixture(directory=>{
 const file=path.join(directory,'unix.key');assert.equal(writeSandboxSecret(file,key,{expectedAccount:account,kind:'sandbox-api'}).saved,true);assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(readSandboxKey(file,{expectedAccount:account}),key);
 assert.throws(()=>writeSandboxSecret(file,webhook,{expectedAccount:account,kind:'sandbox-webhook'}));assert.equal(readSandboxKey(file,{expectedAccount:account}),key);
}));
