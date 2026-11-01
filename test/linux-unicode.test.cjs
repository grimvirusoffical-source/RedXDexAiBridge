'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{linuxTypeSteps}=require('../app/platform.cjs');
test('X11 Unicode input is segmented into safe xdotool args and never uses a clipboard or shell',()=>{
 const text='BRIDGE_NATIVE_TEST ✓ — 👾 done';
 const steps=linuxTypeSteps(text);
 assert.deepEqual(steps,[
  {args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:'BRIDGE_NATIVE_TEST '},
  {args:['key','--clearmodifiers','U2713']},
  {args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:' '},
  {args:['key','--clearmodifiers','U2014']},
  {args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:' '},
  {args:['key','--clearmodifiers','U1F47E']},
  {args:['type','--clearmodifiers','--delay','1','--file','-'],stdin:' done'}
 ]);
 assert.equal(steps.some(s=>s.args.some(a=>/xclip|xsel|shell|bash/.test(a))),false);
});
test('ASCII remains in one batch and invalid strings are rejected',()=>{
 const t='hello $() ☺';
 const a=linuxTypeSteps('simple ASCII');
 assert.equal(a.length,1);
 assert.equal(a[0].stdin,'simple ASCII');
 for(const bad of [null,123,'a'.repeat(8001)])assert.throws(()=>linuxTypeSteps(bad));
});
