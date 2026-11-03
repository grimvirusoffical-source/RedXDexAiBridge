'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {authorityConfirmed,subscriptionCancellationConfirmed}=require('./authority-confirmation.cjs');
const expected={sub:'canonical-target',action:'ban',scope:'global',requestId:'server_request_001',untilMs:0,effects:{banned:true}};
const receipt=extra=>({verified:true,completed:true,sub:expected.sub,action:expected.action,scope:expected.scope,requestId:expected.requestId,untilMs:expected.untilMs,banned:true,...extra});
test('completion acknowledges the exact canonical affected target and platform-issued action',()=>{
 assert.equal(authorityConfirmed(receipt(),expected),true);
 for(const [field,value]of Object.entries({sub:'canonical-caller',action:'unban',scope:'bridge',requestId:'server_request_older',untilMs:1,banned:false}))assert.equal(authorityConfirmed(receipt({[field]:value}),expected),false,field);
 for(const field of ['verified','completed','sub','action','scope','requestId','untilMs','banned']){const value=receipt();delete value[field];assert.equal(authorityConfirmed(value,expected),false,field);}
});
test('false, undefined, mismatched and merely resolved adapter results are not success',()=>{
 for(const value of [undefined,null,false,true,{},[],{ok:true},{verified:true},{verified:true,completed:false},receipt({verified:false}),receipt({completed:1}),receipt({ok:false}),receipt({success:false}),receipt({success:undefined})])assert.equal(authorityConfirmed(value,expected),false);
 assert.equal(authorityConfirmed(receipt({ok:true,success:true}),expected),true);
});
test('permanent and scheduled expiries are exact and are never normalized by the guard',()=>{
 for(const untilMs of [null,0,Date.UTC(2028,2,4,12)]){const bound={...expected,untilMs};assert.equal(authorityConfirmed(receipt({untilMs}),bound),true);assert.equal(authorityConfirmed(receipt({untilMs:untilMs===null?0:null}),bound),false);}
 for(const untilMs of [undefined,-1,Infinity,1.25,'0'])assert.equal(authorityConfirmed(receipt({untilMs}),{...expected,untilMs}),false);
});
test('global self-deletion and one-device Bridge reset require their requested effect acknowledgements',()=>{
 const deletion={sub:'canonical-self',action:'delete',scope:'global',requestId:'server_delete_001',effects:{accountDeleted:true,sessionsRevoked:true}};
 const deleted={verified:true,completed:true,sub:deletion.sub,action:deletion.action,scope:deletion.scope,requestId:deletion.requestId,accountDeleted:true,sessionsRevoked:true};
 assert.equal(authorityConfirmed(deleted,deletion),true);assert.equal(authorityConfirmed({...deleted,accountDeleted:false},deletion),false);assert.equal(authorityConfirmed({...deleted,sessionsRevoked:false},deletion),false);
 const reset={sub:'canonical-self',action:'revoke',scope:'bridge',requestId:'server_reset_001',deviceId:'device_fixture',allDevices:false,clientId:'bridge',appNumber:6,effects:{sessionsRevoked:true}};
 const resetReceipt={verified:true,completed:true,sub:reset.sub,action:reset.action,scope:reset.scope,requestId:reset.requestId,deviceId:reset.deviceId,allDevices:false,clientId:'bridge',appNumber:6,sessionsRevoked:true};
 assert.equal(authorityConfirmed(resetReceipt,reset),true);
 for(const [field,value]of Object.entries({deviceId:'different_device',allDevices:true,clientId:'vortex',appNumber:1,sessionsRevoked:false}))assert.equal(authorityConfirmed({...resetReceipt,[field]:value},reset),false,field);
});
test('malformed expected operations and inherited/getter claims fail without invoking getters',()=>{
 for(const change of [{sub:''},{sub:'bad subject'},{sub:'constructor'},{action:'terminate'},{scope:'other'},{requestId:undefined},{requestId:'bad id'},{allDevices:'false'},{clientId:'vortex'},{appNumber:7},{issuer:'https://other.invalid'},{effects:{}},{effects:{banned:1}},{effects:{verified:true}},{unexpectedField:'ignored-binding'}])assert.equal(authorityConfirmed(receipt(change),{...expected,...change}),false);
 assert.equal(authorityConfirmed(Object.create(receipt()),expected),false);
 let reads=0;const value=receipt();Object.defineProperty(value,'completed',{get(){reads++;throw Error('must not invoke');}});assert.equal(authorityConfirmed(value,expected),false);assert.equal(reads,0);
 const malformed={...expected};Object.defineProperty(malformed,'effects',{get(){reads++;return{banned:true};}});assert.equal(authorityConfirmed(receipt(),malformed),false);assert.equal(reads,0);
 assert.equal(authorityConfirmed(receipt(),new Proxy({},{ownKeys(){throw Error('fixture');}})),false);
});
test('legacy Bridge membership deletion shape is not silently promoted into a newer completion receipt',()=>{
 const legacy={verified:true,sub:'canonical-self',scope:'bridge',clientId:'bridge',appNumber:6,membershipRemoved:true,sessionsRevoked:true};
 assert.equal(authorityConfirmed(legacy,{sub:legacy.sub,action:'delete',scope:'bridge',requestId:'server_delete_001',clientId:'bridge',appNumber:6,effects:{membershipRemoved:true,sessionsRevoked:true,globalAccountDeleted:false}}),false);
});
const cancellationExpected={sub:'canonical-target',subscriptionId:'sub_fixture_001',requestId:'server_cancel_001'};
const cancellation=extra=>({verified:true,completed:true,ok:true,scope:'bridge',action:'cancel-subscription',sub:cancellationExpected.sub,subscriptionId:cancellationExpected.subscriptionId,requestId:cancellationExpected.requestId,status:'canceled',...extra});
test('provider cancellation acknowledgement binds exact canonical target, provider ID and platform request ID',()=>{
 assert.equal(subscriptionCancellationConfirmed(cancellation(),cancellationExpected),true);
 const deletionRequest='delete:'+'a'.repeat(64);assert.equal(subscriptionCancellationConfirmed(cancellation({requestId:deletionRequest}),{...cancellationExpected,requestId:deletionRequest}),true);
 for(const [field,value]of Object.entries({sub:'canonical-caller',subscriptionId:'sub_different',requestId:'server_cancel_older',scope:'global',action:'cancel',status:'active',verified:false,completed:false,ok:false}))assert.equal(subscriptionCancellationConfirmed(cancellation({[field]:value}),cancellationExpected),false,field);
});
test('undefined, missing, merely resolved and period-end cancellation results are not completion',()=>{
 for(const value of [undefined,null,false,true,{},[],{ok:true},{status:'canceled'},cancellation({status:'cancel_at_period_end'}),cancellation({ok:1}),cancellation({completed:'true'})])assert.equal(subscriptionCancellationConfirmed(value,cancellationExpected),false);
 for(const field of Object.keys(cancellation())){const value=cancellation();delete value[field];assert.equal(subscriptionCancellationConfirmed(value,cancellationExpected),false,field);}
});
test('cancellation receipts reject inherited/accessor or conflicting extra claims without invoking getters',()=>{
 assert.equal(subscriptionCancellationConfirmed(Object.create(cancellation()),cancellationExpected),false);assert.equal(subscriptionCancellationConfirmed(cancellation({success:false}),cancellationExpected),false);assert.equal(subscriptionCancellationConfirmed(cancellation({canceled:false}),cancellationExpected),false);
 let reads=0;const value=cancellation();Object.defineProperty(value,'status',{get(){reads++;throw Error('must not run');}});assert.equal(subscriptionCancellationConfirmed(value,cancellationExpected),false);assert.equal(reads,0);
 const malformed={...cancellationExpected};Object.defineProperty(malformed,'requestId',{get(){reads++;return cancellationExpected.requestId;}});assert.equal(subscriptionCancellationConfirmed(cancellation(),malformed),false);assert.equal(reads,0);
});
test('malformed or unbound cancellation expectations cannot validate a receipt',()=>{
 for(const update of [{sub:''},{sub:'bad subject'},{subscriptionId:'not_a_provider_id'},{subscriptionId:undefined},{requestId:'delete:not_a_digest'},{requestId:undefined},{status:'canceled'}])assert.equal(subscriptionCancellationConfirmed(cancellation(update),{...cancellationExpected,...update}),false);
 assert.equal(subscriptionCancellationConfirmed(cancellation(),null),false);
});
