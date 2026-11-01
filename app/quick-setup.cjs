'use strict';
const {findExecutable}=require('./platform.cjs');

const LOCAL_CLIENTS=Object.freeze(['codex','claude','vscode','cursor']);
const AI_TYPES=Object.freeze([...LOCAL_CLIENTS,'generic','remote']);

function validateType(kind){
 if(typeof kind!=='string'||!AI_TYPES.includes(kind))throw Error('Choose a supported AI connection type.');
 return kind;
}
function validateName(name){
 if(typeof name!=='string'||!name.trim()||name.length>80||/[\x00-\x1f\x7f]/.test(name))throw Error('AI name must be 1–80 printable characters.');
 return name.trim();
}
function readiness({platform=process.platform,env=process.env,lookup=findExecutable,nativeStatus={}}={}){
 const operatingSystem=platform==='win32'?'Windows':platform==='linux'?'Linux':platform==='darwin'?'macOS':'Other';
 const response={platform,operatingSystem,readyForLocalMCP:true,readyForDesktopInput:null,
  session:null,missing:[],advice:[],requiresConsent:true};
 if(platform==='win32'){
  response.readyForDesktopInput=!!(nativeStatus.inputSupported??nativeStatus.accessibility);
  response.session='interactive-windows';
  if(!response.readyForDesktopInput)response.advice.push('Unlock the Windows desktop and run the bridge in the signed-in interactive session; Windows UAC and protected desktops are never bypassed.');
 }else if(platform==='linux'){
  const wayland=env.XDG_SESSION_TYPE==='wayland'||!!env.WAYLAND_DISPLAY;
  const x11=!!env.DISPLAY&&!wayland;
  const xdotool=!!lookup('xdotool','linux',env);
  response.session=wayland?'wayland':x11?'x11':'headless';
  response.readyForDesktopInput=x11&&xdotool;
  if(!x11)response.missing.push(wayland?'X11 session for global input':'Active X11 graphical desktop');
  if(!xdotool)response.missing.push('xdotool');
  if(!env.DBUS_SESSION_BUS_ADDRESS)response.advice.push('A desktop D-Bus session and unlocked Secret Service keyring are needed for encrypted API keys.');
  if(wayland)response.advice.push('Wayland screen capture requires the desktop portal; global mouse/keyboard injection is not supported. Choose an X11 login session to enable it.');
  if(!xdotool)response.advice.push('Install xdotool using your Linux package manager. The bridge cannot silently invoke sudo or change OS security policy.');
 }else if(platform==='darwin'){
  response.session='macos-desktop';
  response.readyForDesktopInput=!!nativeStatus.accessibility;
  if(!response.readyForDesktopInput)response.advice.push('Grant Accessibility and Screen Recording through macOS System Settings; they cannot be granted silently.');
 }else{
  response.readyForLocalMCP=false;
  response.readyForDesktopInput=false;
  response.missing.push('Supported Windows, Linux or macOS desktop');
 }
 response.readyForFullDesktop=!!(response.readyForLocalMCP&&response.readyForDesktopInput);
 return response;
}
function instructionsFor(kind,{clientName,url,token}={}){
 validateType(kind);
 if(kind==='generic'){
  validateName(clientName);
  if(!/^http:\/\/127\.0\.0\.1:\d{2,5}\/mcp$/.test(url||''))throw Error('Generic local MCP setup requires an active loopback gateway.');
  if(typeof token!=='string'||token.length<24)throw Error('A new one-time credential is required.');
  return 'New AI: '+clientName+'\nMCP transport: Streamable HTTP\nServer URL: '+url+'\nAuthorization header: Bearer '+token+'\nThis credential is shown only once. Keep it private. Permissions remain Ask until you explicitly change them.';
 }
 if(kind==='remote')return 'Connect your remote AI to the app’s HTTPS MCP URL using OAuth, then approve its pairing request here. This URL may change when a temporary tunnel restarts. Do not embed bearer tokens in remote clients.';
 return 'Client configuration installed. Restart or reload the selected AI application. Review its individual bridge permissions before using computer tools.';
}
module.exports={LOCAL_CLIENTS,AI_TYPES,validateType,validateName,readiness,instructionsFor};
