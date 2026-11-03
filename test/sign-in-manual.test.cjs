'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'app/sign-in.html'),'utf8'),script=fs.readFileSync(path.join(root,'app/sign-in.js'),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function ui(overrides={}){
 const elements=new Map();
 for(const [,id]of html.matchAll(/id="([^"]+)"/g))elements.set(id,{value:'',hidden:new RegExp('id="'+id+'"[^>]*hidden').test(html),disabled:false,textContent:'',children:[],classList:{toggle(){}},focus(){},replaceChildren(){this.children=[];this.value='';},append(child){this.children.push(child);if(this.children.length===1)this.value=child.value;}});
 const bridge={accountStatus:async()=>({signedIn:false}),accountManualLogin:async()=>({requires2fa:true,methods:['call','totp']}),accountManualCall:async()=>({sent:true}),accountManualCancel:async()=>({cancelled:true}),...overrides};
 const buttons=[{disabled:false},{disabled:false}];
 vm.runInNewContext(script,{window:{bridge},document:{getElementById:id=>elements.get(id),querySelectorAll:()=>buttons,createElement:()=>({value:'',textContent:''})},setTimeout:()=>1,clearTimeout(){}});
 return {el:id=>elements.get(id),submit:id=>elements.get(id).onsubmit({preventDefault(){}}),buttons};
}
test('manual login clears the password on failure and shows the sanitized status',async()=>{
 let reject,seen;const pending=new Promise((_,fail)=>{reject=fail;});
 const u=ui({accountManualLogin:(name,password)=>{seen={name,password};return pending;}});
 u.el('username').value='fixture-user';u.el('password').value='Fixture-password!';u.submit('manual-form');
 assert.equal(u.el('password').value,'');assert.deepEqual(seen,{name:'fixture-user',password:'Fixture-password!'});
 reject(Error('Red-XAI manual sign-in could not complete (HTTP 401).'));await settle();
 assert.match(u.el('status').textContent,/HTTP 401/);assert.equal(u.el('password').value,'');assert.equal(u.buttons[0].disabled,false);
});
test('server-completed password-only sign-in continues without showing the MFA form',async()=>{
 const u=ui({accountManualLogin:async()=>({signedIn:true})});
 u.el('username').value='fixture-user';u.el('password').value='Fixture-password!';u.submit('manual-form');
 assert.equal(u.el('password').value,'');await settle();
 assert.equal(u.el('twofactor-form').hidden,true);assert.match(u.el('status').textContent,/Signed in/);
});
test('phone MFA presents an explicit call action and clears formatted code before IPC',async()=>{
 let calls=0,verified;const u=ui({accountManualCall:async()=>{calls++;return{sent:true};},accountManual2fa:async(code,method)=>{verified={code,method};return{signedIn:true};}});
 u.el('password').value='Fixture-password!';u.submit('manual-form');await settle();
 assert.equal(u.el('password').value,'');assert.equal(u.el('manual-form').hidden,true);assert.equal(u.el('twofactor-call').hidden,false);
 assert.equal(u.el('twofactor-method').children[0].textContent,'Phone call');
 u.el('twofactor-call').onclick();await settle();assert.equal(calls,1);assert.equal(u.el('twofactor-call').disabled,true);
 u.el('twofactor-code').value='123 456';u.submit('twofactor-form');assert.equal(u.el('twofactor-code').value,'');await settle();
 assert.deepEqual(verified,{code:'123456',method:'call'});assert.match(u.el('status').textContent,/Verified/);
});
test('Back cancels native MFA and ignores a late completion in the old form',async()=>{
 let complete,cancelled=0;const pending=new Promise(resolve=>{complete=resolve;});
 const u=ui({accountManual2fa:()=>pending,accountManualCancel:async()=>{cancelled++;return{cancelled:true};}});
 u.el('password').value='Fixture-password!';u.submit('manual-form');await settle();
 u.el('twofactor-code').value='123456';u.submit('twofactor-form');u.el('twofactor-back').onclick();
 assert.equal(cancelled,1);assert.equal(u.el('twofactor-code').value,'');assert.equal(u.el('manual-form').hidden,false);
 complete({signedIn:true});await settle();assert.match(u.el('status').textContent,/Sign in again/);assert.equal(u.el('twofactor-form').hidden,true);
});
