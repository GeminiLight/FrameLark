import {record,number,validate,fail} from '../values.js';
import {neutralSettings,limits} from '../../editor-engine.js';
import {targetLayer} from '../targets.js';
export const bounds=key=>limits[key]||(['sharpen','denoise'].includes(key)?[0,75]:[-75,75]);
export function adjustmentTool(id,title,description,keys){
  return {id,title,description,version:1,targets:['image','region','object','annotation','output'],
    parameters:record({
      mode:{type:'string',enum:['delta','absolute']},
      changes:{type:'array',minItems:1,maxItems:12,items:{anyOf:keys.map(key=>{
        const extent=Math.max(Math.abs(bounds(key)[0]),Math.abs(bounds(key)[1]));
        return record({key:{type:'string',enum:[key]},value:number(-extent,extent)});
      })}}
    }),
    execute(operation,{state,target,layerId}){
      const seen=new Set(),current=target.kind==='image'?state.settings:state.locals.find(l=>l.id===target.annotationId)?.localSettings||neutralSettings(),desired={};
      for(const {key,value} of operation.parameters.changes){
        if(seen.has(key))fail('TOOL_PARAMETER_DUPLICATE','同一个工具不能重复设置同一参数。');seen.add(key);
        const next=operation.parameters.mode==='delta'?(current[key]||0)+value:value,[min,max]=bounds(key);
        validate(next,number(min,max));desired[key]=next;
      }
      if(target.kind==='image')return {effect:{settings:desired}};
      const layer=targetLayer(target,layerId||'tool-'+operation.id,operation.title,{...current,...desired});return {effect:{locals:[{id:layer.id,layer}]}};
    }};
}
