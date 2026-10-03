import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {loadProject,findVersion} from './project.mjs';
import {createRenderSession} from './render.mjs';
import {object,settingsBounds,fail} from './engine/edit-values.js';
import {assertGuards} from './engine/edit-guards.js';
import {adjustmentKeys} from './engine/editor-engine.js';

export async function probeControl(folder,value){
  object(value,['revision','versionId','parameter','values','maxSide'],'PROBE_INVALID');
  if(!Number.isInteger(value.revision)||!adjustmentKeys.includes(value.parameter)||!Array.isArray(value.values)||value.values.length<2||value.values.length>7||new Set(value.values).size!==value.values.length||!Number.isInteger(value.maxSide)||value.maxSide<512||value.maxSide>1600)fail('PROBE_INVALID','试条需当前版本、一个实际参数、2～7 个不同目标值和 512～1600 查看尺寸。');
  const [min,max]=settingsBounds(value.parameter);if(value.values.some(n=>!Number.isFinite(n)||n<min||n>max))fail('PROBE_INVALID','参数试条数值超出引擎范围。');
  const p=await loadProject(folder);if(p.revision!==value.revision)fail('STALE_REVISION','项目已更新，请重新读取。');
  const base=findVersion(p,value.versionId),versions=value.values.map((n,i)=>({...structuredClone(base),id:'probe-'+randomUUID(),name:String(n),state:{...structuredClone(base.state),settings:{...base.state.settings,[value.parameter]:n}}}));
  for(const v of versions)assertGuards(base.state,v.state);
  // This is a read-only render snapshot, not an edit of the photo's history.
  const session=await createRenderSession(folder,{...p,versions:[...p.versions,...versions],candidates:p.candidates});
  const frames=[];for(const v of versions)frames.push(await session.renderFrame(v.id,{maxSide:value.maxSide}));
  const cellW=400,cellH=310,canvas=createCanvas(cellW*frames.length,cellH),ctx=canvas.getContext('2d');ctx.fillStyle='#202425';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.font='15px sans-serif';
  for(let i=0;i<frames.length;i++){const f=frames[i],scale=Math.min((cellW-24)/f.width,(cellH-48)/f.height),w=f.width*scale,h=f.height*scale;ctx.drawImage(await loadImage(f.png),i*cellW+(cellW-w)/2,14,w,h);ctx.fillStyle='#dfcfb5';ctx.fillText(value.parameter+' = '+value.values[i],i*cellW+12,cellH-14);}
  const dir=path.join(folder,'probes',randomUUID());await mkdir(dir,{recursive:true});const file=path.join(dir,'control.png');await writeFile(file,canvas.toBuffer('image/png'),{mode:0o600});
  const report={path:file,revision:p.revision,baseVersion:base.id,parameter:value.parameter,values:value.values,frames:frames.map((f,i)=>({value:value.values[i],width:f.width,height:f.height,pixelHash:f.pixelHash,frameSpecHash:f.frameSpecHash,stats:f.stats})),limitations:['固定同一基础、画幅和已有图层；只改变一个手动绝对目标。','统计与试条不自动决定优劣；查看单版完整图和关键细节再选择。','颜色控制仅响应引擎定义的颜色范围；不是 Lightroom 单位或 RAW 标定。']};
  await writeFile(path.join(dir,'manifest.json'),JSON.stringify(report,null,2),{mode:0o600});return report;
}
