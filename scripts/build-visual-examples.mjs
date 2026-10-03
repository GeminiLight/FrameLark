import {mkdtemp,mkdir,rm,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {initProject,loadProject,createCandidate} from '../skills/guangjian-retouch/scripts/project.mjs';
import {renderFrame} from '../skills/guangjian-retouch/scripts/render.mjs';
import {renderLookSheet} from '../skills/guangjian-retouch/scripts/look-sheet.mjs';
import {hash} from '../skills/guangjian-retouch/scripts/engine/edit-identity.js';
const root=fileURLToPath(new URL('../',import.meta.url)),dest=path.join(root,'skills/guangjian-retouch/assets/visual-cases');
const cases=[
 {id:'portrait-natural',source:'portrait.png',author:'NASA / Eileen Collins',rights:'public domain',tags:['人像','肤色','portrait','skin'],intent:'保留日光下自然肤色和表情，不漂白皮肤',preserve:['肤色与暖光','衣服与背景的明暗分离'],trial:{exposure:.05,contrast:5,highlights:-5,shadows:3,warmth:-2,sharpen:2},failure:{exposure:.3,warmth:50,saturation:35,highlights:30,clarity:35},check:['检查脸部是否偏橘','额头与领口的高光过渡','真实纹理与锐化边缘']},
 {id:'still-life-preserve',source:'still-life.png',author:'Rachel Michetti / Pikolo Espresso Bar',rights:'CC0',tags:['静物','咖啡','暖木','中性','still-life'],intent:'保留暖木与白瓷的日常温度，原片可以成立',preserve:['白瓷与暖木的材料关系','自然暖光'],trial:null,failure:{exposure:.25,warmth:-65,tint:10,saturation:-20},check:['不能把暖木和奶泡当成灰卡','检查强行校冷后的杯子与木桌','保留原片也是有效选择']},
 {id:'night-layers',source:'night.png',author:'SpaceX',rights:'public domain',tags:['夜景','火箭','灯光','层次','night'],intent:'保留蓝调环境与发射台灯光的层次',preserve:['夜景暗部重量','暖灯与冷天光'],trial:{contrast:7,shadows:3,highlights:-12,denoise:8},failure:{exposure:1.5,shadows:50,blacks:20,denoise:65,warmth:40,contrast:-10,saturation:25},check:['暗部是否被抬成灰雾','灯光周边和天空过渡','降噪是否损失发射台细节']}
];
await mkdir(dest,{recursive:true});const temp=await mkdtemp(path.join(os.tmpdir(),'frameyn-examples-')),entries=[];
try{
 for(const c of cases){
  const folder=path.join(temp,c.id),source=path.join(root,'test/web/fixtures/quality',c.source);await initProject(source,folder,{intent:c.intent});
  const versions=['original'];if(c.trial){let p=await loadProject(folder),r=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,name:'温和试片',settings:c.trial});versions.push(r.candidate.id);}
  let p=await loadProject(folder),r=await createCandidate(folder,{revision:p.revision,baseVersion:p.currentId,name:'过度处理反例',settings:c.failure});versions.push(r.candidate.id);p=await loadProject(folder);
  const sheet=await renderLookSheet(folder,{revision:p.revision,versions,mode:'color',referenceVersion:'original'}),files=[];
  for(let i=0;i<versions.length;i++){const frame=await renderFrame(folder,versions[i],{maxSide:1400}),name=c.id+'-'+(i===0?'original':i===versions.length-1?'failure':'trial')+'.png';await writeFile(path.join(dest,name),frame.png);files.push({role:i===0?'original':i===versions.length-1?'failure':'trial',file:name,fileHash:hash(frame.png),pixelHash:frame.pixelHash,width:frame.width,height:frame.height});}
  const boardName=c.id+'-board.png',board=await readFile(sheet.path);await writeFile(path.join(dest,boardName),board);
  entries.push({...c,source:undefined,originalChecksum:hash(await readFile(source)),sourceURL:'https://scikit-image.org/docs/stable/api/skimage.data.html',board:{file:boardName,fileHash:hash(board)},files,reviewStatus:'illustrative; host visual review required',limitations:['低分辨率公开样张；不是所有肤色、相机噪声或高分辨率质量的基准。','trial 是可比较候选，不是通用最佳参数；failure 针对本条意图制造反例。']});
 }
 await writeFile(path.join(dest,'catalog.json'),JSON.stringify({schema:1,examples:entries},null,2)+'\n');console.log(JSON.stringify({examples:entries.length,directory:dest}));
}finally{await rm(temp,{recursive:true,force:true});}
