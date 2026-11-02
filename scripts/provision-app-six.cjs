'use strict';
// Server-side RedX migration for Red-XAI's numeric app catalog and user-app usage table.
// NEVER run this inside the desktop application or ship RedX service credentials in a client.
// Dry-run by default. Only an authorized Accounts/RedX operator may use --apply.
const crypto=require('node:crypto');
const APP_ID=6;
const DB='redxai_accounts';
const APP_PATH='rxa-app-registry.red-xai.db:App[ID=6]';
const SCHEMA_PATH='rxa-user-apps.red-xai.db:Schema[ID=6]';
const USAGE_FILE='rxa-user-apps.red-xai.db';
function numericUsageID(verifiedSubject){
 if(typeof verifiedSubject!=='string'||!verifiedSubject||verifiedSubject.length>256)
  throw Error('A verified Red-XAI account subject is required');
 const digest=crypto.createHash('sha256').update(verifiedSubject+'\x00'+APP_ID).digest('hex');
 return parseInt(digest.slice(0,13),16); // 52-bit numeric RedX record ID
}
function apiURL(base,record){
 const u=new URL(base);
 if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')
  throw Error('The RedX endpoint must be a trusted HTTPS origin');
 return u.origin+'/v1/db/'+DB+'/path/'+encodeURIComponent(record);
}
async function migrate({base,key,apply=false,request=globalThis.fetch}){
 if(typeof key!=='string'||!key.trim()||key.length<16)throw Error('A server-side scoped RedX key is required');
 const definitions=[
  {path:APP_PATH,value:{appId:APP_ID,name:'Red-XAI Bridge',clientId:'bridge',scope:'bridge.app',status:'reserved'}},
  {path:SCHEMA_PATH,value:{appId:APP_ID,kind:'UserApp',recordFile:USAGE_FILE,
   keyRule:'first-52-bits-sha256(verified-account-sub + nul + appId)',
   fields:['accountSub','appId','firstUsedMs','lastLoginMs','lastUsedMs','loginCount']}}
 ];
 const results=[];
 for(const definition of definitions){
  const url=apiURL(base,definition.path);
  const headers={Authorization:'Bearer '+key,Accept:'application/json'};
  const response=await request(url,{method:'GET',headers,redirect:'error',
   signal:AbortSignal.timeout(10000)});
  if(response.status===200){
   // Do not overwrite a pre-existing app ID or schema, even if another service created it.
   results.push({path:definition.path,status:'exists (not modified; review ownership before use)'});
   continue;
  }
  if(response.status!==404)throw Error('RedX refused catalog inspection: HTTP '+response.status);
  if(!apply){results.push({path:definition.path,status:'would create'});continue;}
  const put=await request(url,{method:'PUT',redirect:'error',headers:{
   ...headers,'Content-Type':'application/json'},
   body:JSON.stringify({value:definition.value}),signal:AbortSignal.timeout(10000)});
  if(!put.ok)throw Error('RedX refused new table initialization: HTTP '+put.status);
  results.push({path:definition.path,status:'created'});
 }
 return {appId:APP_ID,database:DB,dryRun:!apply,results};
}
if(require.main===module){
 const apply=process.argv.includes('--apply');
 const base=process.env.REDXAI_REDX_URL||'';
 const key=process.env.REDXAI_REDX_KEY||'';
 migrate({base,key,apply}).then(result=>{
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
 }).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
}
module.exports={migrate,numericUsageID,apiURL,APP_ID,APP_PATH,SCHEMA_PATH};
