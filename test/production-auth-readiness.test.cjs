'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {checkProductionAuth,validConsentURL}=require('../scripts/check-production-auth.cjs');
const config={protocol:'redx-site-session-v1',issuer:'https://red-xai.com',supported_clients:['gendragoon','vortex','bridge']};
const consent={device_code:'a'.repeat(43),user_code:'AB12CD34',expires_in:300,protocol:'redx-site-session-v1',verification_uri:'https://red-xai.com/redxai-connectx#request='+'b'.repeat(43)};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});

test('production release readiness requires a real registered Bridge authorization',async()=>{
 const paths=[];
 const result=await checkProductionAuth({request:async(url,init)=>{
   paths.push({url,init});
   return json(url.endsWith('/config')?config:consent);
 }});
 assert.equal(result.ready,true);
 assert.deepEqual(paths.map(x=>new URL(x.url).pathname),['/redxai-connect/config','/redxai-connect/start']);
 const body=JSON.parse(paths[1].init.body);
 assert.equal(body.client_id,'bridge');assert.equal(body.code_challenge_method,'S256');
 assert.match(body.code_challenge,/^[A-Za-z0-9_-]{43}$/);
});
test('the current production missing Bridge client blocks publication',async()=>{
 let count=0;
 await assert.rejects(checkProductionAuth({request:async()=>{count++;return json({...config,supported_clients:['vortex','gendragoon']});}}),/Blocking desktop release/);
 assert.equal(count,1,'no authorization request when registration is absent');
});
test('production rejection and invalid consent cannot publish a login-gated app',async()=>{
 await assert.rejects(checkProductionAuth({request:async url=>url.endsWith('/config')?json(config):json({error:'invalid_client'},400)}),/rejected Bridge/);
 await assert.rejects(checkProductionAuth({request:async url=>url.endsWith('/config')?json(config):json({...consent,verification_uri:'https://attacker.invalid/#request='+'b'.repeat(43)})}),/invalid Bridge consent/);
});
test('browser consent link is pinned to Red-XAI HTTPS and the opaque request',()=>{
 assert.equal(validConsentURL(consent.verification_uri),true);
 assert.equal(validConsentURL('http://red-xai.com/redxai-connectx#request='+'b'.repeat(43)),false);
 assert.equal(validConsentURL('https://red-xai.com.example/redxai-connectx#request='+'b'.repeat(43)),false);
});
