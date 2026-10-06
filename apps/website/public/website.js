const examples = {
  architecture: {alt:'建筑窗影与台阶，暗墙略微打开，保留冷色与明暗秩序',credit:'Willian Justen de Vasconcellos',quote:'“光从窗里落下来的方向很美。让暗墙稍微清楚一点，明暗的节奏就留在那里。”',adjustments:[['高光','−8'],['阴影','+12'],['对比度','+3']],keep:'保留窗影的轮廓和画面原有的冷色。'},
  landscape: {alt:'蓝调湖景，木屋与山体倒影，轻轻打开暗部细节',credit:'Luca Bravo',quote:'“蓝调和倒影已经很有气氛。轻轻打开暗部，让木屋多一点细节，夜色仍然是夜色。”',adjustments:[['阴影','+10'],['曝光','+0.18 EV'],['高光','−6']],keep:'保留山体倒影和蓝调，不把夜景修成白天。'},
  portrait: {assetPrefix:'portrait-generated',sourceLabel:'AI 生成示例 / imagegen',alt:'AI 生成的林间自然光人像示例，保留柔光与肌肤纹理',quote:'“这张示例的柔光值得保留。试着轻收亮部、稍开暗部，比较后再决定要不要这点变化。”',adjustments:[['高光','−12'],['阴影','+8'],['曝光','+0.06 EV']],keep:'保留柔和侧光与自然的光色关系，轻量试修由你决定。'}
};

const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
const feedbackByElement=new WeakMap();
const activeFeedback=new Set();
function arrive(element,{duration=260,startOpacity=.88}={}){
  if(!element||reducedMotion.matches||typeof element.animate!=='function')return;
  feedbackByElement.get(element)?.cancel();
  // Opacity feedback never replaces a photograph's existing rotation or position.
  const animation=element.animate([{opacity:startOpacity},{opacity:1}],{duration:Math.min(duration,300),easing:'cubic-bezier(.2,.65,.3,1)'});
  feedbackByElement.set(element,animation);activeFeedback.add(animation);
  const release=()=>{activeFeedback.delete(animation);if(feedbackByElement.get(element)===animation)feedbackByElement.delete(element);};
  animation.finished.then(release,release);
}

const header = document.querySelector('.site-header');
const menuToggle = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('#mobile-menu');
function closeMenu(){ menuToggle.setAttribute('aria-expanded','false'); menuToggle.setAttribute('aria-label','打开导航'); mobileMenu.hidden=true; }
menuToggle.addEventListener('click',()=>{const open=menuToggle.getAttribute('aria-expanded')!=='true'; menuToggle.setAttribute('aria-expanded',String(open));menuToggle.setAttribute('aria-label',open?'关闭导航':'打开导航');mobileMenu.hidden=!open;});
mobileMenu.querySelectorAll('a').forEach(link=>link.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!mobileMenu.hidden){closeMenu();menuToggle.focus();}});
window.matchMedia('(min-width:681px)').addEventListener('change',event=>{if(event.matches)closeMenu();});
const updateHeader=()=>{header.classList.toggle('scrolled',window.scrollY>12);const total=document.documentElement.scrollHeight-window.innerHeight;header.style.setProperty('--read-progress',total>0?String(Math.min(1,window.scrollY/total)):'0');};
window.addEventListener('scroll',updateHeader,{passive:true});updateHeader();
window.addEventListener('resize',updateHeader,{passive:true});

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
    arrive(comparison);
    arrive(document.querySelector('#demo-quote'));
    arrive(list);
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

