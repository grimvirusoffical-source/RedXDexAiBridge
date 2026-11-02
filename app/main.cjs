'use strict';
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {atomicRename}=require('./atomic-rename.cjs');
const {app,BrowserWindow,ipcMain,dialog,safeStorage,session,Tray,Menu,nativeImage,shell,clipboard,Notification}=require('electron');
if(process.argv.includes('--self-test')&&(!process.env.REDXDEX_DATA_DIR||!process.env.REDXDEX_SMOKE_OUTPUT))throw Error('Self-test requires isolated data and output folders');
const core=require('./core.cjs'),vortex=require('./vortex.cjs'),setup=require('./setup.cjs'),native=require('./native.cjs'),quickSetup=require('./quick-setup.cjs');
const {startServer}=require('./http-mcp.cjs'),{ClientStore,atomicJSON}=require('./clients.cjs'),{ApprovalQueue}=require('./approvals.cjs'),{OAuthService}=require('./oauth.cjs'),{Tunnel}=require('./tunnel.cjs'),{createUpdateController}=require('./auto-update.cjs');
const {RedXAIAccount}=require('./redxai-auth.cjs');
const {PlatformClient}=require('./platform-client.cjs');
const platformConfig=require('./platform-config.cjs');
let accountPlatform,workMeter,pluginRunner;
const {validateRemoteConfig}=require('./tunnel-modes.cjs');
let win,tray,gateway,clients,oauth,approvals,tunnel,updateController,accountAuth,quitting=false;const activity=[];
let lastNotifiedHandoffUrl=null;
const UI=pathToFileURL(path.join(__dirname,'index.html')).href;
const LOGIN_UI=pathToFileURL(path.join(__dirname,'sign-in.html')).href;
const CI_SMOKE=!app.isPackaged&&!!process.env.REDXDEX_SMOKE_OUTPUT;
const AUTH_SMOKE=!app.isPackaged&&!!process.env.REDXDEX_AUTH_SMOKE_OUTPUT;
const PUBLIC_IPC=new Set(['account:status','account:quick:start','account:quick:open','account:quick:poll','account:quick:cancel','account:manual:login','account:manual:2fa','account:logout','account:signup','cli:download','app:version','updates:status','app:updates','updates:download','updates:install']);
app.setPath('userData',path.join(app.getPath('appData'),'redxdex-ai-bridge'));
app.setName('RedXDexAiBridge');
if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test')))app.setPath('userData',path.join(process.env.REDXDEX_SMOKE_OUTPUT,'userData'));
if(AUTH_SMOKE)app.setPath('userData',path.join(process.env.REDXDEX_AUTH_SMOKE_OUTPUT,'userData'));
if(process.argv.includes('--vortex-diagnostic')){
 app.whenReady().then(async()=>{
  const result=await require('./vortex-diagnostic.cjs').run({app,safeStorage,root:core.root,argv:process.argv});
  app.exit(result.connected?0:1);
 }).catch(error=>{console.error(error.message);app.exit(1);});
}else if(!app.requestSingleInstanceLock()){app.quit();}else{
 app.on('second-instance',()=>show());
 function emit(channel,value){if(win&&!win.isDestroyed())win.webContents.send(channel,value);}
 function show(){if(win&&!win.isDestroyed()){win.show();win.focus();}}
 function audit(record){activity.unshift(record);activity.length=Math.min(activity.length,300);emit('activity',activity.slice(0,100));}
 function vortexConfig(){
  const file=path.join(app.getPath('userData'),'vortex-connection.json');
  let config={};if(fs.existsSync(file))config=JSON.parse(fs.readFileSync(file,'utf8'));
  return {endpoint:vortex.normalizeEndpoint(config.endpoint||vortex.ENDPOINT)};
 }
 async function vortexStatus(){
  const config=vortexConfig(),key=readSecret('vortex-key');
  if(!key)return {connected:false,endpoint:config.endpoint,error:'Add a Vortex API key first'};
  try{const models=await vortex.models(key,globalThis.fetch,config);return {connected:true,endpoint:config.endpoint,models,defaultModel:vortex.DEFAULT_MODEL,proAvailable:models.includes(vortex.DEFAULT_MODEL)};}
  catch(error){return {connected:false,endpoint:config.endpoint,error:error.message};}
 }
 function secretFile(name){return path.join(app.getPath('userData'),name+'.enc');}
 function secure(){if(!safeStorage.isEncryptionAvailable()||safeStorage.getSelectedStorageBackend?.()==='basic_text')throw Error('Secure OS credential storage is unavailable');}
 function readSecret(name){secure();const p=secretFile(name);return fs.existsSync(p)?safeStorage.decryptString(fs.readFileSync(p)):'';}
 function saveSecret(name,value){secure();fs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});const f=secretFile(name),tmp=f+'.'+crypto.randomUUID();try{fs.writeFileSync(tmp,safeStorage.encryptString(value),{mode:0o600,flag:'wx'});atomicRename(tmp,f);}finally{try{fs.unlinkSync(tmp);}catch{}}}
 function ipc(name,fn){ipcMain.handle(name,async(e,...args)=>{
  const page=e.senderFrame?.url;
  if(!win||e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||![UI,LOGIN_UI].includes(page))throw Error('Untrusted IPC sender');
  if(page===LOGIN_UI&&!PUBLIC_IPC.has(name))throw Error('Sign in before using Bridge');
  if(!CI_SMOKE&&!PUBLIC_IPC.has(name))await accountAuth.ensure();
  return fn(...args);
 });}
 function defaultClient(id){const s=core.settings();s.clientPolicies[id]=Object.fromEntries(Object.keys(s.permissions).map(k=>[k,'ask']));core.saveSettings(s);emit('clients',clients.list());}
 function runtime(){return {version:app.getVersion(),platform:process.platform,arch:process.arch,packaged:app.isPackaged,account:accountAuth.status(),gateway:gateway?{running:true,url:gateway.url}:{running:false},remote:tunnel.status(),clients:clients.list(),settings:core.settings(),approvals:approvals.list(),activity:activity.slice(0,100),updates:updateController.status(),toolCount:core.definitions.length};}
 async function startGateway(){
  if(!CI_SMOKE&&!accountAuth.isSignedIn())throw Error('Sign in to Red-XAI before starting MCP');
  if(!CI_SMOKE&&platformConfig.required&&(!accountPlatform.state?.accepted))throw Error('Review and accept the Bridge agreements before connecting tools');
  if(gateway)return {running:true,url:gateway.url};
  gateway=await startServer({clients,oauth,port:tunnel?.config()?.mode==='named'?tunnel.config().localPort:0,isOperational:()=>CI_SMOKE||accountAuth.isSignedIn(),
   contextFor:c=>({transport:'http',isActive:()=>clients.exists(c.id)&&(CI_SMOKE||accountAuth.isSignedIn()),authorize:detail=>approvals.request({kind:'tool',...detail})}),onCall:audit});
  atomicJSON(path.join(core.root,'runtime.json'),{url:gateway.url,pid:process.pid,version:app.getVersion()});
  return {running:true,url:gateway.url};
 }
 async function shutDownGateway(){
  if(workMeter)await workMeter.stop();
  tunnel.stop();approvals.cancelAll('Red-XAI sign-out');core.processes.stopAll();core.crawlJobs.stopAll();core.desktopLease.reset();
  const old=gateway;gateway=null;
  if(old){old.server.closeAllConnections?.();await old.stop().catch(()=>{});}
  try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}
 }
 async function showLogin(){
  accountAuth.session=null;accountAuth.emit();
  await shutDownGateway();
  if(!win.isDestroyed()&&win.webContents.getURL()!==LOGIN_UI)await win.loadFile(path.join(__dirname,'sign-in.html'));
  win.show();
 }
 async function openAfterLogin(){
  if(!accountAuth.isSignedIn())throw Error('Red-XAI account is not verified');
  if(platformConfig.required){try{await accountPlatform.status();}catch(e){emit('platform:state',{available:false,message:e.message});}}
  if(!platformConfig.required||accountPlatform.state?.accepted)await startGateway();
  if(win.webContents.getURL()!==UI)await win.loadFile(path.join(__dirname,'index.html'));
  if(remoteAutoConnect())tunnel.start(gateway.url).catch(e=>emit('remote',{phase:'error',message:e.message}));
  return accountAuth.status();
 }
 function stopEverything(){const s=core.settings();s.emergencyStop=true;core.saveSettings(s);approvals.cancelAll();core.processes.stopAll();core.crawlJobs.stopAll();core.desktopLease.reset();emit('settings',s);audit({at:Date.now(),tool:'emergency_stop',clientName:'Desktop',error:false});return s;}
 function remoteAutoConnect(){return require('./remote-preferences.cjs').enabled(core.root);}
 function rememberRemote(enabled){require('./remote-preferences.cjs').remember(core.root,enabled);}
 function clientSpec(client){if(!['codex','chatgpt','claude','vscode','cursor','gemini','vortex','Diagnostics'].includes(client))throw Error('Unsupported local client');const credentialFile=path.join(core.root,'credentials',client+'.json');let c;if(fs.existsSync(credentialFile)){c=JSON.parse(fs.readFileSync(credentialFile));if(!clients.exists(c.id))c=null;}
  if(!c){c=clients.create(client==='claude'?'Claude Desktop':client==='vscode'?'VS Code':client==='cursor'?'Cursor':client==='gemini'?'Gemini CLI':client,'local');defaultClient(c.id);atomicJSON(credentialFile,{id:c.id,token:c.token});}
  return {command:app.isPackaged?process.execPath:setup.nodeCommand(),args:[app.isPackaged?path.join(process.resourcesPath,'bridge-adapter.cjs'):path.join(__dirname,'adapter.cjs')],env:{...(app.isPackaged?{ELECTRON_RUN_AS_NODE:'1'}:{}),REDXDEX_CLIENT_KEY_FILE:credentialFile,REDXDEX_MANAGED:'1'}};
 }
 async function configureUpdateFeed(){require('electron-updater').autoUpdater.setFeedURL(require('./public-updates.cjs').PUBLIC_FEED);}
 async function checkUpdates(){await configureUpdateFeed();await updateController.check();return updateController.status();}
 app.whenReady().then(async()=>{
  fs.mkdirSync(core.root,{recursive:true,mode:0o700});fs.chmodSync(core.root,0o700);
  clients=new ClientStore(path.join(core.root,'clients.json'));
  approvals=new ApprovalQueue({emit:items=>{emit('approvals',items);if(items.length){app.dock?.bounce('informational');}}});
  oauth=new OAuthService({file:path.join(core.root,'oauth.json'),clients,approvals,onClient:defaultClient});
   accountAuth=new RedXAIAccount({
    load:async()=>readSecret('redxai-account-session'),
    save:async value=>saveSecret('redxai-account-session',value),
    clear:async()=>{try{fs.unlinkSync(secretFile('redxai-account-session'));}catch(e){if(e.code!=='ENOENT')throw e;}},
    beforeActivate:async identity=>{
     const ownerFile=path.join(core.root,'redxai-device-owner.json');
     const owner=fs.existsSync(ownerFile)?JSON.parse(fs.readFileSync(ownerFile,'utf8')).sub:'';
     if(owner&&owner!==identity.sub)throw Error('This computer is enrolled to another Red-XAI account. An approved device reset is required before switching users.');
     if(!owner)atomicJSON(ownerFile,{sub:identity.sub,appId:6});
    },
    onChange:value=>emit('account:state',value)
   });
   accountPlatform=new PlatformClient({credentials:async()=>{await accountAuth.ensure();return accountAuth.session;},loadSecret:async name=>readSecret(name),saveSecret:async(name,value)=>saveSecret(name,value),clearSecret:async name=>{try{fs.unlinkSync(secretFile(name));}catch(e){if(e.code!=='ENOENT')throw e;}},label:os.hostname()});
   pluginRunner=new (require('./plugin-runner.cjs').PluginRunner)({platform:accountPlatform,perform:core.perform,loadSecret:async name=>readSecret(name),saveSecret:async(name,value)=>saveSecret(name,value)});
   if(platformConfig.required&&!CI_SMOKE&&!AUTH_SMOKE){workMeter=new (require('./platform-meter.cjs').PlatformMeter)({client:accountPlatform,stopWork:()=>{core.processes.stopAll();core.crawlJobs.stopAll();core.desktopLease.reset();}});core.configurePlatformMeter(workMeter);}
   if(!CI_SMOKE)await accountAuth.restore();
   if(platformConfig.required&&accountAuth.isSignedIn())await accountPlatform.status().catch(()=>{});
  tunnel=new Tunnel(s=>{
   if(s.url)oauth.setOrigin(new URL(s.url).origin);else oauth.origin=null;
   atomicJSON(path.join(core.root,'remote-status.json'),s);emit('remote',s);
   // Only notify when the relay has passed its OAuth metadata verification.
   // User-triggered clipboard handoff is separate from OAuth approval.
   if(require('./chatgpt-handoff.cjs').newEndpoint(lastNotifiedHandoffUrl,s)){
    lastNotifiedHandoffUrl=s.url;
    if(app.isPackaged&&!process.env.REDXDEX_SMOKE_OUTPUT&&Notification.isSupported()){
     try{
      const note=new Notification({title:'Red-XAI Bridge connection ready',body:'Open Bridge → AI connections → Copy for ChatGPT to update your private plugin.'});
      note.on('click',()=>{show();win?.webContents.executeJavaScript("document.querySelector('[data-page=\\\"connections\\\"]')?.click()").catch(()=>{});});
      note.show();
     }catch{}
    }
   }
  },{root:core.root});
  const prefsFile=path.join(app.getPath('userData'),'updates.json');const prefs={get:()=>{try{return JSON.parse(fs.readFileSync(prefsFile)).autoDownload;}catch{return true;}},set:(_,value)=>atomicJSON(prefsFile,{autoDownload:value})};
  updateController=createUpdateController({app,autoUpdater:require('electron-updater').autoUpdater,store:prefs,emit:s=>emit('updates:state',s)});updateController.init();
  session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
  win=new BrowserWindow({show:!core.settings().startHidden||(!CI_SMOKE&&!accountAuth.isSignedIn()),...require('./window-layout.cjs').windowLayout(require('electron').screen.getPrimaryDisplay().workArea),title:'Red-XAI Bridge',icon:path.join(__dirname,'assets','bridge-icon.png'),backgroundColor:'#101219',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.cjs')}});
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==UI&&url!==LOGIN_UI)e.preventDefault();});win.setMenuBarVisibility(false);
  win.on('close',e=>{if(!quitting&&core.settings().keepRunning){e.preventDefault();win.hide();}});
  const icon=nativeImage.createFromPath(path.join(__dirname,'assets','bridge-icon.png')).resize({width:20,height:20});
  tray=new Tray(icon);if(process.platform==='darwin')tray.setTitle('RX');tray.setToolTip('RedXDexAiBridge — computer access');tray.setContextMenu(Menu.buildFromTemplate([{label:'Open RedXDexAiBridge',click:show},{label:'STOP all computer control',click:stopEverything},{type:'separator'},{label:'Quit bridge and disconnect',click:()=>{quitting=true;app.quit();}}]));tray.on('click',show);
  if(CI_SMOKE||(accountAuth.isSignedIn()&&(!platformConfig.required||accountPlatform.state?.accepted)))await startGateway();
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){console.error('SMOKE gateway ready');setTimeout(()=>console.error('SMOKE frame',win.webContents.getURL(),'loading',win.webContents.isLoading()),3000);}
  const rendererErrors=[];win.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)rendererErrors.push(event.message);});
   await win.loadFile(path.join(__dirname,(CI_SMOKE||accountAuth.isSignedIn())?'index.html':'sign-in.html'));
  if(AUTH_SMOKE){
   const result=await win.webContents.executeJavaScript("(async()=>({title:document.title,quickButton:!!document.getElementById('quick-start'),manualForm:!!document.getElementById('manual-form'),sourceFile:location.pathname,privilegedIPCRejected:await window.bridge.snapshot().then(()=>false,()=>true)}))()");
   result.gatewayLocked=!gateway&&!fs.existsSync(path.join(core.root,'runtime.json'));
   result.accountLocked=!accountAuth.isSignedIn();
   const out=process.env.REDXDEX_AUTH_SMOKE_OUTPUT;fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
   if(!result.gatewayLocked||!result.accountLocked||!result.quickButton||!result.manualForm||!result.privilegedIPCRejected)throw Error('Red-XAI authentication gate smoke failed');
   quitting=true;app.exit(0);return;
  }
  // DMG, AppImage and Debian packages cannot provide the interactive NSIS optional-tools page.
  // Offer a first-run explanation without installing system packages or bypassing consent.
  if(app.isPackaged&&process.platform!=='win32'&&!process.env.REDXDEX_SMOKE_OUTPUT&&win.isVisible()){
   const notice=path.join(app.getPath('userData'),'optional-tools-onboarding.json');
   if(!fs.existsSync(notice)){
    atomicJSON(notice,{shownAt:new Date().toISOString()});
    const prompt=setTimeout(async()=>{
     if(!win||win.isDestroyed())return;
     const choice=await dialog.showMessageBox(win,{type:'info',buttons:['Not now','Review optional installations'],defaultId:0,cancelId:0,
      title:'Optional developer tools',message:'Node.js, Git and GitHub CLI are optional.',
      detail:'Node.js runs scripts and builds the Bridge from source. Git supports local repository commands. GitHub CLI supports repository sign-in and terminal workflows. The installed Bridge and public software updates work without them. Nothing is installed without consent.'});
     if(choice.response===1)await win.webContents.executeJavaScript("document.querySelector('[data-page=\\\"settings\\\"]')?.click()").catch(()=>{});
    },650);prompt.unref?.();
   }
  }
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test')))console.error('SMOKE UI loaded');
  if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){
   await new Promise(r=>setTimeout(r,1200));console.error('SMOKE snapshot requested');
   const result=await win.webContents.executeJavaScript(`(async()=>{const s=await window.bridge.snapshot();return {title:document.title,version:s.version,tools:s.toolCount,gateway:s.gateway.running,pages:document.querySelectorAll('.page').length,visibleVersion:document.getElementById('app-version').textContent,preload:typeof window.bridge.answer==='function'};})()`);
   console.error('SMOKE snapshot returned');result.navigation=await win.webContents.executeJavaScript(`(()=>{const out=[];for(const b of document.querySelectorAll('[data-page]')){b.click();out.push({page:b.dataset.page,visible:!document.getElementById('page-'+b.dataset.page).hidden});}return out;})()`);
   if(result.navigation.some(x=>!x.visible))throw Error('A navigation page did not open');
    result.quickSetup=await win.webContents.executeJavaScript("(async()=>{const check=await window.bridge.quickSetup();const ai=await window.bridge.addAi('generic','One Click CI Fixture');return {gatewayRunning:check.gatewayRunning,permissionDefault:check.permissionDefault,kind:ai.kind,generatedCredential:typeof ai.oneTimeInstructions==='string'&&ai.oneTimeInstructions.includes('Bearer '),clientAdded:!!ai.clientId,buttonFound:!!document.getElementById('quick-computer-setup'),selectorFound:!!document.getElementById('quick-ai-kind')};})()");
    if(!result.quickSetup.gatewayRunning||!result.quickSetup.generatedCredential||!result.quickSetup.clientAdded||!result.quickSetup.buttonFound||!result.quickSetup.selectorFound||result.quickSetup.permissionDefault!=='ask')throw Error('One-click setup smoke test failed');
   // Verify actual terminal work continues after the user closes the window to tray.
   const nodeBin=require('./platform.cjs').findExecutable('node');
   if(!nodeBin)throw Error('Smoke requires Node.js for background job verification');
   if(!core.settings().keepRunning)core.saveSettings({...core.settings(),keepRunning:true});
   win.close();if(win.isDestroyed()||win.isVisible())throw Error('Closing to tray must keep the gateway running without showing the window');
   const bg=core.processes.start({command:nodeBin,args:['-e',"setTimeout(()=>process.stdout.write('BACKGROUND_READY'),250)"],cwd:os.tmpdir(),clientId:'smoke-background',timeoutMs:6000});
   let bgState;
   for(let attempt=0;attempt<45;attempt++){
    await new Promise(resolve=>setTimeout(resolve,100));
    bgState=core.processes.read(bg.id,'smoke-background');
    if(!bgState.running)break;
   }
   result.backgroundWhileHidden=!!bgState&&!bgState.running&&bgState.exitCode===0&&bgState.output.includes('BACKGROUND_READY')&&!!gateway?.url;
   result.crawlerTools=core.definitions.filter(tool=>tool.name.startsWith('crawl_')).length;
   if(!result.backgroundWhileHidden||result.crawlerTools!==5)throw Error('Hidden background execution or crawler tools failed');
   win.show();
   console.error('SMOKE navigation returned');const out=process.env.REDXDEX_SMOKE_OUTPUT;fs.mkdirSync(out,{recursive:true});
   result.windowBounds=win.getBounds();result.displayWorkArea=require('electron').screen.getDisplayMatching(result.windowBounds).workArea;
   let captureError;for(let attempt=0;attempt<3;attempt++){try{await new Promise(r=>setTimeout(r,300));console.error('SMOKE page capture attempt',attempt);const image=await Promise.race([win.webContents.capturePage(),new Promise((_,reject)=>setTimeout(()=>reject(Error('UI capture timed out')),5000))]);if(image.isEmpty())throw Error('Empty UI capture');fs.writeFileSync(path.join(out,'ui.png'),image.toPNG());result.uiCapture=true;captureError=null;break;}catch(error){captureError=error;}}
   if(captureError){
    result.uiCapture=false;result.uiCaptureError=captureError.message;
    try {
     const fallback=await Promise.race([native.screenshot(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Desktop fallback capture timed out on this runner')),5000))]);
     fs.writeFileSync(path.join(out,'desktop.png'),Buffer.from(fallback,'base64'));
     result.desktopCaptureFallback=true;
    } catch(error) {
     // A headless CI runner may have no capturable display. Do not hang the
     // complete build: the separate native smoke exercises real desktop input.
     result.desktopCaptureFallback=false;result.desktopCaptureError=error.message;
    }
   }
   fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({...result,rendererErrors},null,2));
   quitting=true;app.exit(0);return;
  }
  if((CI_SMOKE||accountAuth.isSignedIn())&&process.argv.includes('--pair-local-chatgpt'))clientSpec('chatgpt');
  if(gateway&&(process.argv.includes('--connect-remote')||remoteAutoConnect()))tunnel.start(gateway.url).catch(e=>emit('remote',{phase:'error',message:e.message}));
   if(!CI_SMOKE){
    const interval=setInterval(async()=>{
     if(!accountAuth.session||!gateway)return;
     try{
      if(Date.now()-(accountAuth.lastRevalidation||0)>60000){
       await accountAuth.refresh();
       accountAuth.lastRevalidation=Date.now();
      }
      await accountAuth.ensure();
     }catch{await showLogin().catch(()=>{});}
    },30000);interval.unref?.();
   }
  if(core.settings().launchAtLogin&&app.isPackaged){try{require('./startup.cjs').configureStartup(app,true);}catch(error){audit({at:Date.now(),tool:'startup_configuration',clientName:'Desktop',error:true});emit('startup:warning',error.message);}}
  const timer=setTimeout(()=>checkUpdates().catch(e=>emit('updates:state',{...updateController.status(),message:e.message})),15000);timer.unref();
  const interval=setInterval(()=>checkUpdates().catch(()=>{}),6*3600000);interval.unref();
 }).catch(e=>{if(process.env.REDXDEX_SMOKE_OUTPUT&&(!app.isPackaged||process.argv.includes('--self-test'))){fs.mkdirSync(process.env.REDXDEX_SMOKE_OUTPUT,{recursive:true});fs.writeFileSync(path.join(process.env.REDXDEX_SMOKE_OUTPUT,'error.txt'),e.stack||e.message);console.error(e.stack||e.message);quitting=true;app.exit(1);return;}else dialog.showErrorBox('RedXDexAiBridge could not start',e.message);quitting=true;app.quit();});
   ipc('account:status',()=>CI_SMOKE?{signedIn:true,appNumber:6,account:{sub:'ci-fixture',provider:'smoke'}}:accountAuth.status());
  ipc('account:quick:start',()=>accountAuth.quickStart());
  ipc('account:quick:open',()=>shell.openExternal(accountAuth.quickLink()));
  ipc('account:quick:poll',async()=>{const r=await accountAuth.quickPoll();if(r.signedIn)await openAfterLogin();return r;});
  ipc('account:quick:cancel',()=>accountAuth.cancelQuick());
  ipc('account:manual:login',async(login,password)=>{const r=await accountAuth.manualLogin(login,password);if(r.signedIn)await openAfterLogin();return r;});
  ipc('account:manual:2fa',async(code,method)=>{const r=await accountAuth.manual2fa(code,method);if(r.signedIn)await openAfterLogin();return r;});
  ipc('account:logout',async()=>{await shutDownGateway();await accountAuth.logout();await win.loadFile(path.join(__dirname,'sign-in.html'));return {signedIn:false};});
  ipc('account:signup',()=>shell.openExternal('https://red-xai.com/signup'));
  ipc('cli:download',async()=>{const chosen=await dialog.showOpenDialog(win,{title:'Download Red-XAI CLI',properties:['openDirectory','createDirectory']});if(chosen.canceled)return{cancelled:true};const result=await require('./cli-download.cjs').downloadCli({directory:chosen.filePaths[0],onProgress:value=>emit('cli:progress',value)});return{...result,message:'CLI '+result.version+' downloaded to '+result.path+'. Node.js 20 or newer is required to run it.'};});
  ipc('platform:status',async()=>{const me=await accountPlatform.status();emit('platform:state',me);return me;});
  ipc('platform:checkout',async data=>{let result;if(data.kind==='stripe-dashboard'){const status=await accountPlatform.call('/admin/stripe/status');result={url:status.dashboardUrl};}else if(data.kind==='portal')result=await accountPlatform.call('/billing/portal');else result=await accountPlatform.checkout(data);const u=new URL(result.url);if(u.protocol!=='https:'||!['checkout.stripe.com','billing.stripe.com','dashboard.stripe.com'].includes(u.hostname)||u.username||u.password)throw Error('Untrusted payment address');await shell.openExternal(u.href);return{opened:true};});
  ipc('clients:tool-profile',async({profile,name})=>{if(!['terminal','crawler'].includes(profile))throw Error('Choose terminal or crawler');const gatewayInfo=await startGateway(),client=clients.createProfile(name||('My '+profile+' AI'),profile),s=core.settings();s.clientPolicies[client.id]=Object.fromEntries(Object.keys(s.permissions).map(key=>[key,key===(profile==='terminal'?'terminal':'crawl')?'ask':'deny']));s.clientExecution[client.id]='background';core.saveSettings(s);const url=new URL(tunnel.status().phase==='online'?tunnel.status().url:gatewayInfo.url);url.pathname='/'+profile+'/mcp';emit('clients',clients.list());return{...client,profile,url:url.href,warning:'Keep this credential private. New actions require your approval.'};});
  ipc('platform:request',async(route,data={})=>{if(route==='/plugins/checkpoints')return pluginRunner.listCheckpoints();if(route==='/plugins/run')return pluginRunner.run(data,{interactive:true,clientId:'Desktop',transport:'desktop'});const result=await accountPlatform.call(route,data);if(['/legal/accept','/plugins/acquire','/purchase/credits'].includes(route)){await accountPlatform.status();if(platformConfig.required&&accountPlatform.state.accepted)await startGateway();}if(['/account/reset','/account/delete'].includes(route)){await shutDownGateway();await accountAuth.logout();if(route==='/account/reset')await accountPlatform.forgetDevice();await win.loadFile(path.join(__dirname,'sign-in.html'));}return result;});
  ipc('snapshot',()=>runtime());
 ipc('settings:read',()=>core.settings());
 ipc('settings:save',s=>{const old=core.settings();const result=core.saveSettings(s);if(result.emergencyStop){approvals.cancelAll();core.processes.stopAll();core.crawlJobs.stopAll();}if(old.launchAtLogin!==result.launchAtLogin&&app.isPackaged){try{require('./startup.cjs').configureStartup(app,result.launchAtLogin,{remoteAutoConnect:remoteAutoConnect()});}catch(error){core.saveSettings(old);throw error;}}emit('settings',result);return result;});
 ipc('stop:all',()=>stopEverything());
 ipc('folder:pick',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openDirectory']});return r.canceled?null:r.filePaths[0];});
 ipc('approval:answer',(id,choice)=>approvals.resolve(id,choice));
 ipc('clients:revoke',id=>{clients.revoke(id);core.processes.stopClient(id);core.crawlJobs.stopClient(id);core.desktopLease.reset(id);for(const pending of approvals.list())if(pending.clientId===id)approvals.resolve(pending.id,'deny','Client revoked');emit('clients',clients.list());return clients.list();});
 ipc('clients:create',name=>{const c=clients.create(name,'manual');defaultClient(c.id);return c;});
 ipc('setup:localPlugin',()=>{clientSpec('chatgpt');return {message:'Local ChatGPT plugin paired. Enable the RedXDexAiBridge plugin in a client that can execute local MCP tools. Remote ChatGPT sessions still require the HTTPS/OAuth connection.'};});
 ipc('setup:connect',async client=>{await startGateway();const spec=clientSpec(client),r=setup.addClient(client,{spec});emit('clients',clients.list());return r;});
 ipc('setup:config',client=>setup.configFor(client,clientSpec(client)));
  ipc('setup:quick',async()=>{
    const local=await startGateway();
    const nativeStatus=await native.control({action:'status'}).catch(error=>({accessibility:false,inputSupported:false,message:error.message}));
    const checks=quickSetup.readiness({nativeStatus});
    let startupEnabled=false;
    if(app.isPackaged){
      const old=core.settings();
      try{
        require('./startup.cjs').configureStartup(app,true,{remoteAutoConnect:remoteAutoConnect()});
        core.saveSettings({...old,launchAtLogin:true,keepRunning:true});
        startupEnabled=true;
      }catch(error){
        if(!old.launchAtLogin)try{require('./startup.cjs').configureStartup(app,false);}catch{}
        checks.advice.push('Automatic startup could not be enabled: '+error.message);
      }
    }else checks.advice.push('Install the packaged application to enable launch-at-login in one click.');
    return {...checks,gatewayRunning:local.running,gatewayUrl:local.url,startupEnabled,permissionDefault:'ask',message:checks.readyForFullDesktop?'Local bridge is ready. Add an AI next; individual permissions stay on Ask.':'Local gateway is ready. Review desktop permission guidance before enabling input.'};
  });
  ipc('setup:addAI',async(kind,name)=>{
    quickSetup.validateType(kind);
    const local=await startGateway();
    if(kind==='generic'){
      const safeName=quickSetup.validateName(name);
      const c=clients.create(safeName,'manual');
      defaultClient(c.id);
      emit('clients',clients.list());
      return {kind,clientId:c.id,name:c.name,oneTimeInstructions:quickSetup.instructionsFor(kind,{clientName:c.name,url:local.url,token:c.token}),message:'New AI credential created. Copy it now: it cannot be recovered later. Permissions default to Ask. The remote tunnel was NOT enabled.'};
    }
    if(kind==='remote'){
      const status=await tunnel.start(local.url);
      if(status?.phase==='error')throw Error(status.message||'Remote tunnel could not start.');
      rememberRemote(true);
      const verified=status.phase==='online'&&!!status.url;
      return {kind,remoteUrl:verified?status.url:null,connectionPending:!verified,
        oneTimeInstructions:quickSetup.instructionsFor(kind),
        message:verified?'Verified HTTPS MCP endpoint is ready. Connect via OAuth and approve the pairing request in Bridge.':'Starting and verifying the remote tunnel. The HTTPS MCP address will appear here after the bridge confirms it is reachable.'};
    }
    const spec=clientSpec(kind);
    const result=setup.addClient(kind,{spec});
    emit('clients',clients.list());
    return {kind,path:result.path,backup:result.backup,message:result.message+' Permissions default to Ask; no computer access has been silently granted.'};
  });
 ipc('setup:exportVortex',async()=>{
  const result=await dialog.showSaveDialog(win,{title:'Export Vortex MCP connection',defaultPath:path.join(app.getPath('downloads'),'Red-XAI-Bridge-MCP.json'),filters:[{name:'MCP JSON',extensions:['json']}]});
  if(result.canceled||!result.filePath)return {cancelled:true};
  const config=setup.configFor('vortex',clientSpec('vortex'));
  fs.writeFileSync(result.filePath,JSON.stringify(config,null,2)+'\n',{mode:0o600});
  emit('clients',clients.list());
  return {message:'Exported a Vortex-only connection. In Vortex, sign into the intended account, then MCP Servers → Import JSON. Grant the Vortex client permissions in Bridge. No API secret was included in the export.'};
 });

 ipc('setup:diagnostics',async()=>{await startGateway();const spec=clientSpec('Diagnostics');const proc=cp.spawn(spec.command,spec.args,{env:{...process.env,...spec.env},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill();reject(Error('MCP diagnostic timed out'));},5000);proc.stdout.on('data',b=>stdout+=b);proc.stderr.on('data',b=>stderr+=b);proc.on('error',e=>{clearTimeout(timer);reject(e);});proc.on('close',()=>{clearTimeout(timer);try{const r=JSON.parse(stdout.trim().split('\n')[0]);if(!r.result?.serverInfo)throw Error(r.error?.message||stderr||'MCP handshake failed');resolve({ok:true,version:r.result.serverInfo.version});}catch(e){reject(e);}});proc.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'Diagnostics',version:'1'}}})+'\n');});});
 ipc('gateway:start',()=>startGateway());ipc('gateway:status',()=>({running:!!gateway,url:gateway?.url}));
 ipc('gateway:stop',async()=>{approvals.cancelAll('Gateway stopped');core.processes.stopAll();core.crawlJobs.stopAll();tunnel.stop();if(gateway){await gateway.stop();gateway=null;}try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}return {running:false};});
 ipc('remote:mode:read',()=>tunnel.config()||{mode:'temporary',autoConnect:remoteAutoConnect()});
 ipc('remote:mode:save',cfg=>{
   const next=validateRemoteConfig(cfg);
   if(!['named','local','temporary'].includes(next.mode))throw Error('Configure existing VPS relays separately');
   if(next.mode==='named'&&!fs.statSync(next.configFile).isFile())throw Error('Cloudflare YAML configuration not found');
   const file=path.join(core.root,'remote.json');
   if(fs.existsSync(file))fs.copyFileSync(file,path.join(core.root,'remote-backup-'+Date.now()+'.json'),fs.constants.COPYFILE_EXCL);
   atomicJSON(file,next);rememberRemote(next.autoConnect);
   return {saved:true,mode:next.mode,message:'Tunnel mode saved. Restart Bridge to activate it. Existing connections are unchanged until restart.'};
 });
 ipc('remote:start',async()=>{await startGateway();const status=await tunnel.start(gateway.url);if(status.phase!=='error'&&status.mode!=='local')rememberRemote(true);return status;});
 ipc('remote:stop',()=>{rememberRemote(false);return tunnel.stop();});
 ipc('remote:chatgpt-handoff',()=>{
  const message=require('./chatgpt-handoff.cjs').instructionsForChatGPT(tunnel.status());
  clipboard.writeText(message);
  return {copied:true,url:tunnel.status().url,message:'Connection instructions copied. Paste them in ChatGPT to reconnect your existing private Bridge plugin. OAuth approval may be required.'};
 });
 ipc('native:status',async()=>{const helper=await native.control({action:'status'}).catch(e=>({error:e.message}));const status=process.platform==='darwin'?require('electron').systemPreferences.getMediaAccessStatus('screen'):'unknown';return native.permissionStatus(helper,status);});
 ipc('native:settings',section=>{
  if(!['accessibility','screen'].includes(section))throw Error('Unknown settings section');
  if(process.platform==='darwin')return shell.openExternal('x-apple.systempreferences:com.apple.preference.security?'+(section==='screen'?'Privacy_ScreenCapture':'Privacy_Accessibility'));
  if(process.platform==='win32')return shell.openExternal('ms-settings:privacy');
  return dialog.showMessageBox(win,{type:'info',title:'Linux desktop permissions',message:'Screenshots use your graphical desktop/portal. For mouse and keyboard control, use an X11 session and install xdotool from your distribution package manager. Wayland global input is not implemented.'});
 });
 ipc('tool:interactive',(name,args)=>core.perform(name,args,{clientId:'desktop',interactive:true}));
 ipc('clipboard:write',text=>{if(typeof text!=='string'||text.length>65536)throw Error('Invalid clipboard text');clipboard.writeText(text);return true;});
 ipc('resource:open',key=>{const resources={website:'https://red-xai.com',releases:'https://github.com/grimvirusoffical-source/RedXDexAiBridge/releases',source:'https://github.com/grimvirusoffical-source/RedXDexAiBridge',issues:'https://github.com/grimvirusoffical-source/RedXDexAiBridge/issues'};if(!Object.hasOwn(resources,key))throw Error('Unknown resource');return shell.openExternal(resources[key]);});
 ipc('app:version',()=>({version:app.getVersion(),platform:process.platform,arch:process.arch}));
 ipc('updates:status',()=>updateController.status());ipc('app:updates',()=>checkUpdates());ipc('updates:download',async()=>{await configureUpdateFeed();await updateController.download();return updateController.status();});
 ipc('updates:install',()=>{quitting=true;try{return updateController.install();}catch(e){quitting=false;throw e;}});ipc('updates:auto',v=>updateController.setAutoDownload(v));
 ipc('updates:github',async()=>require('./github-cli.cjs').beginLogin({open:url=>shell.openExternal(url)}));
 ipc('github:status',async()=>require('./github-cli.cjs').status());
 ipc('tools:status',()=>require('./optional-tools.cjs').status());
 ipc('optional:install',async tool=>{const {IDS}=require('./optional-tools.cjs');if(!Object.hasOwn(IDS,tool))throw Error('Unknown optional tool');const choice=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Install selected tool'],defaultId:0,cancelId:0,title:'Optional developer tool',message:'Install '+IDS[tool].label+'?',detail:IDS[tool].reason+'\nThe package manager may request operating-system authentication.'});if(choice.response!==1)return {cancelled:true,message:'Installation cancelled'};return require('./optional-install.cjs').begin(tool);});
 ipc('taskbar:pin-status',()=>({available:process.platform==='win32',pending:require('./taskbar-onboarding.cjs').pending(app.getPath('userData'))}));
 ipc('taskbar:pin-dismiss',()=>require('./taskbar-onboarding.cjs').dismiss(app.getPath('userData')));
 ipc('taskbar:pin-guide',async()=>{
  if(process.platform!=='win32')return {opened:false,message:'Taskbar pinning is available only on Windows.'};
  const guide=require('./taskbar-onboarding.cjs');
  guide.dismiss(app.getPath('userData'));
  await shell.openExternal(guide.HELP_URL);
  return {opened:true,message:'Windows lets you right-click the running app icon and choose Pin to taskbar.'};
 });
 ipc('vortex:save',key=>{saveSecret('vortex-key',vortex.validateKey(key));return true;});
 ipc('vortex:status',()=>vortexStatus());
 ipc('vortex:connection',()=>({...vortexConfig(),keySaved:fs.existsSync(secretFile('vortex-key'))}));
 ipc('vortex:endpoint',async value=>{
  const endpoint=vortex.normalizeEndpoint(value);
  if(endpoint!==vortexConfig().endpoint){
   const decision=await dialog.showMessageBox(win,{type:'question',buttons:['Cancel','Use this endpoint'],defaultId:0,cancelId:0,title:'Vortex API connection',message:'Send Vortex requests and your saved API key only to this endpoint?',detail:endpoint+'\nChoose an endpoint you own or trust. The bridge never follows redirects with your key.'});
   if(decision.response!==1)return {cancelled:true};
  }
  atomicJSON(path.join(app.getPath('userData'),'vortex-connection.json'),{endpoint});
  return {endpoint};
 });
 ipc('vortex:chat',(messages,model)=>vortex.chat(readSecret('vortex-key'),messages,model||vortex.DEFAULT_MODEL,globalThis.fetch,vortexConfig()));ipc('vortex:disconnect',()=>{try{fs.unlinkSync(secretFile('vortex-key'));}catch{}return true;});
 app.on('activate',show);app.on('window-all-closed',()=>{if(process.platform!=='darwin'||!core.settings().keepRunning){quitting=true;app.quit();}});
 app.on('before-quit',()=>{quitting=true;approvals?.cancelAll('Bridge is quitting');core.processes.stopAll();core.crawlJobs.stopAll();tunnel?.stop();gateway?.server.closeAllConnections?.();gateway?.server.close();try{fs.unlinkSync(path.join(core.root,'runtime.json'));}catch{}});
}
