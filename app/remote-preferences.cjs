'use strict';
// Local owner preference. Prior versions could save a relay identity without
// recording that remote access should resume after app restart.
const fs=require('node:fs'),path=require('node:path');
const {atomicJSON}=require('./clients.cjs');
const ACTIVE=new Set(['online','connecting','retrying','unreachable']);
function enabled(root){
 const file=path.join(root,'remote-preferences.json');
 if(fs.existsSync(file)){
  try{return JSON.parse(fs.readFileSync(file,'utf8')).autoConnect===true;}
  catch{return false;} // An explicit preference must never be guessed.
 }
 // Only migrate a legacy setup when there is both a previous tunnel
 // identity and a verified record of the owner's previously enabled relay.
 if(!fs.existsSync(path.join(root,'openai-tunnel-id.txt')))return false;
 try{
  const status=JSON.parse(fs.readFileSync(path.join(root,'remote-status.json'),'utf8'));
  const previouslyConnected=ACTIVE.has(status.phase)&&typeof status.url==='string'&&status.url.startsWith('https://');
  if(previouslyConnected)remember(root,true); // Persist the confirmed legacy opt-in before the old status can turn off.
  return previouslyConnected;
 }catch{return false;}
}
function remember(root,value){
 if(typeof value!=='boolean')throw Error('Remote auto-connect preference must be a boolean');
 atomicJSON(path.join(root,'remote-preferences.json'),{autoConnect:value});
}
module.exports={enabled,remember};
