export function createLetteringEditor({getProject,getBase,json,perform,notice,onTrial,canStart=()=>true}) {
  const $=id=>document.getElementById(id),dialog=$('lettering-dialog');
  let layers=[],selected=0,base=null,dirty=false;
  const layer=()=>layers[selected];
  const fields=['text','x','y','width','size','rotation','opacity','color','background'];
  const styles={airy:{color:'#FFF8EE',background:'#FFF1DD',font:'sans',weight:400},sticker:{color:'#594539',background:'#FFF1DD',font:'rounded',weight:600},editorial:{color:'#FFF8EE',background:'#FFF1DD',font:'serif',weight:400}};
  function tabs(){
    $('lettering-layers').replaceChildren(...layers.map((l,i)=>{const b=document.createElement('button');b.type='button';b.textContent=`${i+1} · ${l.text.slice(0,8)||'新文字'}`;b.setAttribute('aria-pressed',String(i===selected));b.addEventListener('click',()=>{selected=i;render();});return b;}));
    $('lettering-add').disabled=layers.length>=4;
  }
  function render(){
    const l=layer();tabs();$('lettering-fields').hidden=!l;$('lettering-empty').hidden=Boolean(l);$('lettering-remove').hidden=!l;
    if(!l)return;
    for(const key of fields){const e=$('lettering-'+key);e.value=['x','y','width','size','opacity'].includes(key)?Number((l[key]*100).toFixed(1)):l[key];const out=$('lettering-'+key+'-value');if(out)out.textContent=e.value+(key==='rotation'?'°':'%');}
    for(const b of dialog.querySelectorAll('[data-lettering-style]'))b.setAttribute('aria-pressed',String(b.dataset.letteringStyle===l.style));
    for(const b of dialog.querySelectorAll('[data-lettering-decoration]'))b.setAttribute('aria-pressed',String(b.dataset.letteringDecoration===l.decoration));
  }
  function reset(){const p=getProject();const source=getBase?.()||p.versions.find(v=>v.id===p.currentId);base={revision:p.revision,baseVersion:p.currentId,...(p.candidates.some(c=>c.id===source.id)?{fromCandidate:source.id}:{})};$('lettering-source').textContent=`保留「${source.name}」的光色与裁剪，仅调整文字`;layers=structuredClone(source.state.textOverlays||[]);selected=0;dirty=false;render();}
  function add(){layers.push({id:crypto.randomUUID(),text:'',style:'sticker',font:'rounded',weight:600,x:.07,y:.78,width:.6,size:.045,color:'#594539',background:'#FFF1DD',align:'left',rotation:0,opacity:1,decoration:'none'});selected=layers.length-1;dirty=true;render();$('lettering-text').focus();}
  $('lettering-open').addEventListener('click',()=>{if(!canStart())return;reset();if(!layers.length)add();dialog.showModal();if(layer())$('lettering-text').focus();});
  $('lettering-add').addEventListener('click',add);
  $('lettering-reset').addEventListener('click',()=>{reset();notice('已读取所选版本的文字层。');});
  $('lettering-remove').addEventListener('click',()=>{layers.splice(selected,1);selected=Math.max(0,Math.min(selected,layers.length-1));dirty=true;render();});
  dialog.addEventListener('close',()=>{dirty=false;});
  for(const key of fields)$('lettering-'+key).addEventListener('input',event=>{if(!layer())return;layer()[key]=['x','y','width','size','opacity'].includes(key)?Number(event.target.value)/100:key==='rotation'?Number(event.target.value):event.target.value;dirty=true;const out=$('lettering-'+key+'-value');if(out)out.textContent=event.target.value+(key==='rotation'?'°':'%');if(key==='text')tabs();});
  for(const b of dialog.querySelectorAll('[data-lettering-style]'))b.addEventListener('click',()=>{if(!layer())return;const style=b.dataset.letteringStyle;Object.assign(layer(),styles[style],{style});dirty=true;render();});
  for(const b of dialog.querySelectorAll('[data-lettering-decoration]'))b.addEventListener('click',()=>{if(!layer())return;layer().decoration=b.dataset.letteringDecoration;dirty=true;render();});
  for(const b of dialog.querySelectorAll('[data-lettering-position]'))b.addEventListener('click',()=>{if(!layer())return;Object.assign(layer(),({lower:{x:.07,y:.78,width:.6},upper:{x:.07,y:.08,width:.6},right:{x:.54,y:.08,width:.39}}[b.dataset.letteringPosition]));dirty=true;render();});
  $('lettering-trial').addEventListener('click',()=>perform(async()=>{
    if(layers.some(l=>!l.text.trim()))throw Error('写一句想放到照片上的文字，或移除空文字层。');
    const button=$('lettering-trial');button.disabled=true;button.textContent='正在排版…';
    try{const result=await json('candidate',{...base,mode:'lettering',textOverlays:layers,name:'文字点缀版',goal:'保留所选版本的修片效果，仅调整文字排版。',tradeoff:'文字会改变观看顺序。检查是否遮挡主体、小屏是否清楚；可单独导出无字版。'});dirty=false;dialog.close();await onTrial(result.candidate.id);notice('文字试片已准备好，检查位置与可读性后再接受。');}
    finally{button.disabled=false;button.textContent='生成文字试片';}
  }));
  return {dirty:()=>dirty&&dialog.open,refresh(){const p=getProject(),count=p.versions.find(v=>v.id===p.currentId).state.textOverlays?.length||0;$('lettering-state').textContent=count?`${count} 处文字 · 可编辑或导出无字版`:'短句、贴纸、小标题 · 按需开启';}};
}
