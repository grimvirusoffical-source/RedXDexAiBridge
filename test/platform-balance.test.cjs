'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {creditBalance,canPayAX,creditNotices}=require('../app/platform-ui.js');

test('AX eligibility uses the server available balance and never falls back to gross funds',()=>{
 const held={creditsCents:1234,availableCreditsCents:100,creditsHeldCents:1134,creditsDebtCents:0};
 assert.equal(creditBalance(held).availableCents,100);assert.equal(canPayAX(held,399),false);assert.equal(canPayAX(held,100),true);assert.match(creditNotices(held).join(' '),/11\.34 AX is on hold and unavailable/);
 for(const availableCreditsCents of [undefined,null,-1,NaN,Infinity,'1234'])assert.equal(canPayAX({...held,availableCreditsCents},399),false);
 assert.equal(creditBalance({creditsCents:100000}).availableCents,null);
});

test('AX debt blocks balance purchases without recalculating the server amount',()=>{
 const debt={creditsCents:1234,availableCreditsCents:1234,creditsHeldCents:0,creditsDebtCents:500};
 assert.equal(creditBalance(debt).availableCents,1234);assert.equal(canPayAX(debt,399),false);assert.match(creditNotices(debt).join(' '),/Balance debt: 5\.00 AX/);
 assert.equal(canPayAX({...debt,creditsDebtCents:0},399),true);assert.deepEqual(creditNotices({...debt,creditsDebtCents:0}),[]);assert.equal(canPayAX({...debt,creditsDebtCents:'0'},399),false);
 for(const amount of [0,-1,NaN,Infinity,'399'])assert.equal(canPayAX({...debt,creditsDebtCents:0},amount),false);
});
