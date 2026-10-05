import {presetById} from '../presets.js';
import {splitSettings} from './tools.js';
import {contentHash} from './identity.js';
import {identifier,number,fail} from './values.js';
export function presetCommands(presetId,amount,{groupId,title}={}){
  const preset=presetById(presetId);if(!preset)fail('TOOL_VERSION_UNSUPPORTED','风格配方不存在。');number(amount,0,100);identifier(groupId);
  const settings=Object.fromEntries(Object.entries(preset.adjustments).map(([key,value])=>[key,value*amount/100])),recipe=splitSettings(settings),provenance={kind:'preset',presetId,presetVersion:1,presetHash:contentHash(preset.adjustments),amount};
  return [{type:'AddGroup',group:{id:groupId,title:title||preset.name,provenance}},...recipe.map((value,index)=>({type:'AddStep',step:{id:(groupId.slice(0,60)+'-'+index+'-'+value.tool).slice(0,80),title:(title||preset.name)+' · '+value.tool,...value,groupId,provenance}}))];
}
