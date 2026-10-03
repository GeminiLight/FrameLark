import {record,number,fail} from '../values.js';
export default {id:'rotate',title:'扶正',description:'旋转整个画幅，顺时针为正；angle 是相对当前角度的增量。对象范围不能单独旋转。',version:1,targets:['image'],parameters:record({angle:number(-15,15)}),execute(operation,{state}){
  if(Math.abs(operation.parameters.angle)<1e-12)return {effect:{}};
  const angle=(state.crop?.angle||0)+operation.parameters.angle;if(Math.abs(angle)>15)fail('TOOL_PARAMETER_RANGE','合成拉直角度超出 ±15°。');
  return {effect:{crop:{...(state.crop||{x:0,y:0,width:1,height:1}),angle}}};
}};
