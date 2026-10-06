export function shortcutAction(event,{dialog=false,viewer=false,typing=false,range=false,loading=false,learning=false}={}) {
  if(loading || event.isComposing || event.altKey)return null;
  const key=event.key.toLowerCase(),command=event.metaKey || event.ctrlKey;
  if(typing && !(range && command && key==='z' && !dialog && !viewer))return null;
  if(viewer) {
    if(command)return null;
    return {'+':'zoom-in','=':'zoom-in','-':'zoom-out','0':'fit','1':'actual'}[key] || null;
  }
  if(dialog)return null;
  if(command)return key==='z' ? event.shiftKey ? 'redo':'undo':null;
  if(key==='?')return 'help';
  if(learning)return null;
  return {'[':'previous-photo',']':'next-photo','1':'diagnosis','2':'adjust','3':'agent','4':'agent','z':'viewer','?':'help'}[key] || null;
}

export function photoNavigationIndex(key,current,length) {
  if(!length)return -1;
  if(key==='Home')return 0;
  if(key==='End')return length-1;
  if(key==='ArrowLeft' || key==='previous-photo')return (current-1+length)%length;
  if(key==='ArrowRight' || key==='next-photo')return (current+1)%length;
  return -1;
}

export function editableTarget(target) {
  return Boolean(target?.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]'));
}

export function readerPosition({visible=false,samePhoto=true,offset=0,remaining=0,saved,forceFollow=false}={}) {
  return {offset:visible && samePhoto ? offset:saved?.offset || 0,
    follow:forceFollow || (visible && samePhoto ? remaining<36:saved?.follow!==false)};
}

// Keep the same source location under the midpoint while pinching a rotated view.
export function pinchTransform({startZoom,fitZoom,startDistance,distance,startMidpoint,midpoint,anchor,width,height,sourceWidth,sourceHeight}) {
  const zoom=Math.max(Math.min(fitZoom,.05),Math.min(4,startZoom*distance/Math.max(1,startDistance)));
  return {zoom,point:{x:anchor.x+(startMidpoint.x-width/2)/startZoom/sourceWidth-(midpoint.x-width/2)/zoom/sourceWidth,
    y:anchor.y+(startMidpoint.y-height/2)/startZoom/sourceHeight-(midpoint.y-height/2)/zoom/sourceHeight}};
}
