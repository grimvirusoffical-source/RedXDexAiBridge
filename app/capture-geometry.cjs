'use strict';
function captureGeometry(display,origin,image){
 const factor=display.scaleFactor;
 for(const n of [origin.x,origin.y,display.bounds.width,display.bounds.height,factor,image.width,image.height])if(!Number.isFinite(n))throw Error('Invalid capture geometry');
 if([display.bounds.width,display.bounds.height,factor,image.width,image.height].some(n=>n<=0))throw Error('Invalid capture dimensions');
 const width=Math.round(display.bounds.width*factor),height=Math.round(display.bounds.height*factor);
 return {coordinateSystem:'physical-pixels',displayId:String(display.id),origin:{x:origin.x,y:origin.y},screenSize:{width,height},imageSize:{width:image.width,height:image.height},imageToScreen:{scaleX:width/image.width,scaleY:height/image.height,offsetX:origin.x,offsetY:origin.y},mapping:'screenX = offsetX + imageX * scaleX; screenY = offsetY + imageY * scaleY. Round to the nearest physical pixel before calling desktop_mouse.'};
}
module.exports={captureGeometry};
