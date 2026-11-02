'use strict';
// Internal adapter completion receipts, NOT an observed primary-account HTTP
// contract. The trusted adapter must independently verify the upstream effect;
// these checks bind its acknowledgement to the platform-issued operation.
const ABSENT=Symbol('absent'),CORE=['sub','action','scope','requestId'];
const OPTIONAL=['untilMs','deviceId','allDevices','clientId','appNumber','issuer'];
const EXPECTED_KEYS=new Set([...CORE,...OPTIONAL,'effects']);
const RESERVED_EFFECTS=new Set([...CORE,...OPTIONAL,'effects','verified','completed','ok','success','__proto__','constructor','prototype']);
function own(value,key){const descriptor=Object.getOwnPropertyDescriptor(value,key);return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:ABSENT;}
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{3,128}$/.test(value)&&!(value in Object.prototype);
const canonicalSubject=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\s\p{Cc}]/u.test(value)&&!(value in Object.prototype);
function authorityConfirmed(receipt,expected){
 try{
  if(!record(receipt)||!record(expected)||Reflect.ownKeys(expected).some(key=>typeof key!=='string'||!EXPECTED_KEYS.has(key)||own(expected,key)===ABSENT))return false;
  if(!canonicalSubject(own(expected,'sub'))||!['ban','unban','delete','revoke'].includes(own(expected,'action'))||!['global','bridge'].includes(own(expected,'scope'))||!id(own(expected,'requestId')))return false;
  if(own(receipt,'verified')!==true||own(receipt,'completed')!==true)return false;
  for(const field of ['ok','success']){const value=own(receipt,field);if(value!==ABSENT&&value!==true)return false;}
  for(const field of CORE)if(own(receipt,field)!==own(expected,field))return false;
  for(const field of OPTIONAL){
   const value=own(expected,field);if(value===ABSENT)continue;
   if(field==='untilMs'&&value!==null&&(!Number.isSafeInteger(value)||value<0))return false;
   if(field==='deviceId'&&!id(value))return false;
   if(field==='allDevices'&&typeof value!=='boolean')return false;
   if(field==='clientId'&&value!=='bridge')return false;
   if(field==='appNumber'&&value!==6)return false;
   if(field==='issuer'&&value!=='https://red-xai.com')return false;
   if(own(receipt,field)!==value)return false;
  }
  const effects=own(expected,'effects');
  if(effects!==ABSENT){
   if(!record(effects))return false;const keys=Reflect.ownKeys(effects);if(!keys.length||keys.length>16||keys.some(key=>typeof key!=='string'))return false;
   for(const field of keys){const value=own(effects,field);if(!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(field)||RESERVED_EFFECTS.has(field)||typeof value!=='boolean'||own(receipt,field)!==value)return false;}
  }
  return true;
 }catch{return false;}
}
// This is the normalized internal Stripe-adapter acknowledgement, not a raw
// provider object. It can be produced only after verified cancellation and a
// successful entitlement sync; callers still supply platform-owned bindings.
function subscriptionCancellationConfirmed(receipt,expected){
 try{
  const bindingKeys=['sub','subscriptionId','requestId'],receiptKeys=[...bindingKeys,'verified','completed','ok','scope','action','status'];
  if(!record(receipt)||!record(expected)||Reflect.ownKeys(expected).some(key=>typeof key!=='string'||!bindingKeys.includes(key)||own(expected,key)===ABSENT))return false;
  const keys=Reflect.ownKeys(receipt);if(keys.length!==receiptKeys.length||keys.some(key=>typeof key!=='string'||!receiptKeys.includes(key)||own(receipt,key)===ABSENT))return false;
  const subscriptionId=own(expected,'subscriptionId'),requestId=own(expected,'requestId');
  if(!canonicalSubject(own(expected,'sub'))||typeof subscriptionId!=='string'||!/^sub_[A-Za-z0-9_]{1,120}$/.test(subscriptionId)||typeof requestId!=='string'||!/^(?:[A-Za-z0-9_-]{3,128}|delete:[a-f0-9]{64})$/.test(requestId))return false;
  if(own(receipt,'verified')!==true||own(receipt,'completed')!==true||own(receipt,'ok')!==true||own(receipt,'scope')!=='bridge'||own(receipt,'action')!=='cancel-subscription'||own(receipt,'status')!=='canceled')return false;
  return bindingKeys.every(key=>own(receipt,key)===own(expected,key));
 }catch{return false;}
}
module.exports={authorityConfirmed,subscriptionCancellationConfirmed};
