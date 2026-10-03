import {adjustmentKeys} from './engine/editor-engine.js';
import {presets} from './engine/presets.js';
import {settingsBounds, object, fail} from './engine/edit-values.js';
import {createCandidate, selectCandidateItems, changeGuards} from './project.mjs';
import {previewPhoto} from './render.mjs';
import {collectionTools,isCollectionTool,dispatchCollectionTool} from './collection-contract.mjs';
import {renderLookSheet} from './look-sheet.mjs';

const id={type:'string',pattern:'^[-\\w]{1,80}$'},idList={type:'array',maxItems:32,uniqueItems:true,items:id};
const number=(minimum,maximum)=>({type:'number',minimum,maximum});
const record=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const settings=record(Object.fromEntries(adjustmentKeys.map(key=>[key,number(...settingsBounds(key))])));
const point=record({x:number(0,1),y:number(0,1)},['x','y']);
const rect=record({x:number(0,1),y:number(0,1),width:number(.005,1),height:number(.005,1)},['x','y','width','height']);
const textLayer=record({id:{type:'string',pattern:'^[-\\w]{1,64}$'},text:{type:'string',minLength:1,maxLength:120},style:{enum:['airy','sticker','editorial']},font:{enum:['sans','rounded','serif']},weight:{enum:[400,600]},x:number(.02,.94),y:number(.02,.94),width:number(.08,.96),size:number(.018,.12),color:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},background:{type:'string',pattern:'^#[0-9a-fA-F]{6}$'},align:{enum:['left','center','right']},rotation:number(-12,12),opacity:number(.2,1),decoration:{enum:['none','heart','sparkle']}},['text']);
export const editPlanSchema=record({
  revision:{type:'integer',minimum:1},baseRevision:{type:'integer',minimum:1},baseVersion:id,
  requestId:{type:'string',maxLength:80},name:{type:'string',maxLength:40},goal:{type:'string',maxLength:300},tradeoff:{type:'string',maxLength:300},mode:{enum:['retouch','lettering']},allowProtectedCrop:{type:'boolean'},
  items:{type:'array',minItems:1,maxItems:24,items:record({id,title:{type:'string',minLength:1,maxLength:100},dependsOn:idList,patch:record({settings,style:{anyOf:[{type:'null'},record({id:{enum:presets.map(p=>p.id)},amount:number(0,100)},['id','amount'])]},crop:{anyOf:[{type:'null'},record({x:number(0,1),y:number(0,1),width:number(.05,1),height:number(.05,1),angle:number(-15,15)},['x','y','width','height'])]},locals:{type:'array',maxItems:8,items:record({annotationId:id,settings,remove:{type:'boolean'},feather:number(0,1),maskType:{enum:['rectangle','radial','linear']},start:point,end:point,enabled:{type:'boolean'},amount:number(0,150)},['annotationId'])},textOverlays:{type:'array',maxItems:4,items:textLayer}})},['id','title','patch'])},selectedItemIds:idList
},['revision','baseVersion','items']);
const selectionSchema=record({id,revision:{type:'integer',minimum:1},selectionHash:{type:'string',pattern:'^[0-9a-f]{64}$'},selectedItemIds:idList},['id','revision','selectionHash','selectedItemIds']);
const guardSchema=record({revision:{type:'integer',minimum:1},operation:{enum:['lock','protect','unlock']},name:{type:'string',maxLength:60},parameters:{type:'array',uniqueItems:true,items:{enum:adjustmentKeys}},localIds:idList,parameterKeys:{type:'array',uniqueItems:true,items:{enum:adjustmentKeys}},regionIds:idList,rect,coordinateSpace:{enum:['original','view']},maskType:{enum:['rectangle','radial']},feather:number(0,.25)},['revision','operation']);
const definitions=[
  {name:'frameyn_propose_edits',description:'Create a previewable structured plan on the inspected fixed base version. Values are absolute targets. Do not execute model-generated code.',parameters:editPlanSchema},
  {name:'frameyn_select_edits',description:'Recompile selected items from the pinned base, then preview their combined result. Requires latest revision and selectionHash.',parameters:selectionSchema},
  {name:'frameyn_change_guards',description:'Lock accepted parameters/local layers, protect accepted pixels, or propose explicit unlocking. Unlocking produces a candidate to inspect and accept.',parameters:guardSchema},
  {name:'frameyn_compare_looks',description:'Render 2-6 fixed versions into a comparison sheet without accepting or changing edits. Color mode shares reference framing; composition mode preserves individual crops. Inspect actual images, errors and detail before judging aesthetics.',parameters:record({revision:{type:'integer',minimum:1},versions:{type:'array',minItems:2,maxItems:6,uniqueItems:true,items:id},mode:{enum:['color','composition']},referenceVersion:id},['revision','versions'])}
];
export function hostToolContract(){return {kind:'provider-neutral-host-contract',schemaVersion:2,tools:[...definitions,...collectionTools].map(definition=>({type:'function',function:definition})),execution:'Pass {name, arguments} as JSON to: node cli.mjs tool --project <photo-or-collection-folder> --input <call.json|->. The host agent handles natural-language interpretation and model tool-calling; this runtime makes no model API calls.',boundaries:['Only listed operations and finite allowlisted parameters are accepted.','Tool definitions do not register tools with any model provider automatically.','Collection tools use the collection folder; photo edits use photos/<stable-ID> project folders returned by collection-inspect.','Inspect actual previews; accept is a separate CLI/UI operation with revision and selectionHash.']};}
export async function dispatchHostTool(folder,call){
  object(call,['name','arguments'],'INVALID_TOOL_CALL');
  const methods={frameyn_propose_edits:createCandidate,frameyn_select_edits:selectCandidateItems,frameyn_change_guards:changeGuards};
  if(!call.arguments||typeof call.arguments!=='object'||Array.isArray(call.arguments))fail('INVALID_TOOL_CALL','工具参数必须为 JSON 对象。');
  if(isCollectionTool(call.name))return dispatchCollectionTool(folder,call);
  if(call.name==='frameyn_compare_looks')return renderLookSheet(folder,call.arguments);
  if(!Object.hasOwn(methods,call.name))fail('UNKNOWN_TOOL','未知工具名；请读取 tool-schema。');
  if(call.name==='frameyn_propose_edits'&&!Array.isArray(call.arguments.items))fail('INVALID_ITEMS','宿主结构化工具需要 items；旧单组格式请使用 candidate 命令。');
  // Explicit dispatch, never eval, Function, shell execution or arbitrary imports.
  const result=await methods[call.name](folder,call.arguments),version=result.candidate||result.version;
  return {...result,preview:await previewPhoto(folder,version.id,{revision:result.project.revision,selectionHash:version.selectionHash})};
}
