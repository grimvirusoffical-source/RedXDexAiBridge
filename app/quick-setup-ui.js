'use strict';
(() => {
 const api=window.bridge;
 const get=id=>document.getElementById(id);
 const computer=get('quick-computer-setup'),computerResult=get('quick-computer-result');
 const kind=get('quick-ai-kind'),name=get('quick-ai-name'),add=get('quick-add-ai');
 const result=get('quick-ai-result'),copy=get('quick-copy-connection');
 if(!api?.quickSetup||!api?.addAi||!computer||!kind||!add)return;
 let secretText='';
 const text=(el,str)=>{el.textContent=String(str||'');};
 function renderError(target,error){text(target,'Setup did not complete: '+(error?.message||String(error)));}
 function setNameVisibility(){name.hidden=kind.value!=='generic';name.required=kind.value==='generic';name.value=kind.value==='generic'?name.value:'';}
 kind.addEventListener('change',()=>{secretText='';copy.hidden=true;text(result,'');setNameVisibility()});
 setNameVisibility();
 computer.addEventListener('click',async()=>{
  computer.disabled=true;text(computerResult,'Checking local gateway and desktop permissions…');
  try{
   const r=await api.quickSetup();
   const lines=[r.message,'OS: '+r.operatingSystem,'Local gateway: '+(r.gatewayRunning?'Running':'Stopped'),
    'Desktop input: '+(r.readyForDesktopInput?'Ready':'Needs attention / unavailable'),
    'Session: '+(r.session||'unknown'),'New AI permissions: Ask'];
   if(r.missing?.length)lines.push('Missing: '+r.missing.join(', '));
   if(r.advice?.length)lines.push(...r.advice.map(a=>'• '+a));
   text(computerResult,lines.join('\n'));
  }catch(e){renderError(computerResult,e);}
  finally{computer.disabled=false;}
 });
 add.addEventListener('click',async()=>{
  add.disabled=true;copy.hidden=true;secretText='';
  text(result,'Connecting selected AI…');
  try{
   const r=await api.addAi(kind.value,name.value);
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
   if(kind.value==='generic')name.value='';
  }catch(e){renderError(result,e);}
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