const eyeScenes={
  arcade:{title:'光影拱廊',board:'/assets/website/photography-board.webp',original:'/assets/cases/arcade-reference.png',alt:'拱廊现场的五种机位与拍法参考'},
  cafe:{title:'玻璃倒影',board:'/assets/website/cafe-board.webp',original:'/assets/cases/cafe-reference.png',alt:'咖啡馆玻璃倒影的五种机位与拍法参考'},
  lakeside:{title:'湖岸暖光',board:'/assets/website/lakeside-board.webp',original:'/assets/website/lakeside-board.webp',alt:'湖岸暖光的五种拍法参考，金色树叶、蓝色湖水与散步的人'}
};
const eyeTabs=[...document.querySelectorAll('[data-eye-case]')];
const eyeArt=document.querySelector('.eye-art');
const eyeTotal=document.querySelector('#eye-total');
if(eyeTotal)eyeTotal.textContent=String(eyeTabs.length).padStart(2,'0');
let eyeIndex=0,eyeRequest=0;
async function selectEye(index){
  index=(index+eyeTabs.length)%eyeTabs.length;
  const request=++eyeRequest;
  if(index===eyeIndex){eyeArt.setAttribute('aria-busy','false');return;}
  const tab=eyeTabs[index],panel=document.getElementById(tab.getAttribute('aria-controls'));
  eyeArt.setAttribute('aria-busy','true');
  try{
    await Promise.all([...panel.querySelectorAll('img')].map(img=>loadImage(img.src)));
    if(request!==eyeRequest)return;
    eyeIndex=index;
    eyeTabs.forEach((item,i)=>{item.setAttribute('aria-selected',String(i===index));item.tabIndex=i===index?0:-1;document.getElementById(item.getAttribute('aria-controls')).hidden=i!==index;});
    document.querySelector('#eye-current').textContent=String(index+1).padStart(2,'0');
    document.querySelector('#eye-announcement').textContent=`已切换到${eyeScenes[tab.dataset.eyeCase].title}，现场输入与五种拍法参考。`;
    arrive(panel.querySelector('.scene-input'));
    arrive(panel.querySelector('.scene-output'));
  }catch{
    if(request===eyeRequest)document.querySelector('#eye-announcement').textContent='案例图片暂未加载完成，请再次点击重试。';
  }finally{if(request===eyeRequest)eyeArt.setAttribute('aria-busy','false');}
}
function bindTabKeys(items,select){
  items.forEach((tab,index)=>tab.addEventListener('keydown',event=>{
    let next;
    if(event.key==='ArrowRight')next=(index+1)%items.length;
    if(event.key==='ArrowLeft')next=(index-1+items.length)%items.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=items.length-1;
    if(next!==undefined){event.preventDefault();items[next].focus();select(next);}
  }));
}
eyeTabs.forEach((tab,index)=>tab.addEventListener('click',()=>selectEye(index)));
bindTabKeys(eyeTabs,selectEye);
document.querySelectorAll('[data-eye-direction]').forEach(button=>button.addEventListener('click',()=>selectEye(eyeIndex+Number(button.dataset.eyeDirection))));
let touchStart,lastSwipe=0;
eyeArt.addEventListener('pointerdown',event=>{if(event.pointerType==='touch')touchStart={x:event.clientX,y:event.clientY};});
eyeArt.addEventListener('pointercancel',()=>{touchStart=undefined;});
eyeArt.addEventListener('pointerup',event=>{if(!touchStart)return;const dx=event.clientX-touchStart.x,dy=event.clientY-touchStart.y;touchStart=undefined;if(Math.abs(dx)>55&&Math.abs(dx)>Math.abs(dy)*1.5){lastSwipe=Date.now();selectEye(eyeIndex+(dx<0?1:-1));}});
eyeArt.addEventListener('click',event=>{if(Date.now()-lastSwipe<400){event.preventDefault();event.stopImmediatePropagation();}},true);

