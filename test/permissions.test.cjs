'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {settings,saveSettings,perform}=require('../app/core.cjs');
test('per-client deny/ask/always and emergency stop persist and enforce access', async()=>{
 const before=settings(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'redxdex-permission-')),file=path.join(dir,'file.txt');
 fs.writeFileSync(file,'approved'); const previous=process.env.REDXDEX_CLIENT_ID;
 try{
  process.env.REDXDEX_CLIENT_ID='testai';
  const base={...before,directories:[dir],emergencyStop:false,permissions:{...before.permissions,read:false},clientPolicies:{testai:{read:'deny'}}};
  saveSettings(base);
  await assert.rejects(perform('read_text_file',{path:file}),/disabled/);
  base.clientPolicies.testai.read='ask'; saveSettings(base);
  await assert.rejects(perform('read_text_file',{path:file}),/Approval required/);
  base.clientPolicies.testai.read='always'; saveSettings(base);
  assert.equal((await perform('read_text_file',{path:file})).text,'approved');
  saveSettings({...base,emergencyStop:true});
  await assert.rejects(perform('read_text_file',{path:file}),/Emergency stop/);
  assert.equal(settings().emergencyStop,true);
  assert.throws(()=>saveSettings({...base,clientPolicies:{testai:{read:'superuser'}}}),/Invalid client permission/);
 }finally{if(previous===undefined)delete process.env.REDXDEX_CLIENT_ID;else process.env.REDXDEX_CLIENT_ID=previous;saveSettings(before);fs.rmSync(dir,{recursive:true,force:true});}
});
