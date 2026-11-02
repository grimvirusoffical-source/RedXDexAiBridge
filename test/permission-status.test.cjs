'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../app/core.cjs');
const {permissionMode}=require('../app/permission-policy.cjs');
test('crawl status agrees with enforcement when explicit Always allow overrides legacy false',async()=>{
 const before=core.settings();
 try{
  core.saveSettings({...before,emergencyStop:false,permissions:{...before.permissions,crawl:false},clientPolicies:{crawler:{crawl:'always'}}});
  const context={clientId:'crawler',transport:'http'};
  const status=JSON.parse((await core.perform('bridge_status',{},context)).text);
  assert.equal(status.permissions.crawl,true);
  assert.equal(status.permissionDefaults.crawl,false);
  assert.equal(status.clientPermissions.crawl,'always');
  assert.equal(status.effectivePermissions.crawl,'always');
  await core.ensurePermission('crawl',context);
  assert.deepEqual(JSON.parse((await core.perform('crawl_list',{},context)).text),[]);
  core.saveSettings({...core.settings(),clientPolicies:{crawler:{crawl:'deny'}}});
  assert.equal(JSON.parse((await core.perform('bridge_status',{},context)).text).permissions.crawl,false);
  await assert.rejects(core.ensurePermission('crawl',context),/Permission disabled/);
  core.saveSettings({...core.settings(),clientPolicies:{crawler:{crawl:'always'}},emergencyStop:true});
  assert.equal(JSON.parse((await core.perform('bridge_status',{},context)).text).permissions.crawl,false);
  await assert.rejects(core.ensurePermission('crawl',context),/Emergency stop/);
 }finally{core.saveSettings(before);}
});
test('missing remote policies require approval rather than inheriting Always allow',()=>{
 const s={permissions:{crawl:true},clientPolicies:{}};
 assert.equal(permissionMode(s,'crawl','new-client','http'),'ask');
 assert.equal(permissionMode(s,'crawl','local','http'),'ask');
 assert.equal(permissionMode(s,'crawl','local','stdio'),'always');
});
