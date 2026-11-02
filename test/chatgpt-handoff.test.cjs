'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {verifiedEndpoint,instructionsForChatGPT,newEndpoint}=require('../app/chatgpt-handoff.cjs');
const root=path.resolve(__dirname,'..');
const online={phase:'online',url:'https://owner-bridge.trycloudflare.com/mcp',mode:'temporary'};

test('only a verified HTTPS MCP endpoint can be copied for ChatGPT',()=>{
 assert.equal(verifiedEndpoint(online),online.url);
 for(const status of [
  null,{...online,phase:'connecting'},{...online,phase:'unreachable'},
  {...online,url:'http://owner-bridge.trycloudflare.com/mcp'},
  {...online,url:'https://owner-bridge.trycloudflare.com/other'},
  {...online,url:'https://owner-bridge.trycloudflare.com/mcp?token=secret'},
  {...online,url:'https://owner-bridge.trycloudflare.com/mcp#fragment'},
  {...online,url:'https://user:pass@owner-bridge.trycloudflare.com/mcp'},
  {...online,url:'https://localhost/mcp'},
 ]){
  assert.throws(()=>verifiedEndpoint(status),/verified|HTTPS|invalid/);
 }
});
test('copied message preserves existing plugin and OAuth without embedding secrets',()=>{
 const msg=instructionsForChatGPT(online);
 assert.match(msg,/Verified HTTPS MCP endpoint: https:\/\/owner-bridge.trycloudflare.com\/mcp/);
 assert.match(msg,/existing private Red-XAI Bridge plugin/);
 assert.match(msg,/Keep its plugin identity, OAuth authentication, permissions/);
 assert.match(msg,/Do not create a duplicate plugin/);
 assert.doesNotMatch(msg,/Bearer\s|client_secret|Authorization:\s|token=[^ ]+/);
 assert.equal(msg.includes('https://owner-bridge.trycloudflare.com/mcp'),true);
});
test('handoff reminder happens only when a verified remote URL changes',()=>{
 assert.equal(newEndpoint(null,online),true);
 assert.equal(newEndpoint(online.url,online),false);
 assert.equal(newEndpoint(online.url,{...online,url:'https://different.trycloudflare.com/mcp'}),true);
 assert.equal(newEndpoint(online.url,{...online,phase:'connecting'}),false);
});
test('renderer exposes a verified, user-initiated Copy for ChatGPT workflow',()=>{
 const html=fs.readFileSync(path.join(root,'app/index.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'app/ui.js'),'utf8');
 const preload=fs.readFileSync(path.join(root,'app/preload.cjs'),'utf8');
 const main=fs.readFileSync(path.join(root,'app/main.cjs'),'utf8');
 const quick=fs.readFileSync(path.join(root,'app/quick-setup-ui.js'),'utf8');
 for(const id of ['chatgpt-connection-banner','chatgpt-go-connections','remote-chatgpt-copy','chatgpt-handoff-status']){
  assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(ui,/remote\.phase!=='online'/);
 assert.match(ui,/api\.remoteChatGPTHandoff\(\)/);
 assert.match(preload,/remoteChatGPTHandoff:invoke\('remote:chatgpt-handoff'\)/);
 assert.match(main,/ipc\('remote:chatgpt-handoff'/);
 assert.match(main,/newEndpoint\(lastNotifiedHandoffUrl,s\)/);
 assert.match(quick,/api\.remoteChatGPTHandoff\(\)/);
});
