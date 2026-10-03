import {record,number,text,identifier,point,rect,validate,cleanRect,fail} from './values.js';
import {viewToOriginalPoint,transformRect} from '../photo-geometry.js';
const exclusions={type:'array',maxItems:8,items:rect};
const common={rect,feather:number(0,1),exclude:exclusions};
export const maskSchema={anyOf:[
  record({shape:{type:'string',enum:['rectangle','radial']},...common}),
  record({shape:{type:'string',enum:['linear']},...common,start:point,end:point}),
  record({shape:{type:'string',enum:['brush']},...common,points:{type:'array',minItems:1,maxItems:600,items:point},radius:number(.001,.15)})
]};
export const targetSchema={anyOf:[
  record({kind:{type:'string',enum:['image']}}),
  record({kind:{type:'string',enum:['region']},coordinateSpace:{type:'string',enum:['original','view']},mask:maskSchema}),
  record({kind:{type:'string',enum:['object']},name:{...text(100),minLength:1},source:{type:'string',enum:['vision','user']},confidence:{type:'string',enum:['high','medium','low']},coordinateSpace:{type:'string',enum:['original','view']},mask:maskSchema}),
  record({kind:{type:'string',enum:['annotation']},id:identifier}),
  record({kind:{type:'string',enum:['output']},operationId:identifier})
]};
export function normalizeMask(mask){
  validate(mask,maskSchema);const out=structuredClone(mask);out.rect=cleanRect(mask.rect);out.exclude=mask.exclude.map(cleanRect);return out;
}
export function normalizeTarget(target,{state,source,inputCrop=state.crop,notes=[]}={}){
  validate(target,targetSchema);
  if(target.kind==='image'||target.kind==='output')return structuredClone(target);
  if(target.kind==='annotation'){
    const layer=state.locals.find(l=>l.id===target.id)||notes.find(n=>n.id===target.id);if(!layer)fail('TOOL_TARGET_MISSING','标记已删除，请读取最新范围。');
    return {kind:'region',annotationId:target.id,localAmount:layer.localAmount??100,localEnabled:layer.localEnabled!==false,coordinateSpace:'original',mask:{shape:layer.maskType||'rectangle',rect:structuredClone(layer.rect),feather:layer.feather??.36,exclude:structuredClone(layer.exclude||[]),...(layer.maskType==='linear'?{start:layer.start,end:layer.end}:{}),...(layer.maskType==='brush'?{points:layer.points,radius:layer.brushRadius}:{})}};
  }
  const out=structuredClone(target);out.mask=normalizeMask(target.mask);
  if(target.coordinateSpace==='view'){
    if(!source?.width||!source?.height)fail('TOOL_GEOMETRY_REQUIRED','转换工具范围需要原片尺寸。');
    const convert=p=>viewToOriginalPoint(p,inputCrop,source.width,source.height),box=r=>{
      const result=transformRect(r,convert);if(!result)fail('TOOL_TARGET_OUTSIDE','工具范围不在原片中。');return cleanRect(result);
    };
    out.mask.rect=box(out.mask.rect);out.mask.exclude=out.mask.exclude.map(box);
    if(out.mask.start){out.mask.start=convert(out.mask.start);out.mask.end=convert(out.mask.end);}
    if(out.mask.points)out.mask.points=out.mask.points.map(convert);
    out.coordinateSpace='original';
  }
  return out;
}
export function resolveTarget(target,outputs){
  if(target.kind!=='output')return target;
  const result=outputs.get(target.operationId)?.target;
  if(!result)fail('TOOL_OUTPUT_MISSING','依赖工具没有生成可用范围。');return result;
}
export function targetLayer(target,id,title,settings){
  if(target.kind==='image')fail('TOOL_TARGET_INVALID','这个操作需要局部范围。');
  const m=target.mask;
  return {id:target.annotationId||id,rect:structuredClone(m.rect),note:target.kind==='object'?target.name:title,maskType:m.shape,feather:m.feather,exclude:structuredClone(m.exclude),localAmount:target.localAmount??100,localEnabled:target.localEnabled!==false,localSettings:settings,...(m.shape==='linear'?{start:m.start,end:m.end}:{}),...(m.shape==='brush'?{points:m.points,brushRadius:m.radius}:{}),target:target.kind==='object'?{kind:'object',name:target.name,source:target.source,confidence:target.confidence}:undefined};
}
