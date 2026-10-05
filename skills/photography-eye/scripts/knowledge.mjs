#!/usr/bin/env node
import {readFile,readdir} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const excluded=new Set(['sources.md','evaluation.md']);
// Query expansion is a routing aid; it never turns inferred scene details into facts.
export function expandQuery(query){
  const aliases=[
    [/浓缩|拿铁|咖啡|(?:杯.*勺|勺.*杯)/u,'咖啡 食物 静物'],
    [/猫|狗|宠物/u,'宠物 动物'],
    [/扭头|拍糊|跑动|动来动去/u,'运动 快门 对焦'],
    [/看不见脸|背对|背向|互相靠/u,'人物 手势 朝向 背向'],
    [/映出|映着|反光玻璃|窗子/u,'玻璃 反射 遮挡'],
    [/(?:没法|不能|无法).*(?:挪|移动|走)|轮椅|移动受限/u,'用户无法走动 当前位置'],
    [/拉近镜头|拉远镜头/u,'变焦 视点 透视'],
    [/iPhone|没有手动模式/iu,'手机'],
    [/感光度|感度/u,'ISO 曝光 自动ISO'],
    [/背影|背对|看镜头|露正脸/u,'人物 朝向 背向'],
    [/小格|站位.*设置|每张.*参数/u,'参考板 候选 机位 参数'],
    [/随手.*(?:怎么拍|找|取)|(?:图|画面).*(?:找.*照片|截取|裁取)/u,'现场 取景 已有画面'],
    [/四条边|截哪|裁哪里/u,'原片 边界 四边 裁取']
  ];
  return query+' '+aliases.filter(([pattern])=>pattern.test(query)).map(([,words])=>words).join(' ');
}
export function tokenize(text){
  const terms=[];
  for(const run of String(text).normalize('NFKC').toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]+/gu)||[]){
    if(/^[a-z0-9]/.test(run))terms.push(run);
    else if(run.length===1)terms.push(run);
    else for(let i=0;i<run.length-1;i++)terms.push(run.slice(i,i+2));
  }
  return terms;
}
// IDs are explicit and survive heading reorder/insertion. Missing IDs fail loudly.
export function parseKnowledgeSections(file,text){
  const lines=text.split('\n');const sections=[];let start=-1;const ids=new Set();
  function append(end){
    if(start<0)return;
    const id=lines[start+1]?.match(/^<!-- knowledge-id: ([a-z0-9-]+#[1-9][0-9]*) -->$/)?.[1];
    if(!id||!id.startsWith(basename(file,'.md')+'#'))throw new Error(file+':'+(start+1)+' 缺少或错误的稳定knowledge-id');
    if(ids.has(id))throw new Error('重复知识条目编号：'+id);ids.add(id);
    sections.push({id,file:'references/'+file,line:start+1,heading:lines[start].slice(3),body:lines.slice(start+2,end).join('\n').trim()});
  }
  for(let i=0;i<lines.length;i++)if(lines[i].startsWith('## ')){append(i);start=i;}
  append(lines.length);return sections;
}
export async function indexKnowledge(){
  const files=(await readdir(resolve(root,'references'))).filter(f=>f.endsWith('.md')&&!excluded.has(f)).sort();
  const catalog=await readFile(resolve(root,'references/sources.md'),'utf8');const sourceMap=new Map();
  for(const line of catalog.split('\n')){const id=line.match(/^\| ([TCM]\d{2}) \|/)?.[1];if(id)sourceMap.set(id,[...line.matchAll(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g)].map(m=>({title:m[1],url:m[2]})));}
  const docs=[];
  for(const file of files){
    const text=await readFile(resolve(root,'references',file),'utf8');
    for(const section of parseKnowledgeSections(file,text)){
      const {body,heading}=section;
      const terms=tokenize(heading+' '+heading+' '+body);
      const counts=new Map();for(const term of terms)counts.set(term,(counts.get(term)||0)+1);
      const bodySources=[...new Set(body.match(/\b[TCM]\d{2}\b/g)||[])];
      const intro=text.slice(0,text.indexOf('\n## '));
      const sourceIds=bodySources.length?bodySources:[...new Set(intro.match(/\b[TCM]\d{2}\b/g)||[])];
      docs.push({...section,sourceIds,sourceLinks:sourceIds.flatMap(id=>(sourceMap.get(id)||[]).map(link=>({id,...link}))),sourceScope:bodySources.length?'section':sourceIds.length?'file-introduction':'project-design',terms,counts});
    }
  }
  if(new Set(docs.map(d=>d.id)).size!==docs.length)throw new Error('知识条目编号必须全局唯一');
  return docs;
}
export async function searchKnowledge(query,{limit=3,expand=true}={}){
  if(typeof query!=='string'||query.length>600)throw new Error('查询必须为不超过 600 字符的文本');
  if(!Number.isInteger(limit)||limit<1||limit>8)throw new Error('limit 必须为 1–8');
  const docs=await indexKnowledge();const terms=[...new Set(tokenize(expand?expandQuery(query):query))];
  const avg=docs.reduce((n,d)=>n+d.terms.length,0)/docs.length;
  const df=new Map(terms.map(t=>[t,docs.filter(d=>d.counts.has(t)).length]));
  return docs.map(d=>{
    let score=0;const matched=[];
    for(const t of terms){const tf=d.counts.get(t)||0;if(!tf)continue;matched.push(t);
      const idf=Math.log(1+(docs.length-df.get(t)+0.5)/(df.get(t)+0.5));
      score+=idf*tf*2.2/(tf+1.2*(0.25+0.75*d.terms.length/avg));
    }
    return {id:d.id,file:d.file,line:d.line,heading:d.heading,score:Number(score.toFixed(4)),matched,sourceIds:d.sourceIds,sourceLinks:d.sourceLinks,sourceScope:d.sourceScope,excerpt:d.body.slice(0,500)};
  }).filter(d=>d.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id)).slice(0,limit);
}
export async function readKnowledge(id){
  const doc=(await indexKnowledge()).find(d=>d.id===id);
  if(!doc)throw new Error('未知知识条目编号');
  const {terms,counts,...visible}=doc;return visible;
}
if(process.argv[1]&&pathToFileURL(realpathSync(process.argv[1])).href===import.meta.url){
  try{
    const [command,value,...rest]=process.argv.slice(2);
    if(command==='search')console.log(JSON.stringify(await searchKnowledge(value,{limit:rest[0]==='--limit'?Number(rest[1]):3}),null,2));
    else if(command==='read')console.log(JSON.stringify(await readKnowledge(value),null,2));
    else if(command==='check'){const docs=await indexKnowledge();console.log(JSON.stringify({documents:docs.length,files:new Set(docs.map(d=>d.file)).size,uniqueIds:new Set(docs.map(d=>d.id)).size},null,2));}
    else throw new Error('用法：knowledge.mjs search "问题" [--limit 3] | read "编号" | check');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
