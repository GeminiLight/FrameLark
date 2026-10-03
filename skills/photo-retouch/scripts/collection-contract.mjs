import {initCollection,inspectCollection,updateCollectionBrief,saveCollectionPlan,collectionSheet,exportCollection,collectionPurposes,collectionSequences} from './collection.mjs';
import {object} from './engine/edit-values.js';
const str=maxLength=>({type:'string',minLength:1,maxLength});
const id={type:'string',pattern:'^P\\d{4}$'};
const ids={type:'array',maxItems:500,uniqueItems:true,items:id};
const rec=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const revision={type:'integer',minimum:1},snapshotHash={type:'string',pattern:'^[0-9a-f]{64}$'};
const brief=rec({theme:{type:'string',maxLength:600},purpose:{enum:collectionPurposes},sequence:{enum:collectionSequences},targetCount:{anyOf:[{type:'null'},{type:'integer',minimum:1,maximum:500}]},mustKeep:ids,constraints:{type:'array',maxItems:12,items:str(300)}});
export const collectionTools=[
  {name:'frameyn_collection_import',description:'Import 1–500 photos into a new local collection. Preserve originals, isolate per-file failures, list exact duplicate hints. No visual judgment is performed.',parameters:rec({images:{type:'array',minItems:1,maxItems:500,items:str(4096)},directory:str(4096),brief})},
  {name:'frameyn_collection_inspect',description:'Read the brief, all photo IDs and project paths, current snapshot hash, curation freshness and export jobs.',parameters:rec({})},
  {name:'frameyn_collection_brief',description:'Update the current collection purpose, theme, count and must-keep constraints. Earlier curation becomes stale when the brief changes.',parameters:rec({revision,brief},['revision','brief'])},
  {name:'frameyn_collection_sheet',description:'Create one page of up to 20 stable-ID thumbnails for the host to visually examine; open individual photos for detail decisions.',parameters:rec({page:{type:'integer',minimum:1},view:{enum:['current','original','planned']},selected:{type:'boolean'}})},
  {name:'frameyn_collection_plan',description:'Save visual curation observations and select/reserve/exclude decisions, ordered selected IDs and an optional look anchor. Never delete source photos.',parameters:rec({revision,snapshotHash,title:str(80),rationale:str(1200),decisions:{type:'array',maxItems:500,items:rec({id,decision:{enum:['select','reserve','exclude']},observations:str(600),reason:str(600),preserve:str(600),role:str(120)},['id','decision','observations','reason','preserve','role'])},order:ids,anchorId:{anyOf:[id,{type:'null'}]}},['revision','snapshotHash','title','rationale','decisions','order'])},
  {name:'frameyn_collection_export',description:'Export selected saved versions in their planned order with a manifest. Partial failures remain retryable; stale plans and overwrite attempts are rejected. Does not upload or publish.',parameters:rec({revision,snapshotHash,preset:{enum:['share','print','original']},format:{enum:['png','jpeg']},retryJob:str(36)},['revision','snapshotHash'])}
];
const methods={frameyn_collection_import:initCollection,frameyn_collection_inspect:inspectCollection,frameyn_collection_brief:updateCollectionBrief,frameyn_collection_sheet:collectionSheet,frameyn_collection_plan:saveCollectionPlan,frameyn_collection_export:exportCollection};
export const isCollectionTool=name=>Object.hasOwn(methods,name);
export const dispatchCollectionTool=(folder,call)=>{
  if(call.name==='frameyn_collection_inspect')object(call.arguments,[]);
  return methods[call.name](folder,call.arguments);
};
