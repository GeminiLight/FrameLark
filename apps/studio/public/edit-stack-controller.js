import {createDocument,validateDocument} from './edit-stack/document.js';
import {applyCommands,duplicateCommands} from './edit-stack/commands.js';
import {documentHash} from './edit-stack/identity.js';
import {compileDocumentProposal} from './edit-stack/proposals.js';
import {pixelCapabilities} from './edit-stack/tools.js';
import {createEditStackView} from './edit-stack-view.js';
export function createEditStackController({root,getPhoto,prepareDocument,getSnapshot,setSnapshot,onChange,onHistory,persist,onBusy,onError,onDiscuss,onDraw,onLegacy,createView=createEditStackView}={}){
  const gestures=new WeakMap(),saves=new WeakMap(),released=new WeakSet(),catalog=pixelCapabilities();let view;
  function currentView(photo){return photo.editView||(photo.editView={selectedStepId:null,maskMode:'photo',scopeStepId:null});}
  function render(){const photo=getPhoto();if(!photo){root.hidden=true;return;}const state=currentView(photo);if(state.selectedStepId&&!photo.editDocument?.steps.some(step=>step.id===state.selectedStepId)){state.selectedStepId=photo.editDocument?.steps[0]?.id||null;state.maskMode='photo';}if(state.scopeStepId&&!photo.editDocument?.steps.some(step=>step.id===state.scopeStepId))state.scopeStepId=null;view.render(photo.editDocument,{selectedStepId:state.selectedStepId,message:photo.editStackError||'',busy:Boolean(photo.editSaving),viewMode:state.maskMode,canRetry:Boolean(photo.editRetry),collapsedGroups:state.collapsedGroups||[]});}
  function write(photo,document){photo.editDocument=document;photo.crop=structuredClone(document.geometry.crop);photo.manual={...document.base.state.settings};photo.presetId=document.base.state.style?.id||null;photo.presetAmount=document.base.state.style?.amount||0;onChange?.(photo);if(getPhoto()===photo)render();}
  async function ensure(photo){if(photo.editDocument)return photo.editDocument;const document=await prepareDocument(photo);validateDocument(document);return document;}
  async function save(photo,beforeSnapshot,beforeDocument,commands,next,requestId='edit-'+crypto.randomUUID(),retrying=false){
    const proposal={baseRevision:beforeDocument.revision,baseHash:documentHash(beforeDocument),requestId,items:[{id:'edit',title:'修改编辑步骤',commands}]};
    const controller=new AbortController();saves.set(photo,controller);
    photo.editSaving=true;photo.editStackError='';onBusy?.(photo);render();
    try{let authoritative=next;if(persist)authoritative=await persist(photo,{proposal,beforeDocument,document:next,snapshot:getSnapshot(photo),signal:controller.signal,retrying});if(controller.signal.aborted||released.has(photo))return;write(photo,authoritative||next);onHistory?.(photo,beforeSnapshot);return true;}
    catch(error){if(controller.signal.aborted||released.has(photo))return;photo.editStackError=error.message;photo.editRetry={beforeSnapshot,beforeDocument,commands,next,requestId};onError?.(error.message,photo);return false;}
    finally{if(saves.get(photo)===controller)saves.delete(photo);photo.editSaving=false;onBusy?.(photo);render();}
  }
  async function command(commands,ownedPhoto){const photo=ownedPhoto||getPhoto();if(!photo||photo.editSaving)return;if(photo.editRetry){onError?.('请先重试保存当前修改，再继续编辑步骤。',photo);return;}if(photo===getPhoto())cancel();try{const beforeSnapshot=getSnapshot(photo),before=await ensure(photo);if(released.has(photo)||!ownedPhoto&&getPhoto()!==photo)return;const result=applyCommands(before,commands);if(result.noChange)return;write(photo,result.next);if(commands[0]?.type==='AddStep')currentView(photo).selectedStepId=commands[0].step.id;return await save(photo,beforeSnapshot,before,commands,result.next);}catch(error){photo.editStackError=error.message;onError?.(error.message,photo);render();}}
  function preview(commands){const photo=getPhoto();if(!photo?.editDocument||photo.editSaving||!commands.length)return;let gesture=gestures.get(photo);if(!gesture){gesture={beforeDocument:structuredClone(photo.editDocument),beforeSnapshot:getSnapshot(photo)};gestures.set(photo,gesture);photo.editGestureBefore=gesture.beforeSnapshot;}
    try{const result=applyCommands(gesture.beforeDocument,commands);gesture.commands=structuredClone(commands);gesture.next=result.next;gesture.invalid=false;photo.editStackError='';write(photo,result.next);}catch(error){gesture.invalid=true;photo.editStackError=error.message;view.setMessage(error.message);}
  }
  async function commit(commands){const photo=getPhoto(),gesture=photo&&gestures.get(photo);if(!gesture){if(commands.length)await command(commands);return;}gestures.delete(photo);delete photo.editGestureBefore;if(gesture.invalid){setSnapshot(photo,gesture.beforeSnapshot);onChange?.(photo);render();return;}if(!gesture.next)return;await save(photo,gesture.beforeSnapshot,gesture.beforeDocument,gesture.commands,gesture.next);}
  function cancel(){const photo=getPhoto(),gesture=photo&&gestures.get(photo);if(!gesture)return;gestures.delete(photo);delete photo.editGestureBefore;setSnapshot(photo,gesture.beforeSnapshot);onChange?.(photo);render();}
  function select(id){const photo=getPhoto();if(!photo)return;cancel();currentView(photo).selectedStepId=id;currentView(photo).maskMode='photo';render();onChange?.(photo);}
  view=createView(root,{catalog,onSelect:select,onCommand:command,onPreview:preview,onCommit:commit,onCancel:cancel,
    onView:({stepId,mode})=>{const photo=getPhoto();if(photo){currentView(photo).selectedStepId=stepId;currentView(photo).maskMode=mode;onChange?.(photo);render();}},
    onDiscuss:id=>{const photo=getPhoto();if(photo){currentView(photo).scopeStepId=id;onDiscuss?.(id,photo);}},onDraw:(shape,id,operation)=>onDraw?.(shape,id,operation),onFoldGroup:id=>{const photo=getPhoto(),state=currentView(photo),set=new Set(state.collapsedGroups||[]);set.has(id)?set.delete(id):set.add(id);state.collapsedGroups=[...set];render();},onRetry:retry,onLegacy});
  async function retry(){const photo=getPhoto(),pending=photo?.editRetry;if(pending){delete photo.editRetry;await save(photo,pending.beforeSnapshot,pending.beforeDocument,pending.commands,pending.next,pending.requestId,true);}}
  return {release(photo){released.add(photo);saves.get(photo)?.abort();gestures.delete(photo);delete photo.editGestureBefore;},render,command,preview,commit,cancel,select,ensure,viewState:photo=>currentView(photo),
    retry,
    async proposal(input){const photo=getPhoto(),base=await ensure(photo);return compileDocumentProposal(base,input);},
    update(photo,document){if(document)validateDocument(document);photo.editDocument=document?structuredClone(document):null;if(getPhoto()===photo)render();},
    maskView(photo){const state=currentView(photo);return state.maskMode!=='photo'&&photo.editDocument?.steps.some(step=>step.id===state.selectedStepId&&step.maskRef)?{stepId:state.selectedStepId,mode:state.maskMode}:undefined;}
  };
}
