'use strict';
const fs=require('node:fs'),path=require('node:path');
const FILE='taskbar-pin-request.txt';
const HELP_URL='https://support.microsoft.com/en-us/windows/experience/personalization/customize-the-taskbar-in-windows';
function marker(userData){
 if(typeof userData!=='string'||!path.isAbsolute(userData))throw Error('Valid application data directory required');
 return path.join(userData,FILE);
}
function pending(userData,{platform=process.platform}={}){
 if(platform!=='win32')return false;
 const stat=fs.lstatSync(marker(userData),{throwIfNoEntry:false});
 return !!stat&&stat.isFile()&&!stat.isSymbolicLink();
}
function dismiss(userData,{platform=process.platform}={}){
 if(platform!=='win32')return {dismissed:false};
 if(!pending(userData,{platform}))return {dismissed:false};
 fs.unlinkSync(marker(userData));
 return {dismissed:true};
}
module.exports={FILE,HELP_URL,marker,pending,dismiss};
