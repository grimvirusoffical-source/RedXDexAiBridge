'use strict';
function windowLayout(area){
 if(!area||!['x','y','width','height'].every(k=>Number.isFinite(area[k]))||area.width<1||area.height<1)throw Error('Invalid display work area');
 const width=Math.max(1,Math.min(1240,Math.floor(area.width))),height=Math.max(1,Math.min(860,Math.floor(area.height)));
 return {x:Math.round(area.x+(area.width-width)/2),y:Math.round(area.y+(area.height-height)/2),width,height,minWidth:Math.min(920,width),minHeight:Math.min(650,height)};
}
module.exports={windowLayout};
