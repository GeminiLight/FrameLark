import {isDeepStrictEqual} from 'node:util';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const digest=value=>createHash('sha256').update(value).digest('hex');
const invalid=message=>{throw Object.assign(new Error(message),{code:'POLICY_INVALID'});};

// Selection is bounded and reproducible. Explicit topics are also available to a host
// that has inspected the image; matching words never counts as visual observation.
export function policyTopics({question='',intent='',subject=''}={}) {
  const text=[question,intent,subject].join(' '),topics=[];
  if(/曝光|明暗|亮|白平衡|肤色|色彩|颜色|exposure|light|color/i.test(text))topics.push('light-color');
  if(/裁剪|扶正|构图|crop|straighten|composition/i.test(text))topics.push('composition');
  if(/细节|噪|锐化|羽化|边缘|detail|noise|sharp/i.test(text))topics.push('detail');
  if(/专家|大师|作品参考|expert|photographer/i.test(text))topics.push('expert');
  if(/生成|移除|去掉|换天|generat|remove|replace/i.test(text))topics.push('generated');
  return topics.slice(0,3);
}

export async function loadRetouchPolicy({task='plan',topics=[]}={}) {
  const manifest=JSON.parse(await readFile(new URL('policy/manifest.json',root),'utf8'));
  if(!Object.hasOwn(manifest.tasks,task)||!Array.isArray(topics)||topics.length>3||topics.some(id=>!Object.hasOwn(manifest.references,id)))invalid('策略需要 diagnosis/plan/audit 与最多三个已登记参考主题。');
  const core=await readFile(new URL('policy/'+manifest.core,root),'utf8');
  const references=await Promise.all([...new Set([...manifest.tasks[task],...topics])].map(async id=>{
    const path='references/'+manifest.references[id],content=await readFile(new URL(path,root),'utf8');
    return {id,path,hash:digest(content),content};
  }));
  const identity={version:manifest.version,task,coreHash:digest(core),references:references.map(({content,...identity})=>identity)};
  const provenance={...identity,bundleHash:digest(JSON.stringify(identity))};
  return {provenance,core,references,instructions:[core,...references.map(r=>`参考 ${r.id}（${r.path}）：\n${r.content}`)].join('\n\n')};
}

export async function verifyPolicyProvenance(value) {
  if(!value||typeof value!=='object'||!Array.isArray(value.references))invalid('缺少策略与实际加载参考记录。');
  const manifest=JSON.parse(await readFile(new URL('policy/manifest.json',root),'utf8'));
  const bundle=await loadRetouchPolicy({task:value.task,topics:value.references.filter(r=>!manifest.tasks[value.task]?.includes(r.id)).map(r=>r.id)});
  if(!isDeepStrictEqual(bundle.provenance,value))invalid('策略版本或参考内容已变化，请重新加载策略后编写方案。');
  return structuredClone(bundle.provenance);
}
