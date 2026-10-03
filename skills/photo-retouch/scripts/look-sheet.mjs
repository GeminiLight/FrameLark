import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {createRenderSession} from './render.mjs';
import {findVersion,publicProject,fail,localFailure} from './project.mjs';
import {object} from './engine/edit-values.js';
import {letteringCapabilities} from './text-overlays.mjs';

// One snapshot for every tile: comparisons never compile on top of another trial.
export async function renderLookSheet(folder,value){
  object(value,['revision','versions','mode','referenceVersion'],'LOOK_SHEET_INVALID');
  const session=await createRenderSession(folder),p=session.project,mode=value.mode||'composition';
  if(!Number.isInteger(value.revision)||value.revision!==p.revision)fail('STALE_REVISION','请用最新 revision 比较试片。');
  if(!['composition','color'].includes(mode)||!Array.isArray(value.versions)||value.versions.length<2||value.versions.length>6||value.versions.some(v=>typeof v!=='string'))fail('LOOK_SHEET_INVALID','比较 2～6 个明确的版本；mode 为 composition 或 color。');
  const versions=value.versions.map(key=>findVersion(p,key));
  if(new Set(versions.map(v=>v.id)).size!==versions.length)fail('LOOK_SHEET_INVALID','比较版本重复；original/current 可能指向同一版本。');
  if(mode==='composition'&&value.referenceVersion!==undefined)fail('LOOK_SHEET_INVALID','构图比较使用各自画幅，不需要 referenceVersion。');
  const reference=mode==='color'?findVersion(p,value.referenceVersion||'current'):null;
  const stale=new Set(publicProject(p).candidates.filter(c=>c.stale).map(c=>c.id));
  if([...versions,reference].filter(Boolean).some(v=>stale.has(v.id)))fail('STALE_CANDIDATE','照片或意图已变化，请重新试片后比较。');
  const columns=versions.length===3?3:2,tileWidth=600,tileHeight=460,padding=20;
  const canvas=createCanvas(columns*tileWidth,Math.ceil(versions.length/columns)*tileHeight+44),drawing=canvas.getContext('2d'),previews=[];
  const fonts=letteringCapabilities().fonts,cjk=fonts.cjkSans||fonts.cjkSerif,family=cjk||fonts.sans||'sans-serif';
  const font=(size,bold=false)=>`${bold?'bold ':''}${size}px "${family}"`;
  drawing.fillStyle='#1d2022';drawing.fillRect(0,0,canvas.width,canvas.height);
  drawing.fillStyle='#e5d9c8';drawing.font=font(16);drawing.fillText(cjk?(mode==='color'?'光色比较 · 相同裁剪与倍率':'构图比较 · 每版保留自己的画幅'):(mode==='color'?'Color comparison / same crop and scale':'Composition comparison / individual framing'),padding,28);
  for(let i=0;i<versions.length;i++){
    const version=versions[i],x=i%columns*tileWidth+padding,y=Math.floor(i/columns)*tileHeight+44;
    const record={versionId:version.id,name:version.name,selectionHash:version.selectionHash||null,retainedArea:1};
    try{
      const options=mode==='color'?{referenceCrop:reference.state.crop}:{};
      const preview=await session.previewPhoto(version.id,options),image=await loadImage(preview.path),scale=Math.min((tileWidth-2*padding)/image.width,370/image.height);
      drawing.drawImage(image,x+(tileWidth-2*padding-image.width*scale)/2,y+(370-image.height*scale)/2,image.width*scale,image.height*scale);
      Object.assign(record,{path:preview.path,pixelHash:preview.pixelHash,frameSpec:preview.frameSpec,retainedArea:Number((preview.frameSpec.sourceRect.width*preview.frameSpec.sourceRect.height/(p.source.width*p.source.height)).toFixed(4))});
    }catch(error){record.error=localFailure(error);drawing.fillStyle='#d3b9ac';drawing.font=font(16);drawing.fillText(cjk?'此版本预览失败，请恢复后重试':'Preview failed / restore and retry',x+20,y+180);}
    const candidate=p.candidates.some(c=>c.id===version.id);
    record.label=cjk||!/[\u2E80-\u9FFF\uF900-\uFAFF]/u.test(version.name)?version.name.slice(0,40):`Look ${i+1}`;
    drawing.fillStyle='#e9dfd2';drawing.font=font(17,true);drawing.fillText(record.label,x,y+398,tileWidth-2*padding);
    drawing.fillStyle='#a8acaf';drawing.font=font(14);drawing.fillText(record.error?record.error.code:cjk?`保留 ${(record.retainedArea*100).toFixed(1)}% 画面 · ${candidate?'未接受试片':'已保存版本'}`:`Retains ${(record.retainedArea*100).toFixed(1)}% / ${candidate?'Trial':'Saved'}`,x,y+423);
    previews.push(record);
  }
  const root=path.resolve(folder),directory=path.join(root,'comparisons');await mkdir(directory,{recursive:true});
  const file=path.join(directory,`${mode}-${randomUUID()}.png`);await writeFile(file,canvas.toBuffer('image/png'),{flag:'wx',mode:0o600});
  return {path:file,revision:p.revision,mode,referenceVersion:reference?.id||null,labelLanguage:cjk?'zh':'en',previews,complete:previews.every(v=>!v.error),detail:'联系图用于选择光色或构图方向；不能代替单图、同位置细节与实际导出检查，也不代表自动审美排名。'};
}
