import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {presets} from './engine/presets.js';
import {adjustmentKeys} from './engine/editor-engine.js';

const references=new URL('../references/',import.meta.url);
const normalize=text=>text.normalize('NFKC').toLowerCase();
function matches(query,tag){
  const term=normalize(tag);
  if(/^[a-z0-9][a-z0-9 .%-]*$/.test(term)){
    const escaped=term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(query);
  }
  return query.includes(term);
}
function fail(code,message){throw Object.assign(new Error(message),{code});}
async function catalog(){
  const index=JSON.parse(await readFile(new URL('knowledge-index.json',references),'utf8'));
  if(index.schemaVersion!==1||!Array.isArray(index.entries))fail('INDEX_INVALID','知识索引格式不正确，请重新安装完整 Skill。');
  return index;
}
async function section(entry){
  if(!/^[a-z][a-z-]*\.md$/.test(entry.file))fail('REFERENCE_PATH','知识文件必须来自 references 内的 Markdown。');
  const path=new URL(entry.file,references),text=await readFile(path,'utf8');
  const lines=text.split('\n'),head='## '+entry.section,start=lines.indexOf(head);
  if(start<0)fail('SECTION_MISSING',`找不到 ${entry.file} 的「${entry.section}」，请更新 Skill。`);
  let end=start+1;while(end<lines.length&&!lines[end].startsWith('## '))end++;
  return {path:fileURLToPath(path),line:start+1,text:lines.slice(start,end).join('\n').trim()};
}
export async function runKnowledge(command='help',options={}){
  if(command==='help')return {commands:['search --query <问题或风格名> [--limit 5]','read --id <search 返回的 id>','check'],note:'本地关键词检索；不读取用户照片、不调用模型。知识判断仍须实际看图。'};
  const index=await catalog();
  if(command==='search'){
    const query=normalize(String(options.query||'').trim()),limit=options.limit===undefined?5:Number(options.limit);
    if(!query||query.length>600)fail('QUERY','请提供 1～600 字的问题、题材、手段或风格名。');
    if(!Number.isInteger(limit)||limit<1||limit>8)fail('LIMIT','检索数量应为 1～8。');
    const ranked=index.entries.map(entry=>{
      const matched=entry.tags.filter(tag=>matches(query,tag));
      const score=matched.reduce((sum,tag)=>sum+Math.min(12,[...tag].length),0);
      return {entry,matched,score};
    }).filter(result=>result.score>0).sort((a,b)=>b.score-a.score);
    const results=[];
    for(const {entry,matched} of ranked.slice(0,limit)){
      const {path,line}=await section(entry);
      results.push({id:entry.id,kind:entry.kind,title:entry.section,path,line,matched,...(entry.presetId?{presetId:entry.presetId}:{})});
    }
    return {query:options.query,method:'keyword',results,...(!results.length?{next:'没有关键词匹配。参考 SKILL.md 知识导航，或用题材/处理手段/作者名重试；这不表示照片没有问题。'}:{})};
  }
  if(command==='read'){
    const entry=index.entries.find(item=>item.id===options.id);
    if(!entry)fail('UNKNOWN_TOPIC','知识 id 不存在。先用 search 查询或查看 SKILL.md 的知识导航。');
    return {id:entry.id,kind:entry.kind,...await section(entry)};
  }
  if(command==='check'){
    const ids=new Set(),files=new Set(),headers=new Map(),presetIds=new Set(presets.map(p=>p.id));
    for(const entry of index.entries){
      if(typeof entry.id!=='string'||ids.has(entry.id))fail('DUPLICATE_ID',`重复或无效 id：${entry.id}`);
      ids.add(entry.id);
      if(!Array.isArray(entry.tags)||!entry.tags.length||entry.tags.some(t=>typeof t!=='string'||!t.trim()))fail('TAGS_INVALID',`标签无效：${entry.id}`);
      const actual=await section(entry);files.add(entry.file);
      if(!headers.has(entry.file))headers.set(entry.file,new Set());
      if(headers.get(entry.file).has(entry.section))fail('DUPLICATE_SECTION',`重复章节：${entry.file} / ${entry.section}`);
      headers.get(entry.file).add(entry.section);
      if(entry.presetId){
        if(!presetIds.has(entry.presetId))fail('PRESET_MISSING',`风格不存在：${entry.presetId}`);
        if(!actual.text.includes(`id：${entry.presetId}。`))fail('PRESET_REFERENCE',`章节未声明对应真实风格：${entry.id}`);
      }
    }
    for(const file of await readdir(references))if(file.endsWith('.md')){
      const text=await readFile(new URL(file,references),'utf8');
      for(const line of text.split('\n').filter(line=>line.startsWith('## ')))if(!headers.get(file)?.has(line.slice(3)))fail('UNINDEXED_SECTION',`未索引：${file} / ${line.slice(3)}`);
    }
    const documentedPresets=index.entries.filter(e=>e.presetId).map(e=>e.presetId);
    if(new Set(documentedPresets).size!==presets.length)fail('PRESET_COVERAGE','风格知识未覆盖全部真实预设。');
    if(JSON.stringify([...index.adjustmentKeys].sort())!==JSON.stringify([...adjustmentKeys].sort()))fail('CONTROLS_CHANGED','引擎参数发生变化，需要同步知识参考。');
    return {sections:ids.size,files:files.size,presets:presets.length,controls:adjustmentKeys.length,reviewedAt:index.reviewedAt,note:'结构、章节、风格和参数对应检查通过；不代表摄影画质或视频效果已通过。'};
  }
  fail('UNKNOWN_COMMAND','未知命令，运行 help 查看 search/read/check。');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    const [command,...rest]=process.argv.slice(2),options={};
    for(let i=0;i<rest.length;i+=2){if(!/^--(query|id|limit)$/.test(rest[i])||rest[i+1]===undefined)fail('ARGUMENT','选项需要值：--query、--id 或 --limit。');options[rest[i].slice(2)]=rest[i+1];}
    console.log(JSON.stringify({ok:true,...await runKnowledge(command,options)},null,2));
  }catch(error){console.log(JSON.stringify({ok:false,error:{code:error.code||'KNOWLEDGE_ERROR',message:error.message}},null,2));process.exitCode=1;}
}
