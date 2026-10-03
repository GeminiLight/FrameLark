import {photoTools,applyToolEffect} from './engine/photo-tools/registry.js';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
process.once('disconnect',()=>process.exit(0));
process.once('message',async job=>{
  try{
    const {operation,context,preview}=job;
    const result=photoTools.execute(operation,{...context,outputs:new Map(context.outputs)}),state=applyToolEffect(context.state,result.effect);
    let rendered;
    if(preview?.project){
      const {createRenderSession}=await import('./render.mjs'),p=structuredClone(preview.project),key='tool-stage-preview';
      p.versions.push({id:key,state,parentId:p.currentId,createdAt:new Date().toISOString()});p.currentId=key;
      const frame=await (await createRenderSession(preview.folder,p)).renderFrame(key,{maxSide:512});
      rendered={width:frame.width,height:frame.height,pixelHash:frame.pixelHash,frameSpecHash:frame.frameSpecHash,png:frame.png.toString('base64')};
    }else if(preview?.image){
      const {createCanvas,loadImage,ImageData}=await import('@napi-rs/canvas');
      const {drawPhotoSource}=await import('./engine/photo-geometry.js');
      const {renderPhotoPixels}=await import('./engine/photo-rendering.js');
      const {combineSettings}=await import('./engine/editor-engine.js');
      const {presetById}=await import('./engine/presets.js');
      const bytes=Buffer.from(preview.image.split(',')[1],'base64'),sharp=(await import('sharp')).default,metadata=await sharp(bytes,{limitInputPixels:50_000_000}).metadata();
      if((metadata.pages||1)>1||Math.max(metadata.width,metadata.height)>16384||metadata.width*metadata.height>50_000_000)throw Object.assign(new Error('工具图片超过静态图像限制。'),{code:'TOOL_IMAGE_SIZE'});
      const image=await loadImage(bytes),W=context.source.width,H=context.source.height,box=state.crop||{x:0,y:0,width:1,height:1};
      const ratio=Math.min(1,512/Math.max(box.width*W,box.height*H)),width=Math.max(1,Math.round(box.width*W*ratio)),height=Math.max(1,Math.round(box.height*H*ratio));
      const canvas=createCanvas(width,height),ctx=canvas.getContext('2d'),frame={fullWidth:W,fullHeight:H,angle:box.angle||0,sourceRect:{x:box.x*W,y:box.y*H,width:box.width*W,height:box.height*H}};
      // The compressed source represents the entire original canvas; its geometry
      // is restored before applying the same shared render pipeline.
      drawPhotoSource(ctx,image,box,width,height,frame.sourceRect,{width:W,height:H});
      const settings=combineSettings({settings:state.settings},{settings:presetById(state.style?.id)?.adjustments,amount:(state.style?.amount||0)/100});
      const pixels=renderPhotoPixels({pixels:ctx.getImageData(0,0,width,height).data,width,height,settings,annotations:state.locals,crop:box,frame});
      ctx.putImageData(new ImageData(pixels,width,height),0,0);const png=canvas.toBuffer('image/png');
      rendered={width,height,pixelHash:hash(Buffer.from(pixels)),frameSpecHash:hash(JSON.stringify(frame)),png:png.toString('base64')};
    }
    process.send({ok:true,result,preview:rendered,pid:process.pid},()=>process.exit(0));
  }catch(error){process.send({ok:false,error:{code:error.code||'TOOL_EXECUTION_FAILED',message:error.code?error.message:'工具执行失败。请检查本地图片处理依赖后重试。'}},()=>process.exit(1));}
});
