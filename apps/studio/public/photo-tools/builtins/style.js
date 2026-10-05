import {record,number,fail} from '../values.js';
import {presets,presetById} from '../../presets.js';
import {targetLayer} from '../targets.js';
export default {id:'style',title:'风格',description:'全图目标替换当前风格；局部或对象目标将配方光色作为独立局部层。',version:1,targets:['image','region','object','annotation','output'],parameters:record({id:{type:'string',enum:presets.map(p=>p.id)},amount:number(0,100)}),execute(operation,{target,layerId}){
  const {id,amount}=operation.parameters,preset=presetById(id);if(!preset)fail('TOOL_PARAMETER_INVALID','风格不存在。');
  if(target.kind==='image')return {effect:{style:{id,amount}}};
  const settings=Object.fromEntries(Object.entries(preset.adjustments).map(([k,v])=>[k,v*amount/100])),layer=targetLayer(target,layerId||'tool-'+operation.id,operation.title,settings);
  return {effect:{locals:[{id:layer.id,layer}]}};
}};
