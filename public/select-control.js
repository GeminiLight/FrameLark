// The original select owns values and change events. The visual control is a
// progressive enhancement, with one shared keyboard/focus pattern everywhere.
export function enhanceSelectControls(root=document) {
  const document=root.ownerDocument || root,view=document.defaultView;
  const valueDescriptor=Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype,'value');
  const indexDescriptor=Object.getOwnPropertyDescriptor(view.HTMLSelectElement.prototype,'selectedIndex');
  const controls=new Map();let active=null,sequence=0;
  // Older browsers retain their usable native picker.
  if(!view.HTMLElement.prototype.showPopover)return {refresh(){},destroy(){}};
  const arrow='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg>';
  const check='<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 8 3 3 6-6"/></svg>';
  const visibleOptions=select=>Array.from(select.options).filter(option=>!option.hidden&&!option.closest('optgroup')?.hidden);
  function enhance(select) {
    if(controls.has(select)||select.multiple||select.size>1)return;
    const id=select.id || `photo-select-${++sequence}`;
    const labels=Array.from(select.labels || []);
    const labelText=labels.map(label=>{const copy=label.cloneNode(true);copy.querySelectorAll('select,output').forEach(el=>el.remove());return copy.textContent.trim();}).join(' ');
    const wrapper=document.createElement('span');wrapper.className='select-control';wrapper.dataset.select=select.id;
    const trigger=document.createElement('button');trigger.type='button';trigger.className='select-trigger';trigger.id=`${id}-control`;
    trigger.setAttribute('role','combobox');trigger.setAttribute('aria-haspopup','listbox');trigger.setAttribute('aria-expanded','false');
    const text=document.createElement('span');text.className='select-value';
    const chevron=document.createElement('span');chevron.className='select-chevron';chevron.innerHTML=arrow;
    trigger.append(text,chevron);
    const menu=document.createElement('span');menu.id=`${id}-options`;menu.className='select-menu';menu.popover='manual';menu.hidden=true;
    menu.setAttribute('role','listbox');trigger.setAttribute('aria-controls',menu.id);
    const heading=document.createElement('span');heading.className='select-menu-label';heading.setAttribute('aria-hidden','true');
    const list=document.createElement('span');list.className='select-menu-items';menu.append(heading,list);
    select.before(wrapper);wrapper.append(select,trigger,menu);
    const oldHidden=select.hidden,oldTabIndex=select.tabIndex,oldAriaHidden=select.getAttribute('aria-hidden');
    select.hidden=true;select.tabIndex=-1;select.setAttribute('aria-hidden','true');
    const labelFors=labels.map(label=>[label,label.htmlFor]);
    labels.forEach(label=>{label.htmlFor=trigger.id;});
    let options=[],rows=[],cursor=-1,opened=false,typeBuffer='',typedAt=0,anchorRect=null;
    let signature='',selectedValue=select.value;
    const enabled=index=>options[index]&&!options[index].disabled&&!options[index].closest('optgroup')?.disabled;
    const indexes=()=>options.map((_,i)=>i).filter(enabled);
    const name=()=>select.getAttribute('aria-label') || labelText || select.title || '选择选项';
    function sync() {
      options=visibleOptions(select);
      const nextSignature=options.map(option=>`${option.value}\0${option.textContent}\0${option.disabled}\0${option.closest('optgroup')?.disabled}`).join('\n');
      if(signature!==nextSignature){
        signature=nextSignature;list.replaceChildren();rows=options.map((option,index)=>{
          const row=document.createElement('span');row.className='select-option';row.id=`${id}-option-${index}`;row.setAttribute('role','option');row.dataset.index=index;
          const mark=document.createElement('span');mark.className='select-option-check';mark.innerHTML=check;
          const label=document.createElement('span');label.className='select-option-name';label.textContent=option.label;
          row.append(mark,label);row.setAttribute('aria-disabled',String(!enabled(index)));list.append(row);return row;
        });
        if(opened)close(false);
      }
      const option=select.selectedOptions[0];text.textContent=option?.dataset.displayLabel || option?.label || '请选择';
      trigger.title=option?.label || '';trigger.setAttribute('aria-label',`${name()}，${option?.label || '请选择'}`);
      heading.textContent=labelText.length>1 ? labelText:name();menu.setAttribute('aria-label',name());
      const description=select.getAttribute('aria-describedby');
      if(description)trigger.setAttribute('aria-describedby',description);else trigger.removeAttribute('aria-describedby');
      trigger.disabled=select.disabled||indexes().length<2;wrapper.classList.toggle('select-readonly',trigger.disabled);
      rows.forEach((row,index)=>row.setAttribute('aria-selected',String(options[index]===option)));
      if(opened&&(selectedValue!==select.value||trigger.disabled))close(false);
      selectedValue=select.value;
    }
    function position() {
      const rect=trigger.getBoundingClientRect(),viewport=view.visualViewport;
      anchorRect={left:rect.left,top:rect.top};
      const left=viewport?.offsetLeft || 0,top=viewport?.offsetTop || 0,width=viewport?.width || view.innerWidth,height=viewport?.height || view.innerHeight;
      const menuWidth=Math.min(Math.max(rect.width,224),width-24);
      menu.style.width=`${menuWidth}px`;menu.style.maxHeight=`${Math.max(80,Math.min(360,height-24))}px`;
      const desired=menu.scrollHeight,below=top+height-rect.bottom-20,above=rect.top-top-20;
      const upward=below<Math.min(desired,240)&&above>below;
      const available=Math.max(80,upward?above:below);
      menu.style.maxHeight=`${Math.min(desired,available,360)}px`;
      menu.style.left=`${Math.max(left+12,Math.min(rect.left,left+width-menuWidth-12))}px`;
      menu.style.top=`${upward?rect.top-8-Math.min(desired,available,360):rect.bottom+8}px`;
      menu.dataset.side=upward?'above':'below';
    }
    function point(index,{scroll=true}={}) {
      if(!enabled(index))return;cursor=index;
      rows.forEach((row,i)=>row.classList.toggle('is-active',i===index));
      trigger.setAttribute('aria-activedescendant',rows[index].id);
      if(scroll){
        // Reveal only within this popup; scrollIntoView also moves its panel
        // ancestors even though the popup lives in the browser's top layer.
        const row=rows[index].getBoundingClientRect(),box=menu.getBoundingClientRect();
        const top=box.top+menu.clientTop+6,bottom=box.top+menu.clientTop+menu.clientHeight-6;
        if(row.top<top)menu.scrollTop+=row.top-top;
        else if(row.bottom>bottom)menu.scrollTop+=row.bottom-bottom;
      }
    }
    function open() {
      sync();if(trigger.disabled||!trigger.isConnected)return;
      if(active&&active!==control)active.close(false);
      active=control;opened=true;wrapper.classList.add('is-open');trigger.setAttribute('aria-expanded','true');
      menu.hidden=false;menu.showPopover();position();
      const chosen=options.indexOf(select.selectedOptions[0]);point(enabled(chosen)?chosen:indexes()[0]);
    }
    function close(focus=true) {
      if(!opened)return;opened=false;menu.hidePopover();menu.hidden=true;wrapper.classList.remove('is-open');
      trigger.setAttribute('aria-expanded','false');trigger.removeAttribute('aria-activedescendant');
      rows.forEach(row=>row.classList.remove('is-active'));typeBuffer='';
      if(active===control)active=null;
      if(focus&&trigger.isConnected&&!trigger.disabled)trigger.focus({preventScroll:true});
    }
    function commit(focus=true) {
      if(!enabled(cursor))return;const value=options[cursor].value,changed=value!==select.value;
      close(focus);select.value=value;
      if(changed){select.dispatchEvent(new view.Event('input',{bubbles:true}));select.dispatchEvent(new view.Event('change',{bubbles:true}));}
      sync();
    }
    function keydown(event) {
      if(event.ctrlKey||event.metaKey||trigger.disabled)return;
      const keys=['ArrowDown','ArrowUp','Home','End','PageDown','PageUp','Enter',' ','Escape'];
      if(event.key==='Tab'){if(opened)commit(false);return;}
      if(keys.includes(event.key)){
        if(event.key==='Escape'){if(opened){event.preventDefault();event.stopPropagation();close();}return;}
        event.preventDefault();event.stopPropagation();
        if(!opened){open();if(!['Home','End'].includes(event.key))return;}
        if(event.key==='Enter'||event.key===' '){commit();return;}
        if(event.altKey&&event.key==='ArrowUp'){commit();return;}
        const valid=indexes(),current=valid.indexOf(cursor),last=valid.length-1;
        const next=event.key==='Home'?0:event.key==='End'?last:Math.max(0,Math.min(last,current+(event.key==='PageDown'?10:event.key==='PageUp'?-10:event.key==='ArrowDown'?1:-1)));
        point(valid[next]);return;
      }
      if(event.key.length===1&&!event.altKey){
        event.preventDefault();event.stopPropagation();if(!opened)open();
        const now=Date.now(),letter=event.key.toLocaleLowerCase();typeBuffer=now-typedAt>700?letter:typeBuffer+letter;typedAt=now;
        const repeat=Array.from(typeBuffer).every(char=>char===letter),term=repeat?letter:typeBuffer;
        const valid=indexes(),start=Math.max(0,valid.indexOf(cursor)+(repeat?1:0));
        const order=[...valid.slice(start),...valid.slice(0,start)];
        const next=order.find(i=>options[i].label.trim().toLocaleLowerCase().startsWith(term));if(next!==undefined)point(next);
      }
    }
    const click=()=>opened?close():open();
    const blur=()=>{if(opened)commit(false);};
    const pointer=event=>{const row=event.target.closest('.select-option');if(row&&menu.contains(row)&&enabled(Number(row.dataset.index))){event.preventDefault();point(Number(row.dataset.index),{scroll:false});}};
    const choose=event=>{const row=event.target.closest('.select-option');if(row&&menu.contains(row)&&enabled(Number(row.dataset.index))){event.preventDefault();event.stopPropagation();point(Number(row.dataset.index),{scroll:false});commit();}};
    trigger.addEventListener('click',click);trigger.addEventListener('keydown',keydown);trigger.addEventListener('blur',blur);trigger.addEventListener('focus',sync);
    menu.addEventListener('pointerdown',pointer);menu.addEventListener('click',choose);select.addEventListener('change',sync);
    const observer=new view.MutationObserver(sync);observer.observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','hidden','label','selected','value','data-display-label','aria-label','aria-describedby','title']});
    // App renderers set .value without a change event; mirror those writes promptly,
    // while retaining the browser's own selection and validation semantics.
    const previousValue=Object.getOwnPropertyDescriptor(select,'value'),previousIndex=Object.getOwnPropertyDescriptor(select,'selectedIndex');
    for(const [property,descriptor] of [['value',valueDescriptor],['selectedIndex',indexDescriptor]])Object.defineProperty(select,property,{configurable:true,get(){return descriptor.get.call(this);},set(value){descriptor.set.call(this,value);sync();}});
    const control={select,trigger,menu,sync,close,position,anchorMoved(){const rect=trigger.getBoundingClientRect();return anchorRect&&(Math.abs(rect.left-anchorRect.left)>.5||Math.abs(rect.top-anchorRect.top)>.5);},destroy(){
      close(false);observer.disconnect();trigger.removeEventListener('click',click);trigger.removeEventListener('keydown',keydown);trigger.removeEventListener('blur',blur);trigger.removeEventListener('focus',sync);select.removeEventListener('change',sync);
      for(const [property,descriptor] of [['value',previousValue],['selectedIndex',previousIndex]]){if(descriptor)Object.defineProperty(select,property,descriptor);else delete select[property];}
      select.hidden=oldHidden;select.tabIndex=oldTabIndex;if(oldAriaHidden===null)select.removeAttribute('aria-hidden');else select.setAttribute('aria-hidden',oldAriaHidden);
      labelFors.forEach(([label,value])=>label.htmlFor=value);wrapper.before(select);wrapper.remove();
    }};
    controls.set(select,control);sync();
  }
  root.querySelectorAll('select').forEach(enhance);
  const outside=event=>{if(active&&!active.trigger.contains(event.target)&&!active.menu.contains(event.target)&&event.target.closest('label')?.control!==active.trigger)active.close(false);};
  const escape=event=>{if(active&&event.key==='Escape'){event.preventDefault();event.stopPropagation();active.close();}};
  // A focus-induced scroll may be queued before opening; dismiss only when the
  // visible anchor actually moves, not for an already-positioned scroll event.
  const scroll=event=>{if(active&&!active.menu.contains(event.target)&&active.anchorMoved())active.close(false);};
  const resize=()=>{if(active)active.position();};
  const dialogClosed=event=>{if(active?.select.closest('dialog')===event.target)active.close(false);};
  const reset=()=>view.queueMicrotask(()=>controls.forEach(control=>control.sync()));
  document.addEventListener('pointerdown',outside,true);document.addEventListener('keydown',escape,true);document.addEventListener('scroll',scroll,true);document.addEventListener('close',dialogClosed,true);document.addEventListener('reset',reset,true);
  view.addEventListener('resize',resize);view.visualViewport?.addEventListener('resize',resize);
  return {refresh(){root.querySelectorAll('select').forEach(enhance);controls.forEach(control=>control.sync());},destroy(){
    controls.forEach(control=>control.destroy());controls.clear();
    document.removeEventListener('pointerdown',outside,true);document.removeEventListener('keydown',escape,true);document.removeEventListener('scroll',scroll,true);document.removeEventListener('close',dialogClosed,true);document.removeEventListener('reset',reset,true);
    view.removeEventListener('resize',resize);view.visualViewport?.removeEventListener('resize',resize);
  }};
}
