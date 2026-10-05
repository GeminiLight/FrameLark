import {readFile} from 'node:fs/promises';
import {indexKnowledge,searchKnowledge} from '../skills/photography-eye/scripts/knowledge.mjs';
const directory='skills/photography-eye/';const docs=await indexKnowledge();const ids=new Set(docs.map(d=>d.id));
const reports=[];
for(const [file,keys] of [['retrieval.json',['development','holdout']],['retrieval-next.json',['cases']],['retrieval-finishing.json',['cases']]]){
 const suite=JSON.parse(await readFile(directory+'evals/'+file,'utf8'));
 for(const key of keys){const rows=[];for(const c of suite[key]){for(const id of c.expected)if(!ids.has(id))throw new Error('测试目标不存在：'+id);const result=await searchKnowledge(c.query);rows.push({id:c.id,hit:result.some(r=>c.expected.includes(r.id)),ranked:result.map(r=>r.id)});}reports.push({file,split:key,label:suite.label||'已见测试集回归，不是新保留集',passed:rows.filter(r=>r.hit).length,total:rows.length,failures:rows.filter(r=>!r.hit)});}
}
const catalog=await readFile(directory+'references/sources.md','utf8');const knownSources=new Set([...catalog.matchAll(/^\| ([TCM]\d{2}) \|/gm)].map(m=>m[1]));
for(const d of docs)for(const id of d.sourceIds)if(!knownSources.has(id))throw new Error('来源不存在：'+id);
const behaviors=JSON.parse(await readFile(directory+'evals/evals.json','utf8'));
const scouts=JSON.parse(await readFile(directory+'evals/scout-to-shot.json','utf8'));
const routes=JSON.parse(await readFile(directory+'evals/retrieval-route.json','utf8'));
const routing=[];for(const c of routes.cases){
  for(const id of c.expected)if(!ids.has(id))throw new Error('路由测试目标不存在：'+id);
  const query=c.user+'；'+c.terms;
  const raw=await searchKnowledge(c.user),result=await searchKnowledge(query);
  routing.push({id:c.id,user:c.user,evidence:c.evidence,conditions:c.conditions,query,rawRanked:raw.map(r=>r.id),ranked:result.map(r=>r.id),hit:result.some(r=>c.expected.includes(r.id))});
}
console.log(JSON.stringify({knowledge:{documents:docs.length,files:new Set(docs.map(d=>d.file)).size,sources:knownSources.size,uniqueIds:ids.size},behaviorScenarios:behaviors.length+scouts.length,scoutScenarios:scouts.length,behaviorScenariosExecutedByThisCommand:0,retrieval:reports,queryRouting:{label:routes.method,modelExtractionTested:false,passed:routing.filter(r=>r.hit).length,total:routing.length,rows:routing}},null,2));
if(reports.some(r=>r.passed<r.total)||routing.some(r=>!r.hit))process.exitCode=1;
