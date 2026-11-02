'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const VERSION='26.18.0';
const ORIGINAL_SHA256='74c4dbb4163cdd90ca4850b75d304e916235c882d6af7b5cdad63bffbc977072';
const banner='    !ifdef HEADER_ICO\n      SpiderBanner::Show /MODERN /ICON "$PLUGINSDIR\\installerHeaderico.ico"\n    !else\n      SpiderBanner::Show /MODERN\n    !endif\n\n    FindWindow $0 "#32770" "" $hwndparent\n    FindWindow $0 "#32770" "" $hwndparent $0\n    GetDlgItem $0 $0 1000\n    SendMessage $0 ${WM_SETTEXT} 0 "STR:$(installing)"';
const replacement='    ; Red-XAI: the MUI page displays the real native progress and status.';
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function prepareTemplate(input,version){
 if(version!==VERSION)throw new Error('Review the NSIS theme patch before updating electron-builder.');
 const source=input.replace(/\r\n/g,'\n');
 // Idempotence does not relax the pin: reverse precisely our two edits first.
 const restored=source.includes(replacement)?source.replace(replacement,banner).replace('  SetDetailsPrint textonly','  SetDetailsPrint none'):source;
 if(digest(restored)!==ORIGINAL_SHA256)throw new Error('Unrecognized NSIS install template; refusing to change installer logic.');
 return restored.replace(banner,replacement).replace('  SetDetailsPrint none','  SetDetailsPrint textonly');
}
function main(){
 const packagePath=require.resolve('app-builder-lib/package.json');
 const filename=path.join(path.dirname(packagePath),'templates','nsis','installSection.nsh');
 const original=fs.readFileSync(filename,'utf8'),patched=prepareTemplate(original,require(packagePath).version);
 if(original!==patched)fs.writeFileSync(filename,patched);
 console.log('Verified pinned NSIS template: native MUI theme and live status enabled.');
}
if(require.main===module)main();
module.exports={prepareTemplate,ORIGINAL_SHA256};
