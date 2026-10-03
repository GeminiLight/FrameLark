import {record} from '../values.js';
export default {id:'mask',title:'选取范围',description:'为后续工具生成可复用的区域或对象蒙版；output 目标引用本步骤 ID。蒙版是几何范围，需要用户核对。',version:1,targets:['image','region','object','annotation','output'],parameters:record({}),execute(_operation,{target}){
  return {effect:{},outputs:{target:target.kind==='image'?{kind:'region',coordinateSpace:'original',mask:{shape:'rectangle',rect:{x:0,y:0,width:1,height:1},feather:0,exclude:[]}}:target}};
}};
