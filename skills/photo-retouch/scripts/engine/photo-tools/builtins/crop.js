import {record,rect,cleanRect,fail} from '../values.js';
import {validCrop} from '../../crop-utils.js';
import {originalToViewPoint,transformRect} from '../../photo-geometry.js';
export default {id:'crop',title:'裁剪',description:'按原图范围裁剪，保留当前拉直角度；区域或对象目标可直接提供裁剪范围。',version:1,targets:['image','region','object','annotation','output'],parameters:record({rect:{anyOf:[{type:'null'},rect]}}),execute(operation,{state,target,source}){
  const original=operation.parameters.rect?cleanRect(operation.parameters.rect):target.mask?.rect;if(!original)fail('TOOL_TARGET_REQUIRED','裁剪需要明确范围。');
  const projected=transformRect(original,p=>originalToViewPoint(p,{x:0,y:0,width:1,height:1,angle:state.crop?.angle||0},source.width,source.height));
  const crop=validCrop({...projected,angle:state.crop?.angle||0});if(!crop)fail('TOOL_TARGET_OUTSIDE','裁剪范围过小或不在照片中。');return {effect:{crop}};
}};
