'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {startServer}=require('../app/http-mcp.cjs');
test('loopback gateway requires bearer token, rejects browser origin, supports MCP, revokes on stop',async()=>{
 const gateway=await startServer({token:'unit-test-secret'});
 try{
  const body=JSON.stringify({jsonrpc:'2.0',id:7,method:'initialize',params:{}});
  const call=(token,more={})=>fetch(gateway.url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{}),...more},body});
  assert.equal((await call()).status,401);
  assert.equal((await call('incorrect')).status,401);
  assert.equal((await call('unit-test-secret',{Origin:'https://evil.example'})).status,403);
  const response=await call('unit-test-secret');assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.id,7);assert.equal(result.result.serverInfo.version,require('../package.json').version);
  assert.equal((await fetch(gateway.url,{method:'GET',headers:{Authorization:'Bearer unit-test-secret'}})).status,405);
  assert.equal((await fetch(gateway.url,{method:'POST',headers:{Authorization:'Bearer unit-test-secret','Content-Type':'text/plain'},body})).status,415);
 }finally{await gateway.stop();}
 await assert.rejects(fetch(gateway.url,{method:'POST'}));
});
test('gateway refuses public binding',async()=>{assert.throws(()=>startServer({host:'0.0.0.0'}),/non-loopback/);});
