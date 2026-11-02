'use strict';

// The Bridge offers an endpoint handoff, not a credential or an OAuth bypass.
// A copied URL is only ready once its protected-resource metadata is verified.
function verifiedEndpoint(status) {
 if(!status||status.phase!=='online'||typeof status.url!=='string')throw Error('Start the remote connection and wait until the HTTPS endpoint is verified.');
 let url;
 try { url=new URL(status.url); } catch { throw Error('The remote connection URL is invalid'); }
 if(url.protocol!=='https:'||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password||
    !url.hostname.includes('.')||url.hostname==='localhost'||url.hostname.length>253) {
  throw Error('The verified MCP endpoint must be a plain public HTTPS /mcp URL');
 }
 return url.href;
}
function instructionsForChatGPT(status) {
 const url=verifiedEndpoint(status);
 return [
  'Reconnect my existing private Red-XAI Bridge plugin to the Bridge on my computer.',
  '',
  'Verified HTTPS MCP endpoint: '+url,
  '',
  'Update this existing plugin connection to use the endpoint above. Keep its plugin identity, OAuth authentication, permissions, and other settings unchanged. Do not create a duplicate plugin. Verify the new endpoint and tell me if OAuth reauthorization is required.',
  '',
  'This message contains the public endpoint address only, not an authentication token.'
 ].join('\n');
}
function newEndpoint(previous,status){
 if(!status||status.phase!=='online'||!status.url)return false;
 try{return verifiedEndpoint(status)!==previous;}catch{return false;}
}
module.exports={verifiedEndpoint,instructionsForChatGPT,newEndpoint};
