'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {stripeClientFromEnvironment}=require('./stripe.cjs');
let Stripe;try{Stripe=require('stripe');}catch(e){if(process.env.GITHUB_ACTIONS==='true')throw e;}
test('server uses the pinned real SDK API version and refuses live initialization without an explicit switch',{skip:!Stripe},()=>{
 const client=stripeClientFromEnvironment({STRIPE_RESTRICTED_KEY:'rk_test_fixture_not_a_real_key'});
 assert.equal(client.getApiField('version'),Stripe.API_VERSION);
 assert.equal(client.bridgeLivemode,false);assert.equal(client.getMaxNetworkRetries(),2);
 assert.throws(()=>stripeClientFromEnvironment({STRIPE_RESTRICTED_KEY:'rk_live_fixture_not_a_real_key'}),/not enabled/);
 const live=stripeClientFromEnvironment({STRIPE_RESTRICTED_KEY:'rk_live_fixture_not_a_real_key',BRIDGE_ENABLE_LIVE_PAYMENTS:'yes'});
 assert.equal(live.bridgeLivemode,true);assert.equal(live.getApiField('version'),Stripe.API_VERSION);
});
