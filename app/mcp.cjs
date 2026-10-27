'use strict';
if(process.env.REDXDEX_CLIENT_KEY_FILE){require('./adapter.cjs');}else{
 // Unpaired compatibility mode exposes discovery only, never computer controls.
 const readline=require('node:readline'),{dispatch}=require('./protocol.cjs');
 readline.createInterface({input:process.stdin,crlfDelay:Infinity}).on('line',async line=>{
  try{if(Buffer.byteLength(line)>1048576)throw Error('Request too large');const m=JSON.parse(line);let r;
   if(m.method==='tools/call')r={jsonrpc:'2.0',id:m.id,result:{isError:true,content:[{type:'text',text:'Pair this AI from the running RedXDexAiBridge app before using computer tools.'}]}};
   else r=await dispatch(m);if(r)process.stdout.write(JSON.stringify(r)+'\n');
  }catch{process.stderr.write('Invalid MCP input\n');}
 });
}