const seriesSteps={
  theme:{title:'先找到，它们共有的气氛。',description:'猫的目光、木桌上的咖啡。让「安静日常」成为选择和取舍的线索。'},
  order:{title:'让目光，顺着故事走。',description:'先用猫的目光让人停下来，再接一杯咖啡。试试这个顺序，让两张照片彼此呼应。'},
  edit:{title:'气氛连在一起，细节各自保留。',description:'逐张比较光色，再决定调整的幅度。保留猫的毛发、白瓷与暖木各自的质感。'}
};
const seriesTabs=[...document.querySelectorAll('[data-series-step]')];
function selectSeries(index){
  const tab=seriesTabs[index];if(tab.getAttribute('aria-selected')==='true')return;
  const step=tab.dataset.seriesStep,content=seriesSteps[step],panel=document.querySelector('#series-step-panel');
  seriesTabs.forEach(item=>{item.setAttribute('aria-selected',String(item===tab));item.tabIndex=item===tab?0:-1;});
  panel.setAttribute('aria-labelledby',tab.id);
  panel.querySelector('.series-step-title').textContent=content.title;
  panel.querySelector('.series-step-description').textContent=content.description;
  document.querySelector('.series-case').dataset.step=step;
  arrive(panel);
}
seriesTabs.forEach((tab,index)=>tab.addEventListener('click',()=>selectSeries(index)));
bindTabKeys(seriesTabs,selectSeries);

document.querySelectorAll('[data-open]').forEach(button=>button.addEventListener('click',()=>{
  const dialog=document.getElementById(button.dataset.open);if(!dialog)return;
  if(button.dataset.board){const scene=eyeScenes[button.dataset.board];dialog.querySelector('#board-dialog-title').textContent=`${scene.title} · 五种拍法`;dialog.querySelector('img').src=scene.board;dialog.querySelector('img').alt=scene.alt;dialog.querySelector('.original-board-link').href=scene.original;}
  closeMenu();dialog.showModal();document.body.classList.add('has-dialog');
}));
document.querySelectorAll('.site-dialog').forEach(dialog=>{
  dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>document.body.classList.remove('has-dialog'));
  dialog.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))dialog.close();});
});

// Content is visible without JavaScript; entrance animations run only in view.
if('IntersectionObserver' in window){
  const entrances=new IntersectionObserver(entries=>entries.forEach(entry=>{
    if(!entry.isIntersecting)return;
    entrances.unobserve(entry.target);
    arrive(entry.target,{startOpacity:.96});
  }),{threshold:.12});
  document.querySelectorAll('.hero-copy,.hero-main-photo,.hero-small-photo,.journey,.section-heading,.eye-art,.eye-points,.atelier-demo,.chapter-case,.craft-principles,.series-photos,.series-story,.expression-features,.companion-portrait,.companion-copy,.faq-intro,.faq-list,.start-inner').forEach(element=>entrances.observe(element));
  const links=[...document.querySelectorAll('.desktop-nav a,.mobile-menu a')];
  const sections=[...document.querySelectorAll('#eye,#craft,#series,#companion')];
  let chapterFrame=0;
  const updateChapter=()=>{
    chapterFrame=0;
    const readingLine=innerHeight*.4;
    const active=sections.find(section=>{const rect=section.getBoundingClientRect();return rect.top<=readingLine&&rect.bottom>readingLine;});
    links.forEach(link=>{if(active&&link.getAttribute('href')===`#${active.id}`)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  };
  const scheduleChapter=()=>{if(!chapterFrame)chapterFrame=requestAnimationFrame(updateChapter);};
  window.addEventListener('scroll',scheduleChapter,{passive:true});window.addEventListener('resize',scheduleChapter,{passive:true});scheduleChapter();
}

// The divider moves only when the visitor drags or uses its arrow keys.
reducedMotion.addEventListener('change',event=>{if(event.matches)activeFeedback.forEach(animation=>animation.cancel());});
// Old shared links now land at the case switcher in the first chapter.
function redirectLegacyCase(){if(location.hash==='#cases'){history.replaceState(null,'','#eye');document.querySelector('#eye').scrollIntoView();}}
window.addEventListener('hashchange',redirectLegacyCase);redirectLegacyCase();
