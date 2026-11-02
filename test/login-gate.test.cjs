'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startServer}=require('../app/http-mcp.cjs');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
test('Red-XAI login gate is present on the first screen with Quick Login and manual 2FA',()=>{
 const html=read('app/sign-in.html'),js=read('app/sign-in.js');
 for(const id of ['quick-start','manual-form','twofactor-form','username','password','twofactor-code','get-cli'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(js,/accountQuickPoll/);
 assert.match(js,/accountManualLogin/);
 assert.match(js,/accountManual2fa/);
});
test('main IPC must deny unauthenticated privileged control and not start MCP without login',()=>{
 const main=read('app/main.cjs');
 assert.match(main,/if\(page===LOGIN_UI&&!PUBLIC_IPC\.has\(name\)\)throw/);
 assert.match(main,/if\(!CI_SMOKE&&!PUBLIC_IPC\.has\(name\)\)await accountAuth\.ensure\(\)/);
 assert.match(main,/if\(!CI_SMOKE&&!accountAuth\.isSignedIn\(\)\)throw Error\('Sign in to Red-XAI before starting MCP'\)/);
 assert.match(main,/if\(CI_SMOKE\|\|accountAuth\.isSignedIn\(\)\)await startGateway\(\)/);
 assert.match(main,/accountAuth\.session=null/);
 assert.match(main,/account:logout/);
 assert.match(main,/AUTH_SMOKE=!app\.isPackaged/);
});
test('HTTP MCP denies even authenticated-looking calls when account is locked',async()=>{
 const srv=await startServer({token:'a'.repeat(43),isOperational:()=>false});
 try{
  const res=await fetch(srv.url,{method:'POST',headers:{
   authorization:'Bearer '+('a'.repeat(43)),accept:'application/json','content-type':'application/json'},
   body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
  assert.equal(res.status,423);
  assert.match((await res.json()).error,/sign-in required/);
 }finally{await srv.stop();}
});
test('packaging includes the login page, scripts and styles',()=>{
 const pkg=JSON.parse(read('package.json'));
 assert.ok(pkg.build.files.includes('app/**/*'));
 assert.match(read('app/preload.cjs'),/accountQuickStart/);
 assert.match(read('app/index.html'),/id="account-signout"/);
 assert.match(read('app/index.html'),/id="cli-download"/);
});
