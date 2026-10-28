'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {linuxPlan, validateInput} = require('../app/platform.cjs');
const {permissionStatus} = require('../app/native.cjs');

test('desktop inputs reject injection and invalid coordinates before native execution', () => {
  for (const input of [{action:'key',key:'a;rm -rf ~'}, {action:'key',key:'a',modifiers:['evil']}, {action:'move',x:NaN,y:0}, {action:'drag',x:1,y:1,toX:Infinity,toY:2}, {action:'launch',name:'-Bad'}, {action:'scroll',dy:10001}]) assert.throws(() => validateInput(input));
});

test('Linux X11 input uses argument arrays and sends typed text only through stdin', () => {
  const env={DISPLAY:':99',XDG_SESSION_TYPE:'x11'};
  const text='hello $(touch /tmp/should-not-exist) — ✓';
  assert.deepEqual(linuxPlan({action:'type',text},env),{args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:text});
  assert.deepEqual(linuxPlan({action:'key',key:'a',modifiers:['control']},env).args,['key','--clearmodifiers','ctrl+a']);
  assert.ok(linuxPlan({action:'click',x:10,y:20,count:2},env).args.includes('2'));
  assert.throws(()=>linuxPlan({action:'move',x:1,y:2},{DISPLAY:':0',WAYLAND_DISPLAY:'wayland-0'}),/Wayland/);
  assert.throws(()=>linuxPlan({action:'key',key:'a'},{}),/X11 display/);
});

test('cross-platform permission messages never falsely claim an untested capture succeeded', () => {
  assert.equal(permissionStatus({accessibility:true},'granted','win32').screenRecording,null);
  assert.match(permissionStatus({},'unknown','linux').screenRecordingMessage,/Wayland/);
});
