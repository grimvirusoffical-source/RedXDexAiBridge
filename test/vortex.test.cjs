'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vortex=require('../app/vortex.cjs');
const key='redx_ai_123456789012';
test('Vortex model endpoint uses Bearer token and reports model IDs',async()=>{const got=await vortex.models(key,async(url,opts)=>{assert.equal(url,'https://ai.red-xai.com/v1/models');assert.equal(opts.headers.Authorization,'Bearer '+key);return {ok:true,json:async()=>({data:[{id:'vortex-pro'},{id:'vortex-mini'}]})};});assert.deepEqual(got,['vortex-pro','vortex-mini']);});
test('Vortex chat uses real Pro model by default',async()=>{const answer=await vortex.chat(key,[{role:'user',content:'hello'}],undefined,async(url,opts)=>{assert.equal(url,'https://ai.red-xai.com/v1/chat/completions');assert.equal(JSON.parse(opts.body).model,'vortex-pro');return {ok:true,json:async()=>({choices:[{message:{content:'hello there'}}]})};});assert.equal(answer,'hello there');});
test('403 does not silently fall back to a different model',async()=>{await assert.rejects(vortex.chat(key,[{role:'user',content:'hi'}],undefined,async()=>({ok:false,status:403,json:async()=>({})})),/not authorized/);});
test('invalid keys fail before network calls',async()=>{await assert.rejects(vortex.models('oops',()=>{throw Error('unexpected network access');}),/Vortex key/);});
