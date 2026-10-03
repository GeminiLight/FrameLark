import {seriesPlatforms,seriesPurposes,seriesSequences,seriesBrief,restoreSeries,seriesSignature,seriesCandidate,validateSeriesReview} from './photo-series.js';
import {photoSnapshot,snapshotSettings} from './batch-edits.js';
import {effectiveAnnotations} from './adjustment-layers.js';
import {cropPixelRect} from './crop-utils.js';
import {drawPhotoSource} from './photo-geometry.js';
import {createPhotoRenderer} from './photo-rendering.js';
import {createPhotoViewer} from './photo-viewer.js';
import {createPhotoRequests} from './photo-requests.js';
import {presetById} from './presets.js';
import {enhanceSelectControls} from './select-control.js?v=3';
import {readServiceJSON,requestFailure} from './service-response.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={exposure:'曝光',highlights:'高光',shadows:'阴影',whites:'白色',blacks:'黑色',warmth:'色温',tint:'色调',vibrance:'自然饱和度',saturation:'饱和度',contrast:'对比度'};
const intentExamples={
  story:[['安静日常','温暖而安静的日常细节，保留现场光线与松弛感'],['视觉呼应','从环境到细节，让主体、色彩与留白彼此呼应']],
  travel:[['旅行随记','保留旅行中的记忆点、真实光线与人物关系'],['昼夜记忆','让日间、夕阳与夜色有共同倾向，保留光线的自然变化']],
  portrait:[['自然表情','人物表情自然、肤色真实，保留互动与面部结构'],['柔和人像','光色柔和克制，人物保持清晰，保留肤色与原有阴影关系']],
  event:[['完整记录','保留关键环节和人物覆盖，呈现现场发生的真实关系'],['人物关系','以互动和独有瞬间为主线，保留现场光线与情感价值']],
  catalog:[['真实色彩','准确呈现商品颜色与材质，不用滤镜掩盖关键细节'],['信息完整','让不同角度、细节与使用环境互补，保持产品真实颜色']],
  portfolio:[['克制统一','精选有独立价值的画面，减少重复信息，共同定调保持克制'],['保留差异','让每张照片的独特表达成立，只匹配必要的光色关系']],
  archive:[['现场记录','保留完整的记忆与事件覆盖，只修影响观看的问题'],['温柔日常','保留人物、日常细节与现场气氛，不过度提亮或增色']]
};
export function createSeriesWorkspace({getPhotos,canOpen=()=>true,onChange,onAccept,onExport,onEdit,notify}) {
  document.body.insertAdjacentHTML('beforeend',`<dialog id="series-dialog" class="series-dialog" aria-labelledby="series-title">
    <header class="series-header"><div><span class="export-kicker">PHOTO SERIES</span><h2 id="series-title">把照片，整理成一组作品</h2><p>一起看表达与节奏，分别照顾每张的光线。</p></div><button type="button" id="series-close" aria-label="关闭组图创作">×</button></header>
    <div class="series-body"><section class="series-board" aria-label="组图顺序与试片"><div class="series-board-head"><strong id="series-count"></strong><div id="series-view-switch" hidden><button type="button" data-series-view="current" aria-pressed="false">当前版本</button><button type="button" data-series-view="trial" aria-pressed="true">整组试片</button></div></div><div id="series-grid" class="series-grid"></div><details class="series-members"><summary>选择组图中的照片</summary><div id="series-members"></div></details><p class="series-board-note">第一张作为封面。用箭头调整顺序，点击照片放大对照。</p></section>
    <aside class="series-direction"><div id="series-brief-summary" class="series-brief-summary" hidden></div><div id="series-brief-fields"><div class="series-fields"><label>这组的用途<select id="series-purpose">${seriesPurposes.map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</select></label><label>阅读顺序<select id="series-sequence">${seriesSequences.map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</select></label></div><label for="series-intent">这组想表达什么？</label><textarea id="series-intent" rows="3" maxlength="180" placeholder="例如：山里安静的一天，从日出到暮色，保留真实光线"></textarea><div class="series-examples" id="series-intent-examples"></div><details class="series-output-options"><summary>发布与画幅</summary><div class="series-fields"><label>发布位置<select id="series-platform">${seriesPlatforms.map(p=>`<option value="${p.id}">${p.label}</option>`).join('')}</select></label><label>构图参考<select id="series-ratio"><option value="original">保留原画幅</option><option>3:4</option><option>4:5</option><option>1:1</option><option>9:16</option></select></label></div><small class="series-hint">用途与比例帮助判断表达，不会自动裁剪。</small></details>
    <button type="button" id="series-review" class="primary-button">一起审片，生成试片</button></div><button type="button" id="series-cancel" hidden>取消审片</button><p id="series-status" role="status" aria-live="polite"></p><section id="series-result" hidden aria-label="整组建议"></section></aside></div>
    <footer class="series-footer"><span id="series-footer-note">先整理意图，再看整组试片。</span><div><button type="button" id="series-export">按顺序导出</button><button type="button" id="series-accept" class="primary-button" disabled>接受整组调整</button></div></footer></dialog>
    <dialog id="series-viewer" class="viewer-dialog" aria-label="组图逐张对照"><header><h2 id="series-viewer-title">逐张检查</h2><button type="button" id="series-detail-close" aria-label="关闭对照">×</button></header><div class="viewer-controls"><button id="series-detail-fit" type="button">适应窗口</button><button id="series-detail-actual" type="button">100%</button><button id="series-detail-minus" type="button" aria-label="缩小">−</button><output id="series-detail-scale">100%</output><button id="series-detail-plus" type="button" aria-label="放大">＋</button></div><div class="viewer-choices"><label>当前<select id="series-detail-a"></select></label><label>试片<select id="series-detail-b"></select></label></div><div class="viewer-panes"><div class="viewer-pane" tabindex="0" aria-label="当前版本，拖动平移"><canvas></canvas></div><div class="viewer-pane" tabindex="0" aria-label="组图试片，拖动平移"><canvas></canvas></div></div><p id="series-detail-progress" role="status"></p></dialog>`);
  const $=id=>document.getElementById(id),dialog=$('series-dialog'),requests=createPhotoRequests(),renderer=createPhotoRenderer();
  const detail=createPhotoViewer($('series-viewer'),{prefix:'series-detail'});
  enhanceSelectControls(dialog);enhanceSelectControls($('series-viewer'));
  const entry=document.createElement('button');entry.id='series-open';entry.className='series-entry';entry.type='button';entry.title='组图创作 · 整组理解、逐张精调';entry.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="M8 2h10a3 3 0 0 1 3 3v11M3 14l4-4 4 4 2-2 3 3"/></svg><span>组图</span>';
  $('add-photo-button').before(entry);
  let saved=restoreSeries(null),review=null,plans=[],base='',provenance=null,generation=0,view='trial',renderReady=false,accepted=false,busy=false;
  const photos=()=>getPhotos(),members=()=>saved.ids.map(id=>photos().find(p=>p.id===id)).filter(Boolean);
  const changed=()=>{saved={...saved,...seriesBrief({intent:$('series-intent').value,platform:$('series-platform').value,ratio:$('series-ratio').value,purpose:$('series-purpose').value,sequence:$('series-sequence').value})};updateExamples();onChange();};
  function updateExamples(){const element=$('series-intent-examples');if(element.dataset.purpose===saved.purpose)return;element.dataset.purpose=saved.purpose;element.innerHTML=intentExamples[saved.purpose].map(([label,intent])=>`<button type="button" data-series-intent="${escape(intent)}">${escape(label)}</button>`).join('');}
  const status=text=>{$('series-status').textContent=text;};
  function cancel(){requests.cancel('series');busy=false;$('series-cancel').hidden=true;$('series-review').disabled=members().length<2;}
  function invalidate(){cancel();generation++;review=null;plans=[];renderReady=false;accepted=false;view='trial';dialog.classList.remove('has-series-review');$('series-brief-fields').hidden=false;$('series-brief-summary').hidden=true;dialog.querySelector('[data-series-view="current"]').textContent='当前版本';dialog.querySelector('[data-series-view="trial"]').textContent='整组试片';for(const button of dialog.querySelectorAll('[data-series-view]'))button.setAttribute('aria-pressed',String(button.dataset.seriesView===view));$('series-result').hidden=true;$('series-view-switch').hidden=true;$('series-accept').disabled=true;$('series-export').disabled=members().length<2;$('series-footer-note').textContent='先整理意图，再看整组试片。';status('');}
  function refreshEntry(){entry.hidden=photos().length<2;entry.disabled=!canOpen();}
  function open(ids){
    cancel();const available=photos();saved=restoreSeries(saved,available.map(p=>p.id));
    if(ids?.length>=2)saved.ids=[...new Set(ids)].filter(id=>available.some(p=>p.id===id)).slice(0,12);
    if(saved.ids.length<2)saved.ids=available.map(p=>p.id).slice(0,12);
    $('series-intent').value=saved.intent;$('series-platform').value=saved.platform;$('series-ratio').value=saved.ratio;$('series-purpose').value=saved.purpose;$('series-sequence').value=saved.sequence;updateExamples();
    invalidate();render();dialog.showModal();onChange();
  }
  function render(){
    const list=members();$('series-count').textContent=`${list.length} 张 · ${review?'建议顺序':'当前顺序'}`;
    $('series-grid').classList.toggle('is-pair',list.length===2);
    $('series-review').disabled=busy||list.length<2;
    $('series-export').disabled=list.length<2||Boolean(review&&!accepted);
    $('series-members').innerHTML=photos().map(p=>`<label><input type="checkbox" value="${escape(p.id)}" ${saved.ids.includes(p.id)?'checked':''}/><span>${escape(p.imageName)}</span></label>`).join('');
    $('series-grid').innerHTML=list.map((p,i)=>{
      const plan=plans.find(plan=>plan.photo.id===p.id),item=plan?.item;
      return `<article class="series-photo"><div class="series-photo-head"><span>${i===0?'封面':String(i+1).padStart(2,'0')}</span><div><button type="button" data-series-move="${escape(p.id)}" data-direction="-1" aria-label="前移 ${escape(p.imageName)}" ${i===0?'disabled':''}>←</button><button type="button" data-series-move="${escape(p.id)}" data-direction="1" aria-label="后移 ${escape(p.imageName)}" ${i===list.length-1?'disabled':''}>→</button></div></div><button type="button" class="series-image" data-series-detail="${escape(p.id)}" aria-label="放大对照 ${escape(p.imageName)}"><canvas data-series-canvas="${escape(p.id)}"></canvas></button><div class="series-photo-copy"><strong>${escape(item?.role||p.imageName)}</strong>${item?`<p>${escape(item.reason)}</p><details><summary>依据与逐张变化</summary><p>保留 · ${escape(item.preserve)}</p><p>变化 · ${item.changes.length?item.changes.map(c=>`${names[c.key]} ${c.value>0?'+':''}${c.value}${c.key==='exposure'?' EV':''}`).join(' · '):'保留当前光色'}</p><p>留意 · ${escape(item.tradeoff)}</p><p>构图 · ${escape(item.cropNote)}</p></details>`:'<small>保留每张的原片与已有编辑</small>'}<button type="button" data-series-edit="${escape(p.id)}">逐张精调 ↗</button></div></article>`;
    }).join('');
    renderGallery();
  }
  async function pixels(photo,snapshot,maxSide){
    const rect=cropPixelRect(snapshot.crop,photo.image.naturalWidth,photo.image.naturalHeight),scale=Math.min(1,maxSide/Math.max(rect.width,rect.height));
    const width=Math.max(1,Math.round(rect.width*scale)),height=Math.max(1,Math.round(rect.height*scale)),canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});drawPhotoSource(ctx,photo.image,snapshot.crop,width,height,rect);
    const data=await renderer.render({pixels:ctx.getImageData(0,0,width,height).data,width,height,settings:snapshotSettings(snapshot),annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers),crop:snapshot.crop,frame:{fullWidth:photo.image.naturalWidth,fullHeight:photo.image.naturalHeight,sourceRect:rect,angle:snapshot.crop?.angle||0}});
    ctx.putImageData(new ImageData(data,width,height),0,0);return canvas;
  }
  async function renderGallery(){
    const token=++generation;renderReady=false;$('series-accept').disabled=true;
    try{
      for(const photo of members()){
        const plan=plans.find(p=>p.photo.id===photo.id),snapshot=plan?(view==='trial'?plan.candidate:plan.before):photoSnapshot(photo);
        const source=await pixels(photo,snapshot,480);if(token!==generation||!dialog.open)return;
        const canvas=dialog.querySelector(`[data-series-canvas="${photo.id}"]`);if(!canvas)continue;canvas.width=source.width;canvas.height=source.height;canvas.getContext('2d').drawImage(source,0,0);
      }
      renderReady=true;$('series-accept').disabled=!review||accepted;
    }catch{if(token===generation){status('试片未能完整生成，请重新审片；已有编辑仍保留。');}}
  }
  function result(){
    dialog.classList.add('has-series-review');$('series-brief-fields').hidden=true;$('series-brief-summary').hidden=false;$('series-brief-summary').innerHTML=`<strong>这组的表达</strong><p>${escape(saved.intent)}</p><small>${escape(seriesPurposes.find(p=>p.id===saved.purpose)?.label)} · ${escape(seriesSequences.find(p=>p.id===saved.sequence)?.label)}</small><small>${escape(seriesPlatforms.find(p=>p.id===saved.platform)?.label)} · ${saved.ratio==='original'?'保留原画幅':escape(saved.ratio)+' 构图参考'}</small><div><button type="button" data-series-brief-edit>调整意图</button><button type="button" data-series-review-again>重新审片</button></div>`;
    $('series-result').hidden=false;
    $('series-result').innerHTML=`<span class="series-source">视觉审片 · ${escape(provenance?.model||'已连接模型')}</span><h3>${escape(review.title)}</h3><p>${escape(review.summary)}</p><div class="series-preserve"><strong>值得保留</strong><p>${escape(review.preserve)}</p></div><details><summary>共同定调与取舍</summary><p>${escape(review.sharedStyle.reason)}</p><p>${escape(review.tradeoff)}</p></details>${review.sharedStyle.presetId!=='none'?`<label class="series-style-option"><input type="checkbox" id="series-use-style" checked/><span>共同风格 · ${escape(presetById(review.sharedStyle.presetId)?.name)} ${review.sharedStyle.amount}%<small>替换每张的风格层，保留手动、局部与裁剪。</small></span></label>`:''}`;
    $('series-view-switch').hidden=false;$('series-footer-note').textContent='试片尚未接受 · 原片和当前编辑保持原样';
  }
  async function analyze(){
    changed();if(!saved.intent){status('用一句话告诉我们这组想表达什么。');$('series-intent').focus();return;}
    const list=members(),requestedOrder=[...saved.ids];if(list.length<2)return;
    invalidate();base=seriesSignature(list,saved);const task=requests.start('series');busy=true;$('series-review').disabled=true;$('series-cancel').hidden=false;status('正在读取整组当前效果…');
    try{
      const input=[];
      for(let i=0;i<list.length;i++){
        task.controller.signal.throwIfAborted();const photo=list[i],snapshot=photoSnapshot(photo),canvas=await pixels(photo,snapshot,800);
        input.push({id:photo.id,name:photo.imageName,image:canvas.toDataURL('image/jpeg',.72),intent:photo.creativeIntent,settings:snapshotSettings(snapshot),crop:snapshot.crop,notes:snapshot.annotations.map(n=>({note:n.note,rect:n.rect}))});
        status(`已准备 ${i+1} / ${list.length} 张，正在理解整组表达…`);
      }
      task.controller.signal.throwIfAborted();
      const response=await fetch('/api/series-review',{method:'POST',signal:task.controller.signal,headers:{'Content-Type':'application/json'},body:JSON.stringify({...seriesBrief(saved),photos:input})});
      const value=await readServiceJSON(response,'组图审片');if(!response.ok)throw new Error(value.error?.message||'组图审片暂时不可用，请重试。');
      if(!requests.active(task))return;
      if(base!==seriesSignature(members(),saved))throw new Error('照片、批注或意图已变化，请根据当前版本重新审片。');
      review=validateSeriesReview(value.review,list.map(p=>p.id),saved);provenance=value.provenance;
      plans=list.map(photo=>({photo,...seriesCandidate(photo,review,{layerId:`series-${crypto.randomUUID()}`})}));
      if(JSON.stringify(saved.ids)===JSON.stringify(requestedOrder))saved.ids=[...review.order];else review.order=[...saved.ids];base=seriesSignature(members(),saved);onChange();result();render();dialog.querySelector('.series-body').scrollTop=0;status('整组试片已准备。检查封面、顺序和逐张光色，再决定是否接受。');
    }catch(error){if(requests.owns(task))status(task.controller.signal.aborted && task.controller.signal.reason!=='timeout'?'审片已取消，可以继续整理或重试。':task.controller.signal.aborted || error.visionFailure || error instanceof TypeError ? requestFailure(error,task.controller.signal,'组图审片').message:error.message);}
    finally{if(requests.owns(task)){requests.finish(task);busy=false;$('series-cancel').hidden=true;$('series-review').disabled=members().length<2;}}
  }
  function version(snapshot,id,label){return {id,label,settings:snapshotSettings(snapshot),annotations:effectiveAnnotations(snapshot.annotations,snapshot.advisorLayers),crop:snapshot.crop};}
  entry.addEventListener('click',()=>open());$('series-review').addEventListener('click',analyze);
  $('series-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{cancel();generation++;});
  $('series-cancel').addEventListener('click',()=>{cancel();status('审片已取消，当前编辑保留。');});
  for(const id of ['series-intent','series-platform','series-ratio','series-purpose','series-sequence'])$(id).addEventListener(id==='series-intent'?'input':'change',()=>{const hadReview=Boolean(review);changed();invalidate();if(hadReview)render();});
  dialog.addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button)return;
    if(button.hasAttribute('data-series-brief-edit')){invalidate();render();$('series-intent').focus();}
    if(button.hasAttribute('data-series-review-again'))analyze();
    if(button.dataset.seriesIntent){$('series-intent').value=button.dataset.seriesIntent;changed();invalidate();render();}
    if(button.dataset.seriesMove){const index=saved.ids.indexOf(button.dataset.seriesMove),next=index+Number(button.dataset.direction);if(next<0||next>=saved.ids.length)return;[saved.ids[index],saved.ids[next]]=[saved.ids[next],saved.ids[index]];if(review)review.order=[...saved.ids];onChange();render();dialog.querySelector(`[data-series-move="${button.dataset.seriesMove}"]`)?.focus();}
    if(button.dataset.seriesView){view=button.dataset.seriesView;for(const b of dialog.querySelectorAll('[data-series-view]'))b.setAttribute('aria-pressed',String(b===button));renderGallery();}
    if(button.dataset.seriesEdit){dialog.close();onEdit(button.dataset.seriesEdit);}
    if(button.dataset.seriesDetail){const photo=photos().find(p=>p.id===button.dataset.seriesDetail),plan=plans.find(p=>p.photo.id===photo?.id);if(!photo)return;const before=plan?.before||photoSnapshot(photo),after=plan?.candidate||before;$('series-viewer-title').textContent=photo.imageName;detail.open(photo.image,[version(before,'before','当前版本'),version(after,'trial','组图试片')],'before','trial');}
  });
  $('series-members').addEventListener('change',event=>{const input=event.target.closest('input');if(!input)return;if(input.checked&&saved.ids.length>=12){input.checked=false;notify('每组最多 12 张，可以先移出一张，再加入新照片。');return;}saved.ids=input.checked?[...saved.ids,input.value]:saved.ids.filter(id=>id!==input.value);onChange();invalidate();render();});
  $('series-result').addEventListener('change',()=>{if(!review)return;if(accepted||base!==seriesSignature(members(),saved)){invalidate();render();status('当前编辑已变化，请重新审片。');return;}const useStyle=$('series-use-style')?.checked??true;plans=members().map(photo=>({photo,...seriesCandidate(photo,review,{useStyle,layerId:`series-${crypto.randomUUID()}`})}));render();});
  $('series-accept').addEventListener('click',()=>{
    if(!review||!renderReady||accepted)return;
    if(base!==seriesSignature(members(),saved)){invalidate();render();status('照片、批注或意图已变化，请重新审片；未覆盖任何调整。');return;}
    // New inactive review results do not change the preview; retain them when committing.
    const freshPlans=members().map(photo=>({photo,...seriesCandidate(photo,review,{useStyle:$('series-use-style')?.checked??true,layerId:`series-${crypto.randomUUID()}`})}));
    onAccept(freshPlans);accepted=true;if($('series-use-style'))$('series-use-style').disabled=true;$('series-accept').disabled=true;$('series-export').disabled=false;dialog.querySelector('[data-series-view="current"]').textContent='接受前';dialog.querySelector('[data-series-view="trial"]').textContent='整组结果';$('series-footer-note').textContent='已接受 · 可逐张精调，或按当前顺序导出';status('已保存整组方案；照片的调整可在图库撤销。');
  });
  $('series-export').addEventListener('click',()=>{if(review&&!accepted){notify('先接受或取消试片，再导出当前版本。');return;}dialog.close();onExport([...saved.ids]);});
  return {open,refresh:refreshEntry,draft:()=>structuredClone(saved),restore(value){cancel();saved=restoreSeries(value,photos().map(p=>p.id));invalidate();refreshEntry();}};
}
