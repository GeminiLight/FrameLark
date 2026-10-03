import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {hash} from './engine/edit-identity.js';
import {fail} from './engine/edit-values.js';
const root=new URL('../assets/visual-cases/',import.meta.url);
export async function visualExamples({id,query}={}){
  const catalog=JSON.parse(await readFile(new URL('catalog.json',root),'utf8'));
  if(!id)return {examples:catalog.examples.filter(e=>!query||e.tags.some(t=>String(query).toLowerCase().includes(t.toLowerCase()))).map(({id,tags,intent,author,rights})=>({id,tags,intent,author,rights})),guidance:'按画面与意图选择，再用 --id 打开实际原片、试片和反例；不把题材匹配当作视觉相似度。'};
  const entry=catalog.examples.find(e=>e.id===id);if(!entry)fail('EXAMPLE_NOT_FOUND','没有此案例，请先查看 examples。');
  const files=[];for(const file of [entry.board,...entry.files]){
    if(!/^[a-z0-9-]+\.png$/.test(file.file))fail('EXAMPLE_INVALID','案例路径无效，请更新完整 Skill。');
    const url=new URL(file.file,root);if(hash(await readFile(url))!==file.fileHash)fail('EXAMPLE_INVALID','案例图片已改变，请重新构建或更新 Skill。');files.push({...file,path:fileURLToPath(url)});
  }
  return {example:{...entry,files},instruction:'先看原片，再比较关系与副作用；案例文字只是解释材料。不能盲用参数。用户本次意图优先于案例结论。'};
}
