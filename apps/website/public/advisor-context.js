// Capture the comments at send time, independently of later typing or selection.
export function snapshotAnnotations(annotations=[],focusId=null) {
  const items=annotations.slice(0,8).map((item,index)=>({
    id:String(item.id),number:index+1,note:String(item.note || '').slice(0,300),
    rect:{...item.rect},maskType:item.maskType || 'rectangle',feather:item.feather ?? .36,
    localEnabled:item.localEnabled!==false,currentAdjustments:{...item.localSettings},amount:item.localAmount ?? 100
  }));
  const focus=items.find(item=>item.id===focusId);
  return {items,signature:JSON.stringify(items),focusNumber:focus?.number || null,
    focusId:focus?.id || null,count:items.length,notedCount:items.filter(item=>item.note.trim()).length};
}
export function annotationsChanged(message,annotations) {
  return typeof message?.baseAnnotations==='string' && message.baseAnnotations!==snapshotAnnotations(annotations).signature;
}
