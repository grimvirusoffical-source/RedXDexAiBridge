'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {migrate,numericUsageID,apiURL,APP_ID,APP_PATH,SCHEMA_PATH}=require('../scripts/provision-app-six.cjs');
const opts={base:'https://redx.internal.example',key:'rx_live_scoped_example_test_key'};
test('app six registry and usage keys are numeric, stable and preserve first five IDs',()=>{
 assert.equal(APP_ID,6);assert.match(APP_PATH,/\[ID=6\]$/);assert.match(SCHEMA_PATH,/\[ID=6\]$/);
 const a=numericUsageID('rxa_abc');assert.equal(a,numericUsageID('rxa_abc'));
 assert.notEqual(a,numericUsageID('rxa_def'));
 assert.ok(Number.isSafeInteger(a));assert.ok(a>=0);
 assert.throws(()=>numericUsageID(''));
});
test('migration is a dry run by default and never writes without explicit apply',async()=>{
 const calls=[];const result=await migrate({...opts,request:async(url,options)=>{
  calls.push({url,method:options.method});return new Response('',{status:404});
 }});
 assert.equal(result.dryRun,true);assert.equal(result.results.length,2);
 assert.deepEqual(calls.map(x=>x.method),['GET','GET']);
 assert.ok(calls.every(x=>x.url.includes('/v1/db/redxai_accounts/path/')));
});
test('apply initializes only app six metadata and usage schema, never modifies existing records',async()=>{
 const calls=[];const result=await migrate({...opts,apply:true,request:async(url,options)=>{
  calls.push({url,method:options.method,body:options.body});
  if(options.method==='GET')return new Response('',{status:404});
  return new Response('{}',{status:200});
 }});
 assert.equal(result.dryRun,false);
 assert.equal(calls.filter(x=>x.method==='PUT').length,2);
 const created=calls.filter(x=>x.body).map(x=>JSON.parse(x.body).value);
 assert.ok(created.every(x=>x.appId===6));
 assert.equal(created[0].clientId,'bridge');
 assert.equal(created[1].kind,'UserApp');
});
test('migrator fails closed for preexisting rows, absent credentials and unsafe endpoints',async()=>{
 const result=await migrate({...opts,apply:true,request:async()=>new Response('{}',{status:200})});
 assert.ok(result.results.every(x=>x.status.includes('not modified')));
 await assert.rejects(migrate({...opts,key:'',request:async()=>new Response('',{status:404})}),/scoped RedX key/);
 assert.throws(()=>apiURL('http://evil.example',APP_PATH),/trusted HTTPS/);
 assert.throws(()=>apiURL('https://user:pass@evil.example',APP_PATH),/trusted HTTPS/);
});
