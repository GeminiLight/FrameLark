const bounded = value => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=1;
const rounded = value => Math.round(value*10000)/10000;

// Encoded luminance references complement visual semantics; they never decide whether to edit.
export function photoMetering(pixels,width,height) {
  const total=width*height;
  if(!Number.isInteger(width)||!Number.isInteger(height)||!total||pixels.length!==total*4)throw new Error('Invalid photo pixels');
  const histogram=new Uint32Array(256),gridSum=new Float64Array(9),gridCount=new Uint32Array(9);
  const step=Math.max(1,Math.floor(total/120000));
  let count=0,sum=0,dark=0,bright=0;
  for(let p=0;p<total;p+=step){
    const i=p*4;if(pixels[i+3]<128)continue;
    const y=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
    histogram[Math.round(y)]++;sum+=y/255;count++;
    if(y<255*.035)dark++;if(y>255*.965)bright++;
    const cell=Math.min(2,Math.floor(Math.floor(p/width)/height*3))*3+Math.min(2,Math.floor((p%width)/width*3));
    gridSum[cell]+=y/255;gridCount[cell]++;
  }
  if(!count)return null;
  const percentile=fraction=>{let seen=0;for(let i=0;i<256;i++){seen+=histogram[i];if(seen>=count*fraction)return rounded(i/255);}return 1;};
  return {width,height,mean:rounded(sum/count),p10:percentile(.1),p50:percentile(.5),p90:percentile(.9),darkFraction:rounded(dark/count),brightFraction:rounded(bright/count),gridMean:Array.from(gridSum,(sum,i)=>gridCount[i] ? rounded(sum/gridCount[i]):null)};
}

// Only bounded numeric measurements cross the prompt boundary; arbitrary client text is discarded.
export function validPhotoMetering(value) {
  if(!value || !Number.isInteger(value.width)||!Number.isInteger(value.height)||value.width<1||value.height<1||value.width>16384||value.height>16384)return null;
  const keys=['mean','p10','p50','p90','darkFraction','brightFraction'];
  if(!keys.every(key=>bounded(value[key]))||value.p10>value.p50||value.p50>value.p90||value.darkFraction+value.brightFraction>1.001||!Array.isArray(value.gridMean)||value.gridMean.length!==9||!value.gridMean.every(v=>v===null||bounded(v)))return null;
  return {width:value.width,height:value.height,...Object.fromEntries(keys.map(key=>[key,value[key]])),gridMean:[...value.gridMean]};
}

export function meteringPrompt(value) {
  const reference=validPhotoMetering(value);
  return reference ? `附加光度参照（由客户端对同一预览的像素测得，仍以可见画面及创作意图判断）：${JSON.stringify(reference)}。这是编码亮度，0=黑、1=白；p90 是第 90 百分位，不是最大亮度。gridMean 只是九宫格区域均值，不是脸部、眼睛或单点测量；不得据此编造面部亮度范围或曝光欠缺 EV。具体脸部观察只能基于可见画面定性描述。gridMean 按左上、中上、右上、左中、中央、右中、左下、中下、右下排列。统计不能识别主体或证明曝光错误，更不能恢复已经剪切的高光。结合主体位置检查面部/关键区域是否过暗、亮部是否有实质损失；低调、夜景和星空不能为了达到某个均值而提亮。不要把偏暗的普通肖像自动解释成有意低调，也不要把明亮窗边或太阳自动解释成过曝。` : '';
}
