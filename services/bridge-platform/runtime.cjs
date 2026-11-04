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
 let service,state='starting',stopRequested=false,deadline=null,resolveStopped;
 const stopped=new Promise(resolve=>{resolveStopped=resolve;});
 const removeSignals=()=>{signals.removeListener('SIGTERM',onSignal);signals.removeListener('SIGINT',onSignal);};
 const log=(kind,message)=>{try{logger[kind](message);}catch{}};
 function finish(code,message){
  if(state==='stopped')return;
  state='stopped';if(deadline)clearTimeout(deadline);removeSignals();
  if(message)log(code?'error':'log',message);
  setExitCode(code);resolveStopped({code});
 }
 function forceStop(message){
  if(state==='stopped')return;
  finish(1,message);
  try{service.server.closeAllConnections?.();}catch{}
  forceExit(1);
 }
 function stop(){
  stopRequested=true;
  if(state==='starting'||state==='stopped'||state==='stopping')return stopped;
  state='stopping';
  deadline=setTimeout(()=>forceStop(MESSAGES.timeout),shutdownTimeoutMs);
  try{
   service.server.close(error=>{
    if(error&&error.code!=='ERR_SERVER_NOT_RUNNING'){forceStop(MESSAGES.stopFailure);return;}
    finish(0,MESSAGES.stopped);
   });
   service.server.closeIdleConnections?.();
  }catch{forceStop(MESSAGES.stopFailure);}
  return stopped;
 }
 function onSignal(){void stop();}
 signals.once('SIGTERM',onSignal);signals.once('SIGINT',onSignal);
 try{
  service=await createService();
  if(!service?.server||typeof service.listen!=='function')throw Error('Invalid service');
  if(stopRequested){state='running';await stop();return{started:false,stop,stopped};}
  await service.listen();state='running';
  if(stopRequested){await stop();return{started:false,stop,stopped};}
  log('log',MESSAGES.listening);
  return{started:true,stop,stopped};
 }catch{
  try{service?.server?.closeAllConnections?.();service?.server?.close(()=>{});}catch{}
  finish(1,MESSAGES.startupFailure);
  return{started:false,stop,stopped};
 }
}
module.exports={DEFAULT_PORT,DEFAULT_SHUTDOWN_MS,MESSAGES,listenPort,listenLoopback,runProductionService};
