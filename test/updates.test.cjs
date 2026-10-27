'use strict';const test=require('node:test');const assert=require('node:assert/strict');const {newer,checkUpdates}=require('../app/updates.cjs');
test('compares versions by semantic numeric components',()=>{assert.equal(newer('0.10.0','0.9.1'),true);assert.equal(newer('0.2.0','0.3.0'),false);});
test('release not published is explained clearly',async()=>{const r=await checkUpdates('0.3.0',async()=>({status:404}));assert.match(r.message,/No GitHub release/);});
