'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const updates=require('../app/public-updates.cjs');
const optional=require('../app/optional-tools.cjs');
const github=require('../app/github-cli.cjs');
const root=path.join(__dirname,'..');

test('public GitHub update feed never requires GitHub CLI or credentials',()=>{
 let captured;
 const actual=updates.configure({setFeedURL:feed=>captured=feed});
 assert.deepEqual(actual,captured);
 assert.deepEqual(captured,{provider:'github',owner:'grimvirusoffical-source',repo:'RedXDexAiBridge',private:false});
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(pkg.build.publish[0].private,false);
 const main=fs.readFileSync(path.join(root,'app','main.cjs'),'utf8');
 assert.doesNotMatch(main,/Private updates need GitHub access/);
 assert.doesNotMatch(main,/auth','token'/);
});
test('Node Git and GitHub CLI are optional and have distinct explanations',()=>{
 const states=optional.status({platform:'linux',env:{PATH:'/nonexistent'},lookup:()=>null});
 assert.deepEqual(Object.keys(states),['node','git','gh']);
 for(const [key,info] of Object.entries(states)){
  assert.equal(info.installed,false);
  assert.ok(info.reason.includes('Optional'));
  assert.ok(optional.IDS[key].winget);
 }
 const winRoot='C:\\FakePrograms';
 const found=optional.installed('gh',{platform:'win32',env:{PATH:'',ProgramFiles:winRoot,SystemRoot:'C:\\FakeWindows',LOCALAPPDATA:'C:\\FakeLocal'},exists:file=>file==='C:\\FakePrograms\\GitHub CLI\\gh.exe',lookup:()=>null});
 assert.equal(found,'C:\\FakePrograms\\GitHub CLI\\gh.exe');
});
test('GitHub CLI connection reports missing, unauthed and logged-in states separately',async()=>{
 const missing=await github.status({platform:'win32',find:()=>null});
 assert.deepEqual([missing.installed,missing.authenticated],[false,false]);
 const bin='C:\\Program Files\\GitHub CLI\\gh.exe',find=()=>bin;
 const loggedIn=await github.status({platform:'win32',find,run:async()=>({})});
 assert.equal(loggedIn.authenticated,true);
 const unauthed=await github.status({platform:'win32',find,run:async()=>{throw Error('not authenticated');}});
 assert.equal(unauthed.installed,true);assert.equal(unauthed.authenticated,false);
});
test('GitHub login opens an interactive Windows terminal without token extraction',async()=>{
 const bin='C:\\Program Files\\GitHub CLI\\gh.exe';
 const calls=[];
 const result=await github.beginLogin({platform:'win32',find:()=>bin,run:async()=>{throw Error('not logged in');},spawn:(file,args,opts)=>{
  calls.push({file,args,opts});return {unref(){}};
 }});
 assert.equal(result.started,true);assert.equal(calls.length,1);
 assert.equal(calls[0].args.includes('-EncodedCommand'),true);
 const code=calls[0].args[calls[0].args.indexOf('-EncodedCommand')+1];
 const decoded=Buffer.from(code,'base64').toString('utf16le');
 assert.match(decoded,/auth login --hostname github.com --git-protocol https --web/);
 assert.doesNotMatch(decoded,/auth token|client_secret/);
});
test('Windows installer prompts are optional and silent updates skip them',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
 assert.equal(pkg.build.nsis.include,'build/installer.nsh');
 assert.equal(pkg.build.nsis.oneClick,true);
 const code=fs.readFileSync(path.join(root,'build','installer.nsh'),'utf8');
 assert.match(code,/!macro customInstall/);
 assert.match(code,/IfSilent optional_done/);
 assert.match(code,/\$\{IfNot\} \$\{isUpdated\}/);
 for(const label of ['Node.js','Git?','GitHub CLI?'])assert.ok(code.includes('Install optional '+label));
 assert.match(code,/choose No to skip/i);
 const script=fs.readFileSync(path.join(root,'build','optional-tools.ps1'),'utf8');
 for(const pkg of ['OpenJS.NodeJS.LTS','Git.Git','GitHub.cli'])assert.ok(script.includes(pkg));
 assert.match(script,/--accept-package-agreements/);
});
