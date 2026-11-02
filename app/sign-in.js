(()=>{
'use strict';
const bridge=window.bridge;
const el=id=>document.getElementById(id);
let timer=null,polling=false,busy=false;
function msg(value,good=false){el('status').textContent=String(value||'');el('status').classList.toggle('ok',good);}
function setBusy(value){busy=value;for(const id of ['quick-start','quick-open','create-account','get-cli'])el(id).disabled=value;}
async function attempt(fn){if(busy)return;setBusy(true);try{await fn();}catch(e){msg(e.message||String(e));}finally{setBusy(false);}}
function stopPoll(){if(timer){clearTimeout(timer);timer=null;}polling=false;}
function arrangePoll(seconds=3){stopPoll();timer=setTimeout(async()=>{timer=null;if(polling)return;polling=true;
 try{
  const r=await bridge.accountQuickPoll();
  if(r.signedIn){msg('Account verified. Unlocking Bridge…',true);return;}
  arrangePoll(Math.max(2,Math.min(r.interval||seconds,10)));
 }catch(e){stopPoll();msg(e.message||'Quick Login failed. Use the password option if the service is unavailable.');}
 finally{polling=false;}
},Math.max(2,seconds)*1000);}
el('quick-start').onclick=()=>attempt(async()=>{
 stopPoll();const r=await bridge.accountQuickStart();
 el('quick-pending').hidden=false;el('quick-code').textContent=r.code;msg('Approve this Bridge in the Red-XAI browser window.');
 await bridge.accountQuickOpen();
 arrangePoll(r.interval);
});
el('quick-open').onclick=()=>attempt(()=>bridge.accountQuickOpen());
el('quick-cancel').onclick=async()=>{stopPoll();await bridge.accountQuickCancel().catch(()=>{});el('quick-pending').hidden=true;msg('Quick Login cancelled.');};
el('manual-form').onsubmit=e=>{e.preventDefault();attempt(async()=>{
 stopPoll();msg('Verifying Red-XAI account…');
 const r=await bridge.accountManualLogin(el('username').value,el('password').value);
 el('password').value='';
 if(r.requires2fa){
  const methods=r.methods?.length?r.methods:r.method?[r.method]:['totp'];
  const select=el('twofactor-method');select.replaceChildren();
  for(const m of methods){const opt=document.createElement('option');opt.value=m;opt.textContent=m==='totp'||m==='app'?'Authenticator app':m==='sms'||m==='phone'?'SMS verification':m;select.append(opt);}
  el('manual-form').hidden=true;el('twofactor-form').hidden=false;el('twofactor-code').focus();msg('Enter the verification code from your Red-XAI account.');
 }else if(r.signedIn)msg('Signed in. Loading your Bridge…',true);
});};
el('twofactor-form').onsubmit=e=>{e.preventDefault();attempt(async()=>{
 const r=await bridge.accountManual2fa(el('twofactor-code').value.trim(),el('twofactor-method').value);
 if(r.signedIn)msg('Verified. Loading Bridge…',true);
});};
el('twofactor-back').onclick=()=>{el('twofactor-form').hidden=true;el('manual-form').hidden=false;el('twofactor-code').value='';msg('Sign in again to request a new code.');};
el('create-account').onclick=()=>attempt(()=>bridge.accountSignup());
el('get-cli').onclick=()=>attempt(async()=>{await bridge.cliDownload();msg('Opened the Red-XAI CLI repository releases. If no release is listed, the CLI installer is not yet published.');});
bridge.accountStatus().then(status=>{if(status.signedIn)msg('Account verified.');}).catch(e=>msg(e.message));

async function loginUpdateState(){
 const s=await bridge.updateStatus();
 el('login-update-download').hidden=s.phase!=='available';
 el('login-update-install').hidden=!s.canInstall;
 return s;
}
el('login-update-check').onclick=()=>attempt(async()=>{
 const s=await bridge.updates();await loginUpdateState();
 msg(s.message||'Checked for Bridge updates.');
});
el('login-update-download').onclick=()=>attempt(async()=>{
 const s=await bridge.updateDownload();await loginUpdateState();
 msg(s.message||'Downloading verified Bridge update…');
});
el('login-update-install').onclick=()=>attempt(async()=>{await bridge.updateInstall();});
})();
