'use strict';
(() => {
 const api=window.bridge;
 const get=id=>document.getElementById(id);
 const computer=get('quick-computer-setup'),computerResult=get('quick-computer-result');
 const kind=get('quick-ai-kind'),name=get('quick-ai-name'),add=get('quick-add-ai');
 const result=get('quick-ai-result'),copy=get('quick-copy-connection');
 if(!api?.quickSetup||!api?.addAi||!computer||!kind||!add)return;
 let secretText='',pendingRemote=false,remoteHelp='';
 const text=(el,str)=>{el.textContent=String(str||'');};
 function renderError(target,error){text(target,'Setup did not complete: '+(error?.message||String(error)));}
 function setNameVisibility(){name.hidden=kind.value!=='generic';name.required=kind.value==='generic';name.value=kind.value==='generic'?name.value:'';}
 kind.addEventListener('change',()=>{secretText='';pendingRemote=false;remoteHelp='';copy.hidden=true;text(result,'');setNameVisibility()});
 function remoteChanged(status){
  if(!pendingRemote||kind.value!=='remote')return;
  if(status.phase==='online'&&status.url){
   pendingRemote=false;
   secretText='HTTPS MCP URL: '+status.url+'\n'+remoteHelp;
   text(result,'Remote endpoint verified. Connect your AI through OAuth and approve pairing in Bridge.\n\n'+secretText);
   copy.hidden=false;
  }else if(status.phase==='unreachable')text(result,'Remote tunnel is running but its HTTPS endpoint is not reachable yet. '+(status.message||'Retrying automatically.'));
  else if(status.phase==='error'){pendingRemote=false;text(result,'Remote setup failed: '+(status.message||'Unable to connect.'));}
 }
 api.on?.('remote',remoteChanged);
 setNameVisibility();
 computer.addEventListener('click',async()=>{
  computer.disabled=true;text(computerResult,'Checking local gateway and desktop permissions…');
  try{
   const r=await api.quickSetup();
   const lines=[r.message,'OS: '+r.operatingSystem,'Local gateway: '+(r.gatewayRunning?'Running':'Stopped'),
    'Desktop input: '+(r.readyForDesktopInput?'Ready':'Needs attention / unavailable'),
    'Session: '+(r.session||'unknown'),'Launch at sign-in: '+(r.startupEnabled?'Enabled':'Not enabled'),'New AI permissions: Ask'];
   if(r.missing?.length)lines.push('Missing: '+r.missing.join(', '));
   if(r.advice?.length)lines.push(...r.advice.map(a=>'• '+a));
   text(computerResult,lines.join('\n'));
  }catch(e){renderError(computerResult,e);}
  finally{computer.disabled=false;}
 });
 add.addEventListener('click',async()=>{
  add.disabled=true;copy.hidden=true;secretText='';pendingRemote=kind.value==='remote';remoteHelp='';
  text(result,'Connecting selected AI…');
  try{
   const selected=kind.value;
   const r=await api.addAi(selected,name.value);
   if(selected==='remote'){
    remoteHelp=r.oneTimeInstructions||'';text(result,r.message);
    if(r.remoteUrl)remoteChanged({phase:'online',url:r.remoteUrl});
    else remoteChanged((await api.snapshot()).remote);
    return;
   }
   const lines=[r.message];
   if(r.path)lines.push('Installed MCP config: '+r.path);
   if(r.backup)lines.push('Existing config backup: '+r.backup);
   if(r.remoteUrl)lines.push('HTTPS MCP server: '+r.remoteUrl);
   if(r.oneTimeInstructions){
    secretText=r.oneTimeInstructions;
    lines.push('',r.oneTimeInstructions);
    copy.hidden=false;
   }
   text(result,lines.join('\n'));
   if(selected==='generic')name.value='';
  }catch(e){pendingRemote=false;renderError(result,e);}
  finally{add.disabled=false;}
 });
 copy.addEventListener('click',async()=>{
  if(!secretText)return;
  copy.disabled=true;
  try{await api.copy(secretText);copy.textContent='Copied — paste privately';}
  catch(e){renderError(result,e);}
  finally{copy.disabled=false;}
 });
})();
