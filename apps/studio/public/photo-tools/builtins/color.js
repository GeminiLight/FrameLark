import {adjustmentTool} from './adjustment.js';
import {assertTintCorrectionDirection} from '../../control-reference.js';
import {fail} from '../values.js';
const tool=adjustmentTool('color','白平衡与色彩','调整目标范围的白平衡、饱和度与色彩混合。',['warmth','tint','vibrance','saturation','orangeSaturation','greenSaturation','blueSaturation','orangeHue','greenHue','blueHue','orangeLuminance','greenLuminance','blueLuminance']);
const prepare=tool.execute;
tool.execute=(operation,context)=>{
  const result=prepare(operation,context);
  if(operation.parameters.changes.some(change=>change.key==='tint')){
    const current=context.target.kind==='image'?context.state.settings:context.state.locals.find(l=>l.id===context.target.annotationId)?.localSettings||{};
    const desired=result.effect.settings||result.effect.locals[0].layer.localSettings;
    try{assertTintCorrectionDirection(operation.title,(desired.tint||0)-(current.tint||0));}catch(error){fail('TOOL_PARAMETER_DIRECTION',error.message);}
  }
  return result;
};
export default tool;
