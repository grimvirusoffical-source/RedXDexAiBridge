'use strict';
const DEFAULT_PORT=17783,DEFAULT_SHUTDOWN_MS=30000;
const MESSAGES=Object.freeze({
 listening:'Bridge platform listening on loopback with verified account integration',
 startupFailure:'Bridge platform configuration or account authority is not ready; no service started',
 stopped:'Bridge platform stopped',
 stopFailure:'Bridge platform could not stop cleanly',
 timeout:'Bridge platform shutdown timed out; pending connections were closed'
});
function listenPort(value){
 if(value===undefined)return DEFAULT_PORT;
 if(!Number.isSafeInteger(value)||value<1||value>65535)throw Error('Invalid Bridge platform listen port');
 return value;
}
function listenLoopback(server,value){
 const port=listenPort(value);
 return new Promise((resolve,reject)=>{
  const failed=error=>{server.removeListener('listening',ready);server.removeListener('error',failed);reject(error);};
  const ready=()=>{server.removeListener('error',failed);resolve(server.address());};
  server.once('error',failed);server.once('listening',ready);
  try{server.listen(port,'127.0.0.1');}catch(error){failed(error);}
 });
}
async function runProductionService({createService,signals=process,logger=console,setExitCode=code=>{process.exitCode=code;},forceExit=code=>process.exit(code),shutdownTimeoutMs=DEFAULT_SHUTDOWN_MS}={}){
 if(typeof createService!=='function'||!Number.isSafeInteger(shutdownTimeoutMs)||shutdownTimeoutMs<1||shutdownTimeoutMs>DEFAULT_SHUTDOWN_MS)throw Error('Invalid Bridge platform runtime dependencies');
 let service,state='starting',stopRequested=false,deadline=null,earlyCloseRequested=false,resolveStopped;
 const stopped=new Promise(resolve=>{resolveStopped=resolve;});
 const removeSignals=()=>{signals.removeListener('SIGTERM',onSignal);signals.removeListener('SIGINT',onSignal);};
 const log=(kind,message)=>{try{logger[kind](message);}catch{}};
 function closeLateService(){
  try{service?.server?.closeAllConnections?.();}catch{}
  try{service?.server?.close(()=>{});}catch{}
 }
 function finish(code,message){
  if(state==='stopped')return;
  state='stopped';if(deadline)clearTimeout(deadline);deadline=null;removeSignals();
  if(message)log(code?'error':'log',message);
  setExitCode(code);resolveStopped({code});
 }
 function forceStop(message){
  if(state==='stopped')return;
  finish(1,message);closeLateService();forceExit(1);
 }
 function armDeadline(){
  if(!deadline&&state!=='stopped')deadline=setTimeout(()=>forceStop(MESSAGES.timeout),shutdownTimeoutMs);
 }
 function closeDuringStartup(){
  if(earlyCloseRequested||!service?.server)return;
  earlyCloseRequested=true;
  // Stop admission if listen has already opened a socket, but do not claim
  // completion until construction/listen settles or the original deadline fires.
  try{
   service.server.close(error=>{if(error&&error.code!=='ERR_SERVER_NOT_RUNNING')forceStop(MESSAGES.stopFailure);});
   service.server.closeIdleConnections?.();
  }catch{forceStop(MESSAGES.stopFailure);}
 }
 function drain(){
  if(state==='stopped'||state==='stopping')return stopped;
  state='stopping';
  try{
   service.server.close(error=>{
    if(error&&error.code!=='ERR_SERVER_NOT_RUNNING'){forceStop(MESSAGES.stopFailure);return;}
    finish(0,MESSAGES.stopped);
   });
   service.server.closeIdleConnections?.();
  }catch{forceStop(MESSAGES.stopFailure);}
  return stopped;
 }
 function stop(){
  stopRequested=true;
  if(state==='stopped')return stopped;
  // The first stop request is bounded even while the factory or listen promise
  // is unresolved. Later completions may close resources but cannot restart.
  armDeadline();
  if(state==='starting'){closeDuringStartup();return stopped;}
  return drain();
 }
 function onSignal(){void stop();}
 signals.once('SIGTERM',onSignal);signals.once('SIGINT',onSignal);
 try{
  service=await createService();
  if(state==='stopped'){closeLateService();return{started:false,stop,stopped};}
  if(!service?.server||typeof service.listen!=='function')throw Error('Invalid service');
  if(stopRequested){await drain();return{started:false,stop,stopped};}
  await service.listen();
  if(state==='stopped'){closeLateService();return{started:false,stop,stopped};}
  if(stopRequested){await drain();return{started:false,stop,stopped};}
  state='running';log('log',MESSAGES.listening);
  return{started:true,stop,stopped};
 }catch{
  closeLateService();finish(1,MESSAGES.startupFailure);
  return{started:false,stop,stopped};
 }
}
module.exports={DEFAULT_PORT,DEFAULT_SHUTDOWN_MS,MESSAGES,listenPort,listenLoopback,runProductionService};
