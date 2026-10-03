import {renderPixels} from './editor-engine.js';
import {photoMetering,validPhotoMetering} from './photo-metering.js';

// Real pixel trials show the tool response. Brightness alone never authorizes an edit.
export function exposureTrials(pixels,width,height) {
  const metering=photoMetering(pixels,width,height);
  if(!metering || metering.mean>=.38 || metering.p90>=.94)return [];
  return [.7,1.3].map(exposure=>({settings:{exposure},pixels:renderPixels(pixels,width,height,{exposure})}));
}
export function photoToolTrials(pixels,width,height) {
  const trials=exposureTrials(pixels,width,height);
  const sums=[0,0,0];let count=0;
  for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]<128)continue;for(let c=0;c<3;c++)sums[c]+=pixels[i+c];count++;}
  // A warm channel distribution selects hypotheses, never a white-balance diagnosis.
  if(count && sums[2]>0 && sums[0]/sums[2]>1.65 && sums[1]/sums[2]>1.4){
    for(const settings of [{warmth:-35,tint:8},{warmth:-65,tint:14}])trials.push({settings,pixels:renderPixels(pixels,width,height,settings)});
  }
  return trials;
}
export function validReviewTrials(value) {
  if(!Array.isArray(value))return [];
  const imagePattern=/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
  const recipes=[{exposure:.7},{exposure:1.3},{warmth:-35,tint:8},{warmth:-65,tint:14}];
  return value.slice(0,4).flatMap(item=>{
    const settings=recipes.find(recipe=>Object.entries(recipe).every(([key,value])=>item?.settings?.[key]===value));
    return settings && imagePattern.test(item?.image || '') && item.image.length<=1_500_000 ? [{image:item.image,settings:{...settings},metering:validPhotoMetering(item.metering)}]:[];
  });
}
export function trialPrompt(trial,index) {
  const operation=trial.settings.exposure!==undefined ? `exposure=${trial.settings.exposure} EV`:`warmth=${trial.settings.warmth}、tint=${trial.settings.tint}`;
  const judgment=trial.settings.exposure!==undefined ? '有意的夜景、剪影、低调和光线关系可能应保留原片；若普通人像曝光压低影响面部阅读，则比较实际试片，选择有效且自然的力度，可以选两者之间或不选。若较弱试片仍明显偏暗，而较强试片保留肤色和亮部细节、没有破坏光线关系，应优先有效的较强试片；克制不等于总取最小幅度。不要因提供试片就强制提亮或统一亮度。':'通道偏暖不证明白平衡错误；朝霞、暖色照明、物体本色和有意的暖调都可能应保留原片。只在肤色、环境与表达目标支持明确黄绿偏色时比较这两档修正，选择已经有效的自然结果，不把更红或更冷当成更真实。较弱试片若仍有明显残留而较强档更自然，可以选较强档或二者之间；过冷时应减弱。不得为了匹配试片强制改色。';
  return `工具响应试片 ${index+1}：同一原片只应用 ${operation}，其他参数为零。${trial.metering ? `试片全画面亮度统计：${JSON.stringify(trial.metering)}。`:''}这是修片工具的真实像素结果，未经生成。它是用于判断力度和代价的候选，不是正确答案。${judgment}`;
}
