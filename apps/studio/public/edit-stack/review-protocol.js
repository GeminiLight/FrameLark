const text=(max=400)=>({type:'string',minLength:1,maxLength:max});
const list=(items,maxItems,minItems=0)=>({type:'array',items,maxItems,minItems});
const record=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const dimension=['subject','composition','order','light','color','emotion','detail'];
const rect=record(Object.fromEntries(['x','y','width','height'].map(k=>[k,{type:'number',minimum:0,maximum:1}])));
export const diagnosisContentSchema=record({
  goal:text(500),preserve:list(text(),6,1),checked:list(text(),8,1),
  findings:list(record({id:text(80),dimension:{type:'string',enum:dimension},area:text(),rect:{anyOf:[{type:'null'},rect]},observation:text(),impact:text(),action:text(),check:text(),tradeoff:text(),priority:{type:'string',enum:['blocking','optional']},confidence:{type:'string',enum:['high','medium','low']}},['id','dimension','area','observation','impact','action','check','tradeoff','priority','confidence']),12),
  colorIntent:{anyOf:[{type:'null'},record({main:text(),accent:text(),neutralReferences:list(text(),4),avoid:text()})]}
},['goal','preserve','checked','findings']);
export const auditContentSchema=record({decision:{type:'string',enum:['ready','revise','reject']},summary:text(1200),checked:list(text(300),8,1),strengths:list(text(300),6),issues:list(record({area:text(80),observation:text(),nextAction:text(),severity:{type:'string',enum:['blocking','minor']}}),8),resolutions:list(record({findingId:text(80),status:{type:'string',enum:['resolved','preserved','unresolved']},evidence:text(500)}),12)},['decision','summary','checked','strengths','issues']);

function reject(code,message){throw Object.assign(new Error(message),{code});}
function validate(value,schema,code,path='record') {
  if(schema.anyOf){for(const option of schema.anyOf){try{validate(value,option,code,path);return;}catch{}}reject(code,`${path} 格式无效。`);}
  if(schema.type==='null'){if(value!==null)reject(code,`${path} 应为空。`);return;}
  if(schema.type==='object'){
    if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!Object.hasOwn(schema.properties,k))||schema.required.some(k=>!Object.hasOwn(value,k)))reject(code,`${path} 字段不完整或包含未知字段。`);
    for(const [key,v] of Object.entries(value))validate(v,schema.properties[key],code,path+'.'+key);return;
  }
  if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<schema.minItems||value.length>schema.maxItems)reject(code,`${path} 数量无效。`);
    value.forEach(v=>validate(v,schema.items,code,path));return;
  }
  if(schema.type==='string'&&(typeof value!=='string'||!value.trim()||value.length>(schema.maxLength??Infinity)))reject(code,`${path} 需要具体文字。`);
  if(schema.type==='number'&&(!Number.isFinite(value)||value<schema.minimum||value>schema.maximum))reject(code,`${path} 数值无效。`);
  if(schema.enum&&!schema.enum.includes(value))reject(code,`${path} 不在允许范围。`);
}
export function normalizeDiagnosisContent(value){
  validate(value,diagnosisContentSchema,'DIAGNOSIS_INVALID');
  if(new Set(value.findings.map(f=>f.id)).size!==value.findings.length)reject('DIAGNOSIS_INVALID','诊断问题编号重复。');
  for(const f of value.findings)if(f.rect&&(f.rect.width<=0||f.rect.height<=0||f.rect.x+f.rect.width>1.001||f.rect.y+f.rect.height>1.001))reject('DIAGNOSIS_INVALID','诊断范围超出原片。');
  return {...structuredClone(value),findings:value.findings.map(f=>{const copy=structuredClone(f);if(copy.rect===null)delete copy.rect;return copy;}),colorIntent:value.colorIntent||null};
}
export function normalizeAuditContent(value){
  validate(value,auditContentSchema,'AUDIT_INVALID');
  if(value.decision==='ready'&&value.issues.some(i=>i.severity==='blocking'))reject('AUDIT_NOT_READY','仍有阻碍交付的问题，不能记为 ready。');
  if(value.decision!=='ready'&&!value.issues.length)reject('AUDIT_INVALID','修改或撤回需至少一个具体问题。');
  const resolutions=value.resolutions||[];
  if(new Set(resolutions.map(r=>r.findingId)).size!==resolutions.length)reject('AUDIT_INVALID','诊断复评编号重复。');
  return {...structuredClone(value),resolutions:structuredClone(resolutions)};
}

// Ordinary browser analysis is a draft without file-project pixel identity.
// Persisting it as authoritative requires recordDiagnosis and a verified preview.
export function analysisDiagnosis(analysis,goal='保留原有表达，改善明确的画面阻碍') {
  const observations=Object.entries(analysis.observations||{}),preserve=observations.filter(([,o])=>o.verdict==='keep').map(([,o])=>o.finding).slice(0,6);
  return normalizeDiagnosisContent({goal:goal||'保留原有表达，改善明确的画面阻碍',preserve:preserve.length?preserve:['保留原片与当前构图，具体值得保留的关系待确认'],checked:['输入的整幅预览；未审核原尺寸导出'],findings:observations.filter(([,o])=>o.verdict==='improve').map(([id,o])=>({id,dimension:id==='background'?'subject':id,area:o.location||'整幅画面',...(o.region?{rect:o.region}:{}),observation:o.evidence,impact:o.finding,action:analysis.recommendations?.find(r=>r.observationIds?.includes(id))?.goal||'先比较有依据的可撤回试片',check:o.condition,tradeoff:analysis.recommendations?.find(r=>r.observationIds?.includes(id))?.caution||'修改后复看值得保留的画面关系',priority:'optional',confidence:o.confidence})),colorIntent:null});
}
