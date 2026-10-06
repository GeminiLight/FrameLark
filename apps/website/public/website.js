const examples = {
  architecture: {alt:'建筑窗影与台阶，暗墙略微打开，保留冷色与明暗秩序',credit:'Willian Justen de Vasconcellos',quote:'“光从窗里落下来的方向很美。让暗墙稍微清楚一点，明暗的节奏就留在那里。”',adjustments:[['高光','−8'],['阴影','+12'],['对比度','+3']],keep:'保留窗影的轮廓和画面原有的冷色。'},
  landscape: {alt:'蓝调湖景，木屋与山体倒影，轻轻打开暗部细节',credit:'Luca Bravo',quote:'“蓝调和倒影已经很有气氛。轻轻打开暗部，让木屋多一点细节，夜色仍然是夜色。”',adjustments:[['阴影','+10'],['曝光','+0.18 EV'],['高光','−6']],keep:'保留山体倒影和蓝调，不把夜景修成白天。'},
  portrait: {assetPrefix:'portrait-generated',sourceLabel:'AI 生成示例 / imagegen',alt:'AI 生成的林间自然光人像示例，保留柔光与肌肤纹理',quote:'“这张示例的柔光值得保留。试着轻收亮部、稍开暗部，比较后再决定要不要这点变化。”',adjustments:[['高光','−12'],['阴影','+8'],['曝光','+0.06 EV']],keep:'保留柔和侧光与自然的光色关系，轻量试修由你决定。'}
};

const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');
function closeMenu(){ menuToggle.setAttribute('aria-expanded','false'); menuToggle.setAttribute('aria-label','打开导航'); mobileMenu.hidden=true; }
menuToggle.addEventListener('click',()=>{const open=menuToggle.getAttribute('aria-expanded')!=='true'; menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'关闭导航':'打开导航');mobileMenu.hidden=!open;});
mobileMenu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!mobileMenu.hidden){closeMenu();menuToggle.focus();}});
window.matchMedia('(min-width:681px)').addEventListener('change',event=>{if(event.matches)closeMenu();});
const updateHeader=()=>header.classList.toggle('scrolled',window.scrollY>12);
window.addEventListener('scroll',updateHeader,{passive:true});updateHeader();

const range=document.querySelector('#compare-range');
const comparison=document.querySelector('.comparison');
range.disabled=false;
function updateComparison(){comparison.style.setProperty('--split',`${range.value}%`);range.setAttribute('aria-valuetext',`原片显示 ${range.value}%，调整后显示 ${100-Number(range.value)}%`);}
range.addEventListener('input',updateComparison);updateComparison();

const tabs=[...document.querySelectorAll('[data-demo]')];
const afterImage=document.querySelector('.compare-after');
const beforeImage=document.querySelector('.compare-before');
let requestId=0;
const imageCache=new Map();
function loadImage(url){if(!imageCache.has(url)){const task=new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('图片暂未加载完成'));img.src=url;});imageCache.set(url,task);task.catch(()=>imageCache.delete(url));}return imageCache.get(url);}
async function selectExample(tab){
  const id=tab.dataset.demo;
  if(tab.getAttribute('aria-selected')==='true'){if(comparison.getAttribute('aria-busy')==='true'){++requestId;comparison.setAttribute('aria-busy','false');}return;}
  const thisRequest=++requestId;
  comparison.setAttribute('aria-busy','true');
  const assetPrefix=examples[id].assetPrefix||id;
  const before=`/assets/website/${assetPrefix}-before.webp`;const after=`/assets/website/${assetPrefix}-gentle.webp`;
  try{
    await Promise.all([loadImage(before),loadImage(after)]);
    if(thisRequest!==requestId)return;
    const example=examples[id];
    document.querySelector('.compare-instruction').innerHTML='<span aria-hidden="true">↔</span>拖动分界线，看见细微的变化';
    beforeImage.src=before;afterImage.src=after;beforeImage.alt=`调整前：${example.alt}`;afterImage.alt=`轻量调整后：${example.alt}`;
    tabs.forEach(item=>{const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;});
    document.querySelector('#demo-panel').setAttribute('aria-labelledby',tab.id);
    document.querySelector('#demo-credit').textContent=example.sourceLabel||`摄影 / ${example.credit}`;
    document.querySelector('.before-label').textContent=example.sourceLabel?'示例原图':'原片';
    document.querySelector('#demo-quote').textContent=example.quote;
    document.querySelector('#demo-keep').textContent=example.keep;
    const list=document.querySelector('#demo-adjustments');list.replaceChildren(...example.adjustments.map(([label,value])=>{const li=document.createElement('li');const name=document.createElement('span');const number=document.createElement('strong');name.textContent=label;number.textContent=value;li.append(name,number);return li;}));
  }catch{
    if(thisRequest===requestId)document.querySelector('.compare-instruction').textContent='图片暂未加载完成，请再点一次样张重试。';
  }finally{if(thisRequest===requestId)comparison.setAttribute('aria-busy','false');}
}
tabs.forEach((tab,index)=>{
  tab.addEventListener('click',()=>selectExample(tab));
  tab.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%tabs.length;
    if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=tabs.length-1;
    if(next!==undefined){event.preventDefault();tabs[next].focus();selectExample(tabs[next]);}
  });
});

document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>{
  const dialog=document.getElementById(button.dataset.open);if(!dialog)return;
  closeMenu();dialog.showModal();document.body.classList.add('has-dialog');
}));
document.querySelectorAll('.site-dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>document.body.classList.remove('has-dialog'));
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();});
});
