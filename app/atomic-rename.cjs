'use strict';
// A few Windows filesystem filter drivers (including antivirus scanners) hold
// newly written or destination files briefly. Retry only those transient
// access/share violations; never delete the destination to "make room".
const fs=require('node:fs');
const delay=ms=>{const cell=new Int32Array(new SharedArrayBuffer(4));Atomics.wait(cell,0,0,ms);};
function atomicRename(from,to,{platform=process.platform,rename=fs.renameSync,sleep=delay,maxRetries=8}={}){
 if(typeof from!=='string'||typeof to!=='string'||!from||!to)throw Error('Atomic rename requires file paths');
 if(!Number.isInteger(maxRetries)||maxRetries<0||maxRetries>20)throw Error('Invalid atomic rename retry limit');
 for(let attempt=0;;attempt++){
  try{return rename(from,to);}
  catch(error){
   if(platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error?.code)||attempt>=maxRetries)throw error;
   sleep(Math.min(200,25*(attempt+1)));
  }
 }
}
module.exports={atomicRename};
