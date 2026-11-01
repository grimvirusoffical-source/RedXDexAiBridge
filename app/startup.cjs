'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const MARKER='X-RedXAI-Managed=true';
function configureStartup(app,enabled,{platform=process.platform,env=process.env,configDirectory,homeDirectory=os.homedir()}={}){
 if(typeof enabled!=='boolean')throw Error('Startup preference must be a boolean');
 if(platform==='darwin'){app.setLoginItemSettings({openAtLogin:enabled});return {enabled,platform};}
 if(platform==='win32'){
  const secureTunnelConfigured=fs.existsSync(path.join(homeDirectory,'.redxdex-ai-bridge','openai-tunnel-id.txt'));
  const value={openAtLogin:enabled};
  if(enabled&&!secureTunnelConfigured)value.args=['--connect-remote'];
  app.setLoginItemSettings(value);
  return {enabled,platform,secureTunnelConfigured};
 }
 if(platform!=='linux')throw Error('Automatic startup is not supported on this platform');
 const config=configDirectory||env.XDG_CONFIG_HOME||path.join(os.homedir(),'.config');
 if(!path.isAbsolute(config))throw Error('Linux configuration directory must be absolute');
 const dir=path.join(config,'autostart'),file=path.join(dir,'redxdex-ai-bridge.desktop');
 const st=fs.lstatSync(file,{throwIfNoEntry:false});
 if(st&&(st.isSymbolicLink()||!st.isFile()||!fs.readFileSync(file,'utf8').split(/\r?\n/).includes(MARKER)))throw Error('An unmanaged startup entry exists; it was not changed');
 if(!enabled){if(st)fs.unlinkSync(file);return {enabled:false,platform};}
 const executable=env.APPIMAGE||app.getPath('exe');
 if(typeof executable!=='string'||!path.isAbsolute(executable)||/[\r\n\0]/.test(executable)||!fs.statSync(executable).isFile())throw Error('Cannot determine the installed application path for startup');
 // Freedesktop Exec is not a shell. Quote its reserved characters and escape
 // percent field codes; never write a command assembled from untrusted input.
 const quoted='"'+executable.replace(/[%]/g,'%%').replace(/[\\"`$]/g,'\\$&')+'"';
 const text='[Desktop Entry]\nType=Application\nVersion=1.0\nName=Red-XAI Bridge\nComment=Permission-controlled AI desktop bridge\nExec='+quoted+'\nIcon=redxdex-ai-bridge\nTerminal=false\nX-GNOME-Autostart-enabled=true\n'+MARKER+'\n';
 fs.mkdirSync(dir,{recursive:true,mode:0o700});const temp=file+'.'+crypto.randomUUID();
 try{fs.writeFileSync(temp,text,{flag:'wx',mode:0o600});fs.renameSync(temp,file);}finally{try{fs.unlinkSync(temp)}catch{}}
 return {enabled:true,platform};
}
module.exports={configureStartup};
