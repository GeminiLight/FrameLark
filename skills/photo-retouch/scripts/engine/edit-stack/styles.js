import {applyCommands} from './commands.js';
import {createDocument} from './document.js';
import {presetById} from '../presets.js';
import {splitSettings} from './tools.js';
import {contentHash} from './identity.js';
import {identifier,number,fail,derivedTitle} from './values.js';
export function presetCommands(presetId,amount,{groupId,title}={}){
  const preset=presetById(presetId);if(!preset)fail('TOOL_VERSION_UNSUPPORTED','风格配方不存在。');number(amount,0,100);identifier(groupId);
  const settings=Object.fromEntries(Object.entries(preset.adjustments).map(([key,value])=>[key,value*amount/100])),recipe=splitSettings(settings),provenance={kind:'preset',presetId,presetVersion:1,presetHash:contentHash(preset.adjustments),amount};
  return [{type:'AddGroup',group:{id:groupId,title:title||preset.name,provenance}},...recipe.map((value,index)=>({type:'AddStep',step:{id:(groupId.slice(0,60)+'-'+index+'-'+value.tool).slice(0,80),title:derivedTitle(title||preset.name,{suffix:' · '+value.tool}),...value,groupId,provenance}}))];
}

// A full document remains browsable. At capacity, render its current pixels
// first, then a separate temporary look; never accept an over-limit recipe.
export function presetTrial(document,presetId,amount,options){
  const commands=presetCommands(presetId,amount,options);
  try{return {document:applyCommands(document,commands).next,commands,canApply:true};}
  catch(error){
    if(error.code!=='STEP_LIMIT')throw error;
    const empty=createDocument({documentId:document.documentId,source:document.source,base:{settings:{},locals:[],crop:document.geometry.crop}});
    return {document:applyCommands(empty,commands).next,commands,inputDocument:document,canApply:false};
  }
}
