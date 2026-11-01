'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const prefs=require('../app/remote-preferences.cjs');
function fixture(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-remote-pref-'));
 try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('remote access stays disabled on new installations',()=>fixture(root=>{
 assert.equal(prefs.enabled(root),false);
 fs.writeFileSync(path.join(root,'remote-status.json'),JSON.stringify({phase:'online',url:'https://remote.example/mcp'}));
 assert.equal(prefs.enabled(root),false);
}));
test('legacy saved owner tunnel is restored only when it was previously active',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'openai-tunnel-id.txt'),'legacy-identity');
 assert.equal(prefs.enabled(root),false);
 fs.writeFileSync(path.join(root,'remote-status.json'),JSON.stringify({phase:'off',url:null}));
 assert.equal(prefs.enabled(root),false);
 fs.writeFileSync(path.join(root,'remote-status.json'),JSON.stringify({phase:'online',url:'https://existing.example/mcp'}));
 assert.equal(prefs.enabled(root),true);
}));
test('explicit remote stop overrides legacy identity and survives restart',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'openai-tunnel-id.txt'),'legacy-identity');
 fs.writeFileSync(path.join(root,'remote-status.json'),JSON.stringify({phase:'online',url:'https://existing.example/mcp'}));
 prefs.remember(root,false);
 assert.equal(prefs.enabled(root),false);
 prefs.remember(root,true);
 assert.equal(prefs.enabled(root),true);
 assert.throws(()=>prefs.remember(root,'true'),/boolean/);
}));
test('malformed preference never enables a remote tunnel',()=>fixture(root=>{
 fs.writeFileSync(path.join(root,'openai-tunnel-id.txt'),'legacy-identity');
 fs.writeFileSync(path.join(root,'remote-status.json'),JSON.stringify({phase:'online',url:'https://existing.example/mcp'}));
 fs.writeFileSync(path.join(root,'remote-preferences.json'),'not json');
 assert.equal(prefs.enabled(root),false);
}));
