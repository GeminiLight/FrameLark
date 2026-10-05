// Historical attachments describe the sent ranges, independent of today's edits.
export function attachmentContext(message,reply) {
  const notes=message?.context?.annotations || [];
  let captured=[];
  if(reply?.role==='assistant' && reply.requestQuestion===message.text) {
    try { const value=JSON.parse(reply.baseAnnotations);if(Array.isArray(value))captured=value; } catch {}
  }
  return notes.slice(0,8).map(item=>{
    const saved=captured.find(entry=>entry.id===item.id && entry.number===item.number && entry.note===item.note);
    const rect=validAttachmentRect(item.rect) || validAttachmentRect(saved?.rect);
    return {id:item.id,number:item.number,note:String(item.note || '').slice(0,300),rect};
  });
}

export function validAttachmentRect(rect) {
  if(!rect || !['x','y','width','height'].every(key=>Number.isFinite(rect[key])))return null;
  const {x,y,width,height}=rect;
  if(x<0 || y<0 || width<=0 || height<=0 || x+width>1.00001 || y+height>1.00001)return null;
  return {x,y,width:Math.min(width,1-x),height:Math.min(height,1-y)};
}

export function annotationPreviewFrame(rect,width,height) {
  const area=validAttachmentRect(rect);
  if(!area || !width || !height)return null;
  let w=Math.max(area.width*1.35,.10),h=Math.max(area.height*1.35,.08);
  const ratio=1.65*height/width;
  if(w/h<ratio)w=h*ratio;else h=w/ratio;
  w=Math.min(1,w);h=Math.min(1,h);
  return {x:Math.max(0,Math.min(1-w,area.x+area.width/2-w/2)),
    y:Math.max(0,Math.min(1-h,area.y+area.height/2-h/2)),width:w,height:h};
}

export function createAnnotationPeek({getEntry,getImage,highlight}) {
  const popup=document.querySelector('#annotation-peek'),canvas=popup.querySelector('canvas');
  let active=null,pinned=false,leaveTimer,returningFocus=null;
  const clearTimer=()=>clearTimeout(leaveTimer);
  function hide({restoreFocus=false}={}) {
    clearTimer();const anchor=active;
    if(anchor){anchor.setAttribute('aria-expanded','false');anchor.removeAttribute('aria-describedby');}
    active=null;pinned=false;popup.hidden=true;highlight(null);
    if(restoreFocus && anchor?.isConnected) {
      returningFocus=anchor;anchor.focus({preventScroll:true});
      queueMicrotask(()=>{returningFocus=null;});
    }
  }
  function position() {
    if(!active?.isConnected)return hide();
    const anchor=active.getBoundingClientRect(),mobile=innerWidth<=960;
    const bar=document.querySelector('.topbar')?.getBoundingClientRect(),nav=document.querySelector('.mobile-spaces')?.getBoundingClientRect();
    const top=mobile ? Math.max(12,(bar?.bottom || 62)+12):12;
    const bottom=mobile && nav?.height ? Math.min(innerHeight-12,nav.top-12):innerHeight-12;
    popup.style.maxHeight=`${Math.max(80,bottom-top)}px`;
    const box=popup.getBoundingClientRect();
    let x=anchor.left-box.width-12;
    if(x<12)x=anchor.left;
    let y=anchor.top;
    if(mobile)y=anchor.bottom+8+box.height<=bottom ? anchor.bottom+8:anchor.top-box.height-8;
    x=Math.max(12,Math.min(innerWidth-box.width-12,x));
    y=Math.max(top,Math.min(bottom-box.height,y));
    popup.style.left=`${x}px`;popup.style.top=`${y}px`;
  }
  function show(anchor,{pin=false}={}) {
    const item=getEntry(anchor);if(!item)return;
    clearTimer();if(active && active!==anchor)hide();active=anchor;pinned=pin || pinned;
    const historical=anchor.dataset.annotationPeek==='message';
    popup.querySelector('#annotation-peek-title').textContent=`标记 ${item.number}`;
    popup.querySelector('#annotation-peek-source').textContent=historical?'发送时的批注':'将随消息一起发送';
    popup.querySelector('#annotation-peek-note').textContent=item.note || '已圈选这处，尚未填写评论。';
    popup.querySelector('#annotation-peek-image-caption').textContent=item.rect?'原片圈选范围':'这条历史消息未保存圈选范围';
    const image=getImage(),frame=annotationPreviewFrame(item.rect,image?.naturalWidth,image?.naturalHeight);
    canvas.hidden=!frame;
    if(frame) {
      const W=image.naturalWidth,H=image.naturalHeight;
      const scale=Math.min(480/(frame.width*W),320/(frame.height*H));
      canvas.width=Math.max(1,Math.round(frame.width*W*scale));canvas.height=Math.max(1,Math.round(frame.height*H*scale));
      const context=canvas.getContext('2d');
      context.drawImage(image,frame.x*W,frame.y*H,frame.width*W,frame.height*H,0,0,canvas.width,canvas.height);
      const x=(item.rect.x-frame.x)/frame.width*canvas.width,y=(item.rect.y-frame.y)/frame.height*canvas.height;
      context.strokeStyle='#ffe6bc';context.lineWidth=3;
      context.strokeRect(x,y,item.rect.width/frame.width*canvas.width,item.rect.height/frame.height*canvas.height);
    }
    popup.hidden=false;anchor.setAttribute('aria-expanded','true');anchor.setAttribute('aria-describedby','annotation-peek-note');
    highlight(item);position();
  }
  function leave() {
    clearTimer();leaveTimer=setTimeout(()=>{
      if(!pinned && !popup.matches(':hover') && !popup.contains(document.activeElement) && document.activeElement!==active)hide();
    },140);
  }
  document.addEventListener('pointerover',event=>{
    const anchor=event.target.closest('[data-annotation-peek]');
    if(event.pointerType!=='mouse' || !matchMedia('(hover:hover)').matches || !anchor || anchor.contains(event.relatedTarget))return;
    show(anchor);
  });
  document.addEventListener('pointerout',event=>{if(event.target.closest('[data-annotation-peek]')===active && !active?.contains(event.relatedTarget))leave();});
  document.addEventListener('focusin',event=>{const anchor=event.target.closest('[data-annotation-peek]');if(anchor && anchor!==returningFocus)show(anchor);});
  document.addEventListener('focusout',event=>{if(event.target.closest('[data-annotation-peek]')===active || popup.contains(event.target))leave();});
  document.addEventListener('click',event=>{
    const anchor=event.target.closest('.annotation-attachment');if(!anchor)return;
    if(active===anchor && pinned)hide();else show(anchor,{pin:true});
  });
  document.addEventListener('pointerdown',event=>{if(active && !popup.contains(event.target) && !event.target.closest('[data-annotation-peek]'))hide();},true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && active){event.preventDefault();event.stopImmediatePropagation();hide({restoreFocus:popup.contains(document.activeElement)});}
  },true);
  popup.addEventListener('pointerenter',clearTimer);popup.addEventListener('pointerleave',leave);
  popup.querySelector('button').addEventListener('click',()=>hide({restoreFocus:true}));
  document.addEventListener('scroll',event=>{
    if(!active || popup.contains(event.target))return;
    const box=active.getBoundingClientRect();
    const focused=document.activeElement===active || popup.contains(document.activeElement);
    if(!pinned && !focused || box.bottom<74 || box.top>innerHeight-72)hide();else position();
  },true);
  window.addEventListener('resize',()=>hide());window.addEventListener('blur',()=>hide());
  return {hide,refresh(){if(active?.isConnected)show(active);else if(active)hide();}};
}
