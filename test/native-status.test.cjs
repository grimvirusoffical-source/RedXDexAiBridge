'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {permissionStatus:osPermissionStatus}=require('../app/native.cjs');
const permissionStatus=(helper,status)=>osPermissionStatus(helper,status,'darwin');
test('helper permission cannot falsely grant the signed app Screen Recording',()=>{
 const s=permissionStatus({accessibility:true,screenRecording:true},'denied');
 assert.equal(s.screenRecording,false);assert.equal(s.helperScreenRecording,true);
 assert.equal(s.screenRecordingStatus,'denied');assert.match(s.screenRecordingMessage,/quit and reopen/);
});
test('screen recording reflects the actual app status and retains helper diagnostics',()=>{
 for(const status of ['unknown','not-determined','restricted'])assert.equal(permissionStatus({screenRecording:true},status).screenRecording,false);
 const s=permissionStatus({accessibility:false,screenRecording:false},'granted');
 assert.equal(s.screenRecording,true);assert.equal(s.accessibility,false);assert.equal(s.helperScreenRecording,false);
});
