import {combineSettings,adjustmentKeys} from './editor-engine.js';

export function globalAdjustments({manual,recommendations=[],active=[],preset,amount=0,advisorLayers=[]}) {
  const enabled=new Set(active);
  return combineSettings({settings:manual},
    ...recommendations.filter(item=>enabled.has(item.id)).map(item=>({settings:item.adjustments})),
    {settings:preset?.adjustments,amount:amount/100},
    ...advisorLayers.filter(item=>!item.annotationId).map(item=>({settings:item.settings})));
}

export function effectiveAnnotations(annotations=[],advisorLayers=[]) {
  return annotations.map(item=>({...item,localSettings:combineSettings({settings:item.localSettings},
    ...advisorLayers.filter(layer=>layer.annotationId===item.id).map(layer=>({settings:layer.settings})))}));
}

// Original review values are targets, whereas a conversation proposes a delta from its captured current version.
export function remainingAdjustments(target,current={}) {
  return Object.fromEntries(adjustmentKeys.map(key=>{
    const value=Number(target?.[key])||0;
    return [key,Math.sign(value)*Math.max(0,Math.abs(value)-Math.max(0,Math.sign(value)*(Number(current[key])||0)))];
  }));
}

export function adjustmentSignature(settings,crop,annotations,{includeNotes=true}={}) {
  return JSON.stringify({settings,crop,regions:annotations.filter(item=>includeNotes || Object.values(item.localSettings || {}).some(Boolean)).map(item=>({id:item.id,rect:item.rect,settings:item.localSettings,amount:item.localAmount ?? 100,...(includeNotes ? {note:item.note}:{}),maskType:item.maskType || 'rectangle',feather:item.feather ?? .36,enabled:item.localEnabled!==false,start:item.start,end:item.end,points:item.points,radius:item.brushRadius,exclude:item.exclude}))});
}

export function hasLocalEffects(annotations=[],advisorLayers=[]) {return effectiveAnnotations(annotations,advisorLayers).some(item=>item.localEnabled!==false && (item.localAmount ?? 100)>0 && Object.values(item.localSettings || {}).some(value=>Math.abs(value)>.001));}
