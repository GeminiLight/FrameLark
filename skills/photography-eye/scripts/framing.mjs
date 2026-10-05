#!/usr/bin/env node
import {pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';

// Numeric geometry only; scene contents, occlusion and reachability need visual review.
export function checkFraming({sourceWidth,sourceHeight,box,orientation='free',aspectRatio=null}){
  const errors=[];
  if(!Number.isInteger(sourceWidth)||sourceWidth<=0||!Number.isInteger(sourceHeight)||sourceHeight<=0)errors.push('源图尺寸必须为正整数像素');
  if(!['portrait','landscape','square','free'].includes(orientation))errors.push('未知画幅方向');
  if(aspectRatio!==null&&(!Number.isFinite(aspectRatio)||aspectRatio<=0))errors.push('目标宽高比必须为正数');
  const coordinates=box&&[box.x,box.y,box.width,box.height];
  const boxValid=coordinates&&coordinates.every(n=>Number.isFinite(n)&&n>=0&&n<=1)&&box.width>0&&box.height>0&&box.x+box.width<=1+1e-9&&box.y+box.height<=1+1e-9;
  if(!boxValid)errors.push('归一化取景框须完整位于原图内且宽高大于0');
  if(errors.length)return {valid:false,numericOnly:true,errors};
  const pixelWidth=box.width*sourceWidth,pixelHeight=box.height*sourceHeight,ratio=pixelWidth/pixelHeight;
  const actualOrientation=Math.abs(ratio-1)<=1e-9?'square':ratio<1?'portrait':'landscape';
  if(orientation!=='free'&&actualOrientation!==orientation)errors.push('取景框实际为'+actualOrientation+'，与'+orientation+'标注不一致');
  if(aspectRatio!==null&&Math.abs(ratio/aspectRatio-1)>0.005)errors.push('实际取景比例与目标比例相差超过0.5%');
  return {valid:!errors.length,numericOnly:true,pixelWidth,pixelHeight,aspectRatio:ratio,actualOrientation,errors};
}

if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url){
  try{
    const args=process.argv.slice(2);
    if(args.length<6||args.length>8)throw new Error('用法：framing.mjs 源图宽 源图高 x y 框宽 框高 [portrait|landscape|square|free] [目标宽高比]');
    const [sourceWidth,sourceHeight,x,y,width,height]=args.slice(0,6).map(Number);
    const result=checkFraming({sourceWidth,sourceHeight,box:{x,y,width,height},orientation:args[6]||'free',aspectRatio:args[7]===undefined?null:Number(args[7])});
    console.log(JSON.stringify(result,null,2));if(!result.valid)process.exitCode=1;
  }catch(error){console.error(error.message);process.exitCode=1;}
}
