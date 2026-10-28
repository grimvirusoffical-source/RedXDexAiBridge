'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {startServer}=require('../app/http-mcp.cjs');
const {definitions}=require('../app/core.cjs');
const {dispatch}=require('../app/protocol.cjs');

test('public OAuth discovery cannot execute any computer or profile tool', async()=>{
 const oauth={origin:'https://bridge.example',verify:()=>null};
 const gateway=await startServer({oauth,token:'test-authenticated-only'});
 const call=async(method,params,token)=>fetch(gateway.url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
 try{
  const initialized=await call('initialize',{});assert.equal(initialized.status,200);
  const list=await call('tools/list',{});assert.equal(list.status,200);
  const tools=(await list.json()).result.tools;assert.ok(tools.length>=21);
  for(const tool of tools){
   assert.deepEqual(tool.securitySchemes,[{type:'oauth2',scopes:['bridge:tools']}]);
   const result=await call('tools/call',{name:tool.name,arguments:{}});
   assert.equal(result.status,401,tool.name+' must require authentication');
   assert.match(result.headers.get('www-authenticate'),/resource_metadata/);
   const error=await result.json();assert.equal(error.result.isError,true);
   assert.ok(error.result._meta['mcp/www_authenticate'][0].includes('bridge:tools'));
  }
  assert.equal((await call('tools/list',{},'revoked-token')).status,401);
  const allowed=await call('tools/call',{name:'bridge_status',arguments:{}},'test-authenticated-only');
  assert.equal(allowed.status,200);assert.ok(!(await allowed.json()).result.isError);
 }finally{await gateway.stop();}
});

test('profile is authenticated-only, stable and machine-readable without secrets',async()=>{
 const tool=definitions.find(t=>t.name==='get_profile');
 assert.equal(tool._meta['openai/profile'],true);assert.equal(tool.annotations.readOnlyHint,true);
 const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_profile',arguments:{}}};
 const a=await dispatch(request,{clientId:'verified-test'}),b=await dispatch(request,{clientId:'other-verified-test'});
 assert.ok(a.result.structuredContent.id);assert.equal(a.result.structuredContent.id,b.result.structuredContent.id);
 assert.deepEqual(Object.keys(a.result.structuredContent).sort(),['id','name','nickname']);
 assert.deepEqual(JSON.parse(a.result.content[0].text),a.result.structuredContent);
});
