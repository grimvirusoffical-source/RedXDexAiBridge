'use strict';
const crypto=require('node:crypto');

const ORIGIN='https://red-xai.com';
const ROOT=ORIGIN+'/redxai-connect';
const CLIENT='bridge';
const CODE=/^[A-Za-z0-9_-]{43}$/;

function validConsentURL(input){
  const url=new URL(input);
  return url.origin===ORIGIN &&
    ['/redxai-connect','/redxai-connect/','/redxai-connectx'].includes(url.pathname) &&
    !url.search && !url.username && !url.password &&
    /^#request=[A-Za-z0-9_-]{43}$/.test(url.hash);
}
async function checkProductionAuth({request=globalThis.fetch}={}){
  // This check intentionally has no user credentials, cookies or server secrets.
  const options={redirect:'error',cache:'no-store',signal:AbortSignal.timeout(12000)};
  const metadata=await request(ROOT+'/config',options);
  if(!metadata.ok)throw Error('Quick Login discovery returned HTTP '+metadata.status);
  const response=await metadata.json();
  if(response.protocol!=='redx-site-session-v1'||
     response.issuer!==ORIGIN||
     !Array.isArray(response.supported_clients)||
     !response.supported_clients.includes(CLIENT)){
    throw Error('Production Quick Login has not deployed the Bridge client. Blocking desktop release to prevent account lockout.');
  }
  const verifier=crypto.randomBytes(32).toString('base64url');
  const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
  const start=await request(ROOT+'/start',{...options,method:'POST',
    headers:{'content-type':'application/json',accept:'application/json'},
    body:JSON.stringify({client_id:CLIENT,code_challenge:challenge,code_challenge_method:'S256'})});
  if(!start.ok)throw Error('Production Quick Login rejected Bridge app authorization (HTTP '+start.status+')');
  const job=await start.json();
  if(!CODE.test(job.device_code||'')||
     !/^[A-Za-z0-9]{8}$/.test(job.user_code||'')||
     !validConsentURL(job.verification_uri)||
     job.protocol!=='redx-site-session-v1'||
     !Number.isInteger(job.expires_in)||job.expires_in<1||job.expires_in>300){
    throw Error('Production Quick Login returned an invalid Bridge consent challenge.');
  }
  return {ready:true,clientId:CLIENT,issuer:ORIGIN};
}

if(require.main===module){
  checkProductionAuth().then(result=>{
    process.stdout.write('Production Bridge login ready: '+result.clientId+'\n');
  }).catch(error=>{
    process.stderr.write('RELEASE BLOCKED: '+error.message+'\n');
    process.exitCode=1;
  });
}
module.exports={checkProductionAuth,validConsentURL};
