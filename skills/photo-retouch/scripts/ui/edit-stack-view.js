// DOM-only inspector. It emits commands; the owning photo/controller validates
// and commits them. No image state or render queue lives in this component.
const labels={ev:'曝光 EV',contrast:'对比度',highlights:'高光',shadows:'阴影',whites:'白色',blacks:'黑色',warmth:'色温',tint:'色偏',saturation:'饱和度',vibrance:'鲜艳度',monochrome:'黑白',texture:'纹理',clarity:'清晰度',sharpen:'锐化',denoise:'降噪',vignette:'暗角',grain:'颗粒',fade:'褪色',dehaze:'去雾',curveShadows:'曲线暗部',curveMidtones:'曲线中间调',curveHighlights:'曲线高光',orangeHue:'橙色色相',greenHue:'绿色色相',blueHue:'蓝色色相',orangeSaturation:'橙色饱和度',greenSaturation:'绿色饱和度',blueSaturation:'蓝色饱和度',orangeLuminance:'橙色明度',greenLuminance:'绿色明度',blueLuminance:'蓝色明度',headroomPolicy:'高光策略'};
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,action)=>{const node=element('button',text);node.type='button';node.dataset.action=action;return node;};
let inspectorCount=0;
export function parameterSections(tool){
  const keys=Object.keys(tool.parameters.properties),sections=[];
  if(tool.id==='exposure')sections.push({id:'headroom',title:'高光处理',keys:['headroomPolicy']});
  if(tool.id==='tone')sections.push({id:'curve',title:'曲线',keys:['curveShadows','curveMidtones','curveHighlights']},{id:'tone',title:'更多影调',keys:['dehaze','fade']});
  if(tool.id==='color')sections.push({id:'color-mix',title:'色彩混合',keys:keys.filter(key=>/^(orange|green|blue)/.test(key))});
  for(const section of sections)section.keys=section.keys.filter(key=>keys.includes(key));
  const advanced=sections.filter(section=>section.keys.length),assigned=new Set(advanced.flatMap(section=>section.keys));
  return [{id:'basic',keys:keys.filter(key=>!assigned.has(key))},...advanced];
}
export const changedParameterCount=(parameters,tool,keys)=>keys.filter(key=>parameters[key]!==tool.defaults[key]).length;
export function rangeDescription(mask){
  if(!mask)return '整张照片';
  const expression=mask.expression;
  if(expression.kind==='constant')return expression.value===0?'此范围不应用调整':expression.value===1?'整张照片':`整张照片，范围强度为 ${Math.round(expression.value*100)}%`;
  if(expression.kind==='luminance')return expression.mode==='exclude-highlights'?'减少亮部调整':expression.mode==='include-highlights'?'调整较亮的区域':'按亮度选择的范围';
  if(expression.kind==='drawn')return {rectangle:'矩形范围',radial:'径向范围',linear:'渐变范围',brush:'画笔范围'}[expression.mask.shape];
  return expression.kind==='invert'?'已反转的范围':expression.kind==='reference'?'引用已保存的范围':'组合范围';
}
export const brightnessLabels=expression=>expression.mode==='exclude-highlights'?['开始减弱调整','停止调整']:expression.mode==='include-highlights'?['开始调整','完全调整']:['范围起点','范围终点'];
export function createEditStackView(root,{catalog,onSelect,onDuplicate,onCommand,onPreview,onCommit,onCancel,onView,onDraw,onDiscuss,onLegacy,onRetry,onFoldGroup}={}){
  let current=null,selectedId=null,structure='',maskMode='photo',openMenuId=null,menuDocumentId=null;
  const inspectorId='edit-inspector-'+(++inspectorCount),expandedSections=new Set(),drawingOperations=new Map();
  root.classList.add('edit-stack');root.setAttribute('aria-label','可编辑步骤');
  const head=element('div',undefined,'edit-stack-head'),heading=element('h3','编辑步骤'),select=element('select');select.setAttribute('aria-label','添加的调整工具');for(const tool of catalog.tools){const option=element('option',tool.title);option.value=tool.id;select.append(option);}head.append(heading,select,button('添加','add'));root.append(head);
  const list=element('ol',undefined,'edit-stack-list');list.setAttribute('aria-label','按处理顺序排列的步骤');root.append(list);
  const details=element('section',undefined,'edit-step-properties');details.setAttribute('aria-label','选中步骤属性');root.append(details);
  const status=element('p',undefined,'edit-stack-status');status.setAttribute('role','status');root.append(status);const retry=button('重试保存','retry');retry.hidden=true;root.append(retry);
  function field(label,value,min,max,key,kind='parameter'){
    const wrap=element('label',undefined,'edit-step-field'),name=element('span',label),output=element('output',String(Number(value.toFixed(3)))),input=element('input');input.type='range';input.min=min;input.max=max;input.step=key==='ev'||kind==='mask'||key==='opacity'?'.01':'1';input.value=value;input.dataset.field=key;input.dataset.kind=kind;input.setAttribute('aria-label',label);name.append(output);wrap.append(name,input);return wrap;
  }
  function selected(){return current?.steps.find(step=>step.id===selectedId);}
  function resource(){const step=selected();return step?.maskRef?current.masks.find(mask=>mask.id===step.maskRef.id&&mask.version===step.maskRef.version):null;}
  function leafAt(expression,path){return (path||'').split('.').filter(Boolean).reduce((node,key)=>node?.[key],expression);}
  function leaves(expression,path='',out=[]){if(['luminance','drawn'].includes(expression?.kind))out.push({expression,path});else if(expression?.kind==='invert')leaves(expression.input,path?path+'.input':'input',out);else if(expression?.a){leaves(expression.a,path?path+'.a':'a',out);leaves(expression.b,path?path+'.b':'b',out);}return out;}
  function commandForInput(input){
    const step=selected();if(!step)return [];const key=input.dataset.field,value=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    if(input.dataset.kind==='opacity')return [{type:'SetStepOpacity',stepId:step.id,opacity:value/100}];
    if(input.dataset.kind==='parameter')return [{type:'UpdateStepParameters',stepId:step.id,parameters:{[key]:value}}];
    if(input.dataset.kind==='reference'){
      const mask=resource();if(!mask)return [];
      return [{type:'ReplaceStepMask',stepId:step.id,mask:{expression:mask.expression,reference:value==='frozen-source'?{kind:value,sourceHash:current.source.contentHash}:{kind:'live-input'},...(mask.provenance?{provenance:mask.provenance}:{})},shared:root.querySelector('[data-share-mask]')?.checked||false}];
    }
    if(input.dataset.kind==='mask'){
      const mask=structuredClone(resource());if(!mask)return [];const leaf=leafAt(mask.expression,input.dataset.maskPath);if(leaf?.kind==='luminance')leaf[key]=value;else if(leaf?.kind==='drawn'){if(key==='feather')leaf.mask.feather=value;else if(key==='radius')leaf.mask.radius=value;else leaf.mask.rect[key]=value;}
      return [{type:'ReplaceStepMask',stepId:step.id,mask:{expression:mask.expression,reference:mask.reference,...(mask.provenance?{provenance:mask.provenance}:{})},shared:root.querySelector('[data-share-mask]')?.checked||false}];
    }
    return [];
  }
  root.addEventListener('input',event=>{const input=event.target;if(!input.dataset.field)return;input.closest('label')?.querySelector('output')?.replaceChildren(document.createTextNode(input.value));onPreview?.(commandForInput(input));});
  root.addEventListener('change',event=>{if(event.target.dataset.maskOperation!==undefined){drawingOperations.set(current.documentId+':'+selectedId,event.target.value);return;}if(event.target.dataset.field)onCommit?.(commandForInput(event.target));else if(event.target.dataset.groupToggle)onCommand?.([{type:'ToggleGroup',groupId:event.target.dataset.groupToggle,enabled:event.target.checked}]);else if(event.target.dataset.stepToggle)onCommand?.([{type:'SetStepEnabled',stepId:event.target.dataset.stepToggle,enabled:event.target.checked}]);});
  function closeMenu(focus=false){
    if(!openMenuId)return;const id=openMenuId;openMenuId=null;
    for(const menu of list.querySelectorAll('[data-step-menu]'))menu.hidden=true;
    for(const toggle of list.querySelectorAll('[data-action="more"]')){toggle.setAttribute('aria-expanded','false');if(focus&&toggle.dataset.stepId===id)toggle.focus({preventScroll:true});}
  }
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();if(openMenuId){closeMenu(true);return;}onCancel?.();}});
  root.addEventListener('focusout',event=>{if(event.relatedTarget&&!root.contains(event.relatedTarget))closeMenu();});
  root.addEventListener('click',event=>{
    const node=event.target.closest('button');if(!node)return;const action=node.dataset.action,step=node.dataset.stepId?current?.steps.find(step=>step.id===node.dataset.stepId):selected();
    if(node.dataset.foldGroup){onFoldGroup?.(node.dataset.foldGroup);return;}
    if(node.dataset.stepSelect){closeMenu();onSelect?.(node.dataset.stepSelect);return;}
    if(action==='more'){
      const next=openMenuId===node.dataset.stepId?null:node.dataset.stepId;closeMenu();openMenuId=next;
      if(next){node.setAttribute('aria-expanded','true');for(const menu of list.querySelectorAll('[data-step-menu]'))menu.hidden=menu.dataset.stepMenu!==next;}
      return;
    }
    if(action==='add'){onCommand?.([{type:'AddStep',step:{id:'step-'+crypto.randomUUID(),title:catalog.tools.find(tool=>tool.id===select.value).title,tool:select.value,toolVersion:2,parameters:{}}}]);return;}
    if(action==='retry'){onRetry?.();return;}if(action==='legacy'){onLegacy?.();return;}if(!step)return;
    if(node.dataset.stepId)closeMenu(true);
    if(action==='up'||action==='down'){const index=current.steps.indexOf(step)+(action==='up'?-1:1);onCommand?.([{type:'MoveStep',stepId:step.id,index}]);}
    else if(action==='delete')onCommand?.([{type:'RemoveStep',stepId:step.id}]);
    else if(action==='duplicate'){onDuplicate?.(step.id);}
    else if(action==='rename'){const input=root.querySelector('[data-step-title]');if(input?.value.trim())onCommand?.([{type:'RenameStep',stepId:step.id,title:input.value.trim()}]);}
    else if(action==='reset-effect')onCommand?.([{type:'UpdateStepParameters',stepId:step.id,parameters:catalog.tools.find(tool=>tool.id===step.tool).defaults}]);
    else if(action==='discuss')onDiscuss?.(step.id);
    else if(action==='clear-mask')onCommand?.([{type:'ReplaceStepMask',stepId:step.id,maskRef:null}]);
    else if(action==='highlights')onCommand?.([{type:'ReplaceStepMask',stepId:step.id,mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.55,end:.8},reference:{kind:'live-input'}}}]);
    else if(action==='rectangle'||action==='radial'||action==='linear'||action==='brush')onDraw?.(action,step.id,root.querySelector('[data-mask-operation]')?.value||'replace');
    else if(action==='invert'){const mask=resource();if(mask)onCommand?.([{type:'ReplaceStepMask',stepId:step.id,mask:{expression:{kind:'invert',input:mask.expression},reference:mask.reference}}]);}
    else if(action==='view'){maskMode=node.dataset.maskView;onView?.({stepId:step.id,mode:maskMode});}
  });
  function render(documentValue,{selectedStepId,message='',busy=false,retryBusy=busy,viewMode='photo',canRetry=false,collapsedGroups=[]}={}){
    current=documentValue;selectedId=current?.steps.some(step=>step.id===selectedStepId)?selectedStepId:current?.steps[0]?.id||null;maskMode=viewMode;root.hidden=!current;status.textContent=message;retry.hidden=!canRetry;retry.disabled=retryBusy;root.classList.toggle('is-busy',busy);select.disabled=busy;head.querySelector('button').disabled=busy;
    if(!current)return;if(menuDocumentId!==current.documentId){openMenuId=null;menuDocumentId=current.documentId;}
    if(openMenuId&&!current.steps.some(step=>step.id===openMenuId))openMenuId=null;
    const activeListNode=list.contains(document.activeElement)?document.activeElement:null,focusId=activeListNode?.dataset.stepId||activeListNode?.dataset.stepSelect;
    list.replaceChildren();
    const legacy=element('li',undefined,'edit-stack-base');legacy.append(button('兼容基础 · 已有调整','legacy'));list.append(legacy);
    const shownGroups=new Set();for(const [index,step] of current.steps.entries()){
      if(step.groupId){const group=current.groups.find(group=>group.id===step.groupId);if(!shownGroups.has(group.id)){shownGroups.add(group.id);const heading=element('li',undefined,'edit-stack-row'),toggle=element('input'),hitArea=element('label',undefined,'edit-step-enabled');toggle.type='checkbox';toggle.dataset.groupToggle=group.id;toggle.setAttribute('aria-label',group.title+'整组启用');const children=current.steps.filter(step=>step.groupId===group.id);toggle.checked=children.every(step=>step.enabled);toggle.indeterminate=children.some(step=>step.enabled)&&!toggle.checked;toggle.disabled=busy;hitArea.append(toggle);const fold=button((collapsedGroups.includes(group.id)?'展开 ':'收起 ')+group.title,'fold');fold.dataset.foldGroup=group.id;fold.setAttribute('aria-expanded',String(!collapsedGroups.includes(group.id)));heading.append(hitArea,fold);list.append(heading);}if(collapsedGroups.includes(group.id))continue;}
      const row=element('li',undefined,'edit-stack-row'),toggle=element('input'),hitArea=element('label',undefined,'edit-step-enabled');toggle.type='checkbox';toggle.checked=step.enabled;toggle.dataset.stepToggle=step.id;toggle.setAttribute('aria-label','启用 '+step.title);toggle.disabled=busy;hitArea.append(toggle);
      const choice=button(step.title,'select');choice.dataset.stepSelect=step.id;choice.setAttribute('aria-pressed',String(step.id===selectedId));const subtitle=element('small',`${catalog.tools.find(tool=>tool.id===step.tool)?.title||step.tool} · ${Math.round(step.opacity*100)}%${step.maskRef?' · 有蒙版':''}${!step.enabled?' · 已暂停':''}`);choice.append(subtitle);
      const more=button('⋯','more'),menu=element('div',undefined,'edit-step-menu');more.dataset.stepId=step.id;more.disabled=busy;more.setAttribute('aria-label',step.title+'的更多操作');more.setAttribute('aria-expanded',String(openMenuId===step.id));menu.id=inspectorId+'-menu-'+step.id;more.setAttribute('aria-controls',menu.id);menu.dataset.stepMenu=step.id;menu.hidden=openMenuId!==step.id;menu.setAttribute('role','group');menu.setAttribute('aria-label',step.title+'的操作');
      for(const [label,action] of [['修改此步骤','discuss'],['复制','duplicate'],['上移','up'],['下移','down'],['删除','delete']]){
        if(action==='discuss'&&!onDiscuss||action==='duplicate'&&!onDuplicate)continue;
        const control=button(label,action);control.dataset.stepId=step.id;control.disabled=busy||action==='up'&&index===0||action==='down'&&index===current.steps.length-1;menu.append(control);
      }
      row.append(hitArea,choice,more,menu);list.append(row);
    }
    if(focusId&&!busy){const next=[...list.querySelectorAll('[data-action="more"],[data-step-select]')].find(node=>(activeListNode.dataset.stepSelect?node.dataset.stepSelect:node.dataset.stepId)===focusId);next?.focus({preventScroll:true});}
    const step=selected(),mask=resource(),maskUsers=mask?current.steps.filter(value=>value.maskRef?.id===mask.id&&value.maskRef.version===mask.version).length:0,key=step?current.documentId+':'+step.id+':'+step.tool+':'+JSON.stringify({kind:mask?.expression.kind,users:maskUsers,leaves:leaves(mask?.expression).map(leaf=>[leaf.path,leaf.expression.kind,leaf.expression.mode,leaf.expression.mask?.shape])}):'empty';
    if(key!==structure){structure=key;details.replaceChildren();if(!step){details.append(element('p','添加一个调整步骤，之后可继续修改参数与范围。'));return;}
      const titleRow=element('div',undefined,'edit-step-name'),name=element('input');name.value=step.title;name.maxLength=120;name.dataset.stepTitle='';name.setAttribute('aria-label','步骤名称');titleRow.append(name,button('命名','rename'));details.append(titleRow);
      const effect=element('div',undefined,'edit-step-effects'),effectHead=element('div',undefined,'edit-step-heading');effectHead.append(element('h4','效果'),button('重置效果','reset-effect'));effect.append(effectHead,field('效果强度',step.opacity*100,0,100,'opacity','opacity'));const tool=catalog.tools.find(tool=>tool.id===step.tool);
      for(const section of parameterSections(tool)){
        let target=effect;
        if(section.id!=='basic'){
          const group=element('details',undefined,'edit-step-advanced'),summary=element('summary'),badge=element('span','已调整','edit-step-adjusted');summary.append(element('span',section.title),badge);group.append(summary);group.dataset.parameterSection=section.id;group.dataset.parameters=JSON.stringify(section.keys);group.dataset.sectionTitle=section.title;
          const preference=current.documentId+':'+step.id+':'+section.id;group.open=expandedSections.has(preference);group.addEventListener('toggle',()=>{group.open?expandedSections.add(preference):expandedSections.delete(preference);});effect.append(group);target=group;
        }
        for(const key of section.keys){const property=tool.parameters.properties[key];if(property.type==='number')target.append(field(labels[key]||key,step.parameters[key],property.minimum,property.maximum,key));else{const wrap=element('label',labels[key]||key,'edit-step-choice'),input=element('select');input.dataset.field=key;input.dataset.kind='parameter';input.setAttribute('aria-label',labels[key]||key);for(const value of property.enum){const option=element('option',value==='limit-positive-gain'?'限制亮部提亮':'允许更强的提亮');option.value=value;input.append(option);}input.value=step.parameters[key];wrap.append(input);target.append(wrap);}}
      }
      details.append(effect);
      const range=element('div',undefined,'edit-step-range'),rangeHead=element('div',undefined,'edit-step-heading'),description=element('p',rangeDescription(mask));description.dataset.rangeDescription='';rangeHead.append(element('h4','作用范围'));if(mask)rangeHead.append(button('清除范围','clear-mask'));range.append(rangeHead,description,element('p','仅作用于当前步骤，后续步骤仍可调整同一区域。'));
      const tools=element('div',undefined,'edit-step-buttons');tools.append(button('减少亮部调整','highlights'));for(const [label,action] of [['矩形','rectangle'],['径向','radial'],['渐变','linear'],['画笔','brush']]){const draw=button(label,action);draw.dataset.requiresDrawing='';if(!onDraw)draw.title='应用方案后，可在照片上绘制范围。';tools.append(draw);}range.append(tools);
      if(mask){
        const views=element('div',undefined,'edit-step-buttons');for(const [mode,label] of [['photo','照片'],['overlay','范围预览'],['bw','黑白范围']]){const b=button(label,'view');b.dataset.maskView=mode;views.append(b);}range.append(views);
        const advanced=element('details',undefined,'edit-step-advanced'),summary=element('summary','高级范围设置');advanced.dataset.rangeAdvanced='';advanced.append(summary);const preference=current.documentId+':'+step.id+':range';advanced.open=expandedSections.has(preference);advanced.addEventListener('toggle',()=>{advanced.open?expandedSections.add(preference):expandedSections.delete(preference);});range.append(advanced);
        const referenceWrap=element('label','参考画面','edit-step-choice'),reference=element('select');reference.dataset.field='reference';reference.dataset.kind='reference';reference.setAttribute('aria-label','参考画面');for(const [value,label] of [['live-input','此步骤之前'],['frozen-source','原始照片']]){const option=element('option',label);option.value=value;reference.append(option);}reference.value=mask.reference.kind;referenceWrap.append(reference);const referenceNote=element('p');referenceNote.dataset.referenceNote='';advanced.append(referenceWrap,referenceNote);
        const operationWrap=element('label','新绘制范围','edit-step-choice'),operation=element('select');operation.dataset.maskOperation='';operation.setAttribute('aria-label','新绘制范围的组合方式');for(const [value,label] of [['replace','替换范围'],['union','添加范围'],['subtract','减去范围'],['intersect','仅保留重叠范围']]){const option=element('option',label);option.value=value;operation.append(option);}operation.value=drawingOperations.get(current.documentId+':'+step.id)||'replace';operationWrap.append(operation);advanced.append(operationWrap);
        if(maskUsers>1){const wrap=element('label',undefined,'edit-mask-shared'),input=element('input');input.type='checkbox';input.dataset.shareMask='';wrap.append(input,document.createTextNode(`参数修改同时应用到使用此范围的 ${maskUsers} 个步骤`));advanced.append(wrap);}
        for(const [index,leaf] of leaves(mask.expression).entries()){
          if(leaf.path)advanced.append(element('h4',`范围部分 ${index+1}`));const fields=[];
          if(leaf.expression.kind==='luminance'){const [start,end]=brightnessLabels(leaf.expression);fields.push(field(start,leaf.expression.start,0,.99,'start','mask'),field(end,leaf.expression.end,.01,1,'end','mask'));advanced.append(element('p','亮度阈值按线性明度计算，数值范围为 0–1。'));}
          else{const m=leaf.expression.mask;if(m.shape!=='brush')for(const key of ['x','y','width','height'])fields.push(field({x:'横向位置',y:'纵向位置',width:'范围宽度',height:'范围高度'}[key],m.rect[key],key==='width'||key==='height'?.005:0,1,key,'mask'));fields.push(field('羽化',m.feather,0,1,'feather','mask'));if(m.shape==='brush')fields.push(field('画笔半径',m.radius,.001,.15,'radius','mask'));}
          for(const field of fields){field.querySelector('input').dataset.maskPath=leaf.path;advanced.append(field);}
        }
        advanced.append(button('反转范围','invert'));
      }
      details.append(range);
    }
    if(step){
      const name=details.querySelector('[data-step-title]');if(name!==document.activeElement)name.value=step.title;
      for(const input of details.querySelectorAll('input,select'))input.disabled=busy;
      for(const input of details.querySelectorAll('[data-field]')){if(input===document.activeElement)continue;const key=input.dataset.field,m=leafAt(resource()?.expression,input.dataset.maskPath);const value=input.dataset.kind==='reference'?resource()?.reference.kind:input.dataset.kind==='opacity'?step.opacity*100:input.dataset.kind==='parameter'?step.parameters[key]:m?.kind==='luminance'?m[key]:key==='feather'?m?.mask?.feather:key==='radius'?m?.mask?.radius:m?.mask?.rect[key];if(value!==undefined){input.value=value;const output=input.closest('label')?.querySelector('output');if(output)output.textContent=String(typeof value==='number'?Number(value.toFixed(3)):value);}}
      for(const group of details.querySelectorAll('[data-parameter-section]')){const changed=changedParameterCount(step.parameters,catalog.tools.find(tool=>tool.id===step.tool),JSON.parse(group.dataset.parameters));group.querySelector('.edit-step-adjusted').hidden=!changed;group.querySelector('summary').setAttribute('aria-label',group.dataset.sectionTitle+(changed?'，已调整':''));}
      details.querySelector('[data-range-description]').textContent=rangeDescription(mask);const referenceNote=details.querySelector('[data-reference-note]');if(referenceNote)referenceNote.textContent=mask.reference.kind==='frozen-source'?'始终依据未经调整的原始照片确定范围。':'依据当前步骤执行之前的画面确定范围，亮度选择可随前面步骤更新。';
      for(const b of details.querySelectorAll('button'))b.disabled=busy||b.dataset.requiresDrawing!==undefined&&!onDraw;for(const b of details.querySelectorAll('[data-mask-view]'))b.setAttribute('aria-pressed',String(b.dataset.maskView===maskMode));
    }
  }
  return {render,setMessage(value){status.textContent=value;},selected:()=>selectedId};
}
