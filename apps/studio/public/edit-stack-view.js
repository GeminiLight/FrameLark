// DOM-only inspector. It emits commands; the owning photo/controller validates
// and commits them. No image state or render queue lives in this component.
const labels={ev:'曝光 EV',contrast:'对比度',highlights:'高光',shadows:'阴影',whites:'白色',blacks:'黑色',warmth:'色温',tint:'色偏',saturation:'饱和度',vibrance:'鲜艳度',monochrome:'黑白',texture:'纹理',clarity:'清晰度',sharpen:'锐化',denoise:'降噪',vignette:'暗角',grain:'颗粒',fade:'褪色',dehaze:'去雾',curveShadows:'曲线暗部',curveMidtones:'曲线中间调',curveHighlights:'曲线高光',orangeHue:'橙色色相',greenHue:'绿色色相',blueHue:'蓝色色相',orangeSaturation:'橙色饱和度',greenSaturation:'绿色饱和度',blueSaturation:'蓝色饱和度',orangeLuminance:'橙色明度',greenLuminance:'绿色明度',blueLuminance:'蓝色明度',headroomPolicy:'高光策略'};
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
const button=(text,action)=>{const node=element('button',text);node.type='button';node.dataset.action=action;return node;};
export function createEditStackView(root,{catalog,onSelect,onCommand,onPreview,onCommit,onCancel,onView,onDraw,onDiscuss,onLegacy,onRetry,onFoldGroup}={}){
  let current=null,selectedId=null,structure='',maskMode='photo';
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
    if(input.dataset.kind==='mask'){
      const mask=structuredClone(resource());if(!mask)return [];const leaf=leafAt(mask.expression,input.dataset.maskPath);if(leaf?.kind==='luminance')leaf[key]=value;else if(leaf?.kind==='drawn'){if(key==='feather')leaf.mask.feather=value;else if(key==='radius')leaf.mask.radius=value;else leaf.mask.rect[key]=value;}
      return [{type:'ReplaceStepMask',stepId:step.id,mask:{expression:mask.expression,reference:mask.reference,...(mask.provenance?{provenance:mask.provenance}:{})},shared:root.querySelector('[data-share-mask]')?.checked||false}];
    }
    return [];
  }
  root.addEventListener('input',event=>{const input=event.target;if(!input.dataset.field)return;input.closest('label')?.querySelector('output')?.replaceChildren(document.createTextNode(input.value));onPreview?.(commandForInput(input));});
  root.addEventListener('change',event=>{if(event.target.dataset.field)onCommit?.(commandForInput(event.target));else if(event.target.dataset.groupToggle)onCommand?.([{type:'ToggleGroup',groupId:event.target.dataset.groupToggle,enabled:event.target.checked}]);else if(event.target.dataset.stepToggle)onCommand?.([{type:'SetStepEnabled',stepId:event.target.dataset.stepToggle,enabled:event.target.checked}]);});
  root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();onCancel?.();}});
  root.addEventListener('click',event=>{
    const node=event.target.closest('button');if(!node)return;const action=node.dataset.action,step=selected();
    if(node.dataset.foldGroup){onFoldGroup?.(node.dataset.foldGroup);return;}
    if(node.dataset.stepSelect){onSelect?.(node.dataset.stepSelect);return;}
    if(action==='add'){onCommand?.([{type:'AddStep',step:{id:'step-'+crypto.randomUUID(),title:catalog.tools.find(tool=>tool.id===select.value).title,tool:select.value,toolVersion:2,parameters:{}}}]);return;}
    if(action==='retry'){onRetry?.();return;}if(action==='legacy'){onLegacy?.();return;}if(!step)return;
    if(action==='up'||action==='down'){const index=current.steps.indexOf(step)+(action==='up'?-1:1);onCommand?.([{type:'MoveStep',stepId:step.id,index}]);}
    else if(action==='delete')onCommand?.([{type:'RemoveStep',stepId:step.id}]);
    else if(action==='duplicate'){const copy=structuredClone(step);copy.id='step-'+crypto.randomUUID();copy.title+=' · 副本';onCommand?.([{type:'AddStep',step:copy,index:current.steps.indexOf(step)+1}]);}
    else if(action==='rename'){const input=root.querySelector('[data-step-title]');if(input?.value.trim())onCommand?.([{type:'RenameStep',stepId:step.id,title:input.value.trim()}]);}
    else if(action==='reset-effect')onCommand?.([{type:'UpdateStepParameters',stepId:step.id,parameters:catalog.tools.find(tool=>tool.id===step.tool).defaults}]);
    else if(action==='discuss')onDiscuss?.(step.id);
    else if(action==='clear-mask')onCommand?.([{type:'ReplaceStepMask',stepId:step.id,maskRef:null}]);
    else if(action==='highlights')onCommand?.([{type:'ReplaceStepMask',stepId:step.id,mask:{expression:{kind:'luminance',mode:'exclude-highlights',start:.55,end:.8},reference:{kind:'live-input'}}}]);
    else if(action==='rectangle'||action==='radial'||action==='linear'||action==='brush')onDraw?.(action,step.id,root.querySelector('[data-mask-operation]')?.value||'replace');
    else if(action==='invert'){const mask=resource();if(mask)onCommand?.([{type:'ReplaceStepMask',stepId:step.id,mask:{expression:{kind:'invert',input:mask.expression},reference:mask.reference}}]);}
    else if(action==='view'){maskMode=node.dataset.maskView;onView?.({stepId:step.id,mode:maskMode});}
    else if(action==='reference'){const mask=resource();if(mask)onCommand?.([{type:'ReplaceStepMask',stepId:step.id,mask:{expression:mask.expression,reference:mask.reference.kind==='live-input'?{kind:'frozen-source',sourceHash:current.source.contentHash}:{kind:'live-input'}}}]);}
  });
  function render(documentValue,{selectedStepId,message='',busy=false,viewMode='photo',canRetry=false,collapsedGroups=[]}={}){
    current=documentValue;selectedId=selectedStepId||current?.steps[0]?.id||null;maskMode=viewMode;root.hidden=!current;status.textContent=message;retry.hidden=!canRetry;retry.disabled=busy;root.classList.toggle('is-busy',busy);select.disabled=busy;head.querySelector('button').disabled=busy;
    if(!current)return;list.replaceChildren();
    const legacy=element('li',undefined,'edit-stack-base');legacy.append(button('兼容基础 · 已有调整','legacy'));list.append(legacy);
    const shownGroups=new Set();for(const step of current.steps){if(step.groupId){const group=current.groups.find(group=>group.id===step.groupId);if(!shownGroups.has(group.id)){shownGroups.add(group.id);const heading=element('li',undefined,'edit-stack-row'),toggle=element('input');toggle.type='checkbox';toggle.dataset.groupToggle=group.id;toggle.setAttribute('aria-label',group.title+'整组启用');const children=current.steps.filter(step=>step.groupId===group.id);toggle.checked=children.every(step=>step.enabled);toggle.indeterminate=children.some(step=>step.enabled)&&!toggle.checked;toggle.disabled=busy;const fold=button((collapsedGroups.includes(group.id)?'展开 ':'收起 ')+group.title,'fold');fold.dataset.foldGroup=group.id;fold.setAttribute('aria-expanded',String(!collapsedGroups.includes(group.id)));heading.append(toggle,fold);list.append(heading);}if(collapsedGroups.includes(group.id))continue;}const row=element('li',undefined,'edit-stack-row'),toggle=element('input');toggle.type='checkbox';toggle.checked=step.enabled;toggle.dataset.stepToggle=step.id;toggle.setAttribute('aria-label',(step.enabled?'暂停':'启用')+' '+step.title);toggle.disabled=busy;const choice=button(step.title,'select');choice.dataset.stepSelect=step.id;choice.setAttribute('aria-pressed',String(step.id===selectedId));const subtitle=element('small',`${catalog.tools.find(tool=>tool.id===step.tool)?.title||step.tool} · ${Math.round(step.opacity*100)}%${step.maskRef?' · 有蒙版':''}${!step.enabled?' · 已暂停':''}`);choice.append(subtitle);row.append(toggle,choice);list.append(row);}
    const step=selected(),key=step?current.documentId+':'+step.id+':'+step.tool+':'+JSON.stringify(leaves(resource()?.expression).map(leaf=>[leaf.path,leaf.expression.kind,leaf.expression.mask?.shape])):'empty';
    if(key!==structure){structure=key;details.replaceChildren();if(!step){details.append(element('p','添加一个调整步骤，之后可继续修改参数与范围。'));return;}
      const titleRow=element('div',undefined,'edit-step-name'),name=element('input');name.value=step.title;name.maxLength=120;name.dataset.stepTitle='';name.setAttribute('aria-label','步骤名称');titleRow.append(name,button('命名','rename'));details.append(titleRow);
      const effect=element('div',undefined,'edit-step-effects');effect.append(element('h4','效果'));const tool=catalog.tools.find(tool=>tool.id===step.tool);
      for(const [key,property] of Object.entries(tool.parameters.properties)){if(property.type==='number')effect.append(field(labels[key]||key,step.parameters[key],property.minimum,property.maximum,key));else{const wrap=element('label',labels[key]||key),input=element('select');input.dataset.field=key;input.dataset.kind='parameter';input.setAttribute('aria-label',labels[key]||key);for(const value of property.enum){const option=element('option',value==='limit-positive-gain'?'限制额外高光增益':'允许超白中间值');option.value=value;input.append(option);}input.value=step.parameters[key];wrap.append(input);effect.append(wrap);}}
      effect.append(field('效果强度',step.opacity*100,0,100,'opacity','opacity'),button('重置效果','reset-effect'));details.append(effect);
      const range=element('div',undefined,'edit-step-range');range.append(element('h4','范围'));const mask=resource(),description=element('p',mask?mask.expression.kind==='luminance'?'按本步骤输入明度选择；后续调整仍可影响这里。':mask.expression.kind==='drawn'?'原片坐标中的几何范围，可继续绘制或调整。':'组合范围；各部分参数可分别修改。':'整张照片');range.append(description);
      const tools=element('div',undefined,'edit-step-buttons');tools.append(button('保护高光','highlights'),button('矩形','rectangle'),button('径向','radial'),button('渐变','linear'),button('画笔','brush'));range.append(tools);if(mask){const operation=element('select');operation.dataset.maskOperation='';operation.setAttribute('aria-label','新绘制范围的组合方式');for(const [value,label] of [['replace','替换范围'],['union','添加范围'],['subtract','减去范围'],['intersect','交集范围']]){const option=element('option',label);option.value=value;operation.append(option);}range.append(operation);}
      if(mask){const users=current.steps.filter(value=>value.maskRef?.id===mask.id&&value.maskRef.version===mask.version).length;if(users>1){const wrap=element('label',undefined,'edit-mask-shared'),input=element('input');input.type='checkbox';input.dataset.shareMask='';wrap.append(input,document.createTextNode(`同时更新 ${users} 个使用者`));range.append(wrap);}
        for(const [index,leaf] of leaves(mask.expression).entries()){
          if(leaf.path)range.append(element('h4',`范围部分 ${index+1}`));const fields=[];
          if(leaf.expression.kind==='luminance')fields.push(field('保护起点（线性明度）',leaf.expression.start,0,.99,'start','mask'),field('完全保护（线性明度）',leaf.expression.end,.01,1,'end','mask'));
          else{const m=leaf.expression.mask;if(m.shape!=='brush')for(const key of ['x','y','width','height'])fields.push(field({x:'横向位置',y:'纵向位置',width:'范围宽度',height:'范围高度'}[key],m.rect[key],key==='width'||key==='height'?.005:0,1,key,'mask'));fields.push(field('羽化',m.feather,0,1,'feather','mask'));if(m.shape==='brush')fields.push(field('画笔半径',m.radius,.001,.15,'radius','mask'));}
          for(const field of fields){field.querySelector('input').dataset.maskPath=leaf.path;range.append(field);}
        }
        const views=element('div',undefined,'edit-step-buttons');for(const [mode,label] of [['photo','照片'],['overlay','覆盖范围'],['bw','黑白蒙版']]){const b=button(label,'view');b.dataset.maskView=mode;views.append(b);}range.append(views,button(mask.reference.kind==='live-input'?'参考：实时输入':'参考：冻结原片','reference'),button('反转范围','invert'),button('移除范围','clear-mask'));}
      details.append(range);const actions=element('div',undefined,'edit-step-buttons');for(const [label,action] of [['上移','up'],['下移','down'],['复制','duplicate'],['删除','delete'],['修改此步骤','discuss']])actions.append(button(label,action));details.append(actions);
    }
    if(step){for(const input of details.querySelectorAll('[data-field]')){input.disabled=busy;if(input===document.activeElement)continue;const key=input.dataset.field,m=leafAt(resource()?.expression,input.dataset.maskPath);const value=input.dataset.kind==='opacity'?step.opacity*100:input.dataset.kind==='parameter'?step.parameters[key]:m?.kind==='luminance'?m[key]:key==='feather'?m?.mask?.feather:key==='radius'?m?.mask?.radius:m?.mask?.rect[key];if(value!==undefined){input.value=value;const output=input.closest('label')?.querySelector('output');if(output)output.textContent=String(typeof value==='number'?Number(value.toFixed(3)):value);}input.disabled=busy;}for(const b of details.querySelectorAll('button'))b.disabled=busy;details.querySelector('[data-action="up"]').disabled=busy||current.steps.indexOf(step)===0;details.querySelector('[data-action="down"]').disabled=busy||current.steps.indexOf(step)===current.steps.length-1;for(const b of details.querySelectorAll('[data-mask-view]'))b.setAttribute('aria-pressed',String(b.dataset.maskView===maskMode));}
  }
  return {render,setMessage(value){status.textContent=value;},selected:()=>selectedId};
}
