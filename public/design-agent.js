import {normalizeToolPlan} from './photo-tools/registry.js';
import {assertTintCorrectionDirection} from './control-reference.js';
import {remainingAdjustments} from './adjustment-layers.js';
import { presetById } from './presets.js';
import {describeIntent} from './creative-intent.js';
import { validCrop } from './crop-utils.js';

export const agentAdjustmentKeys = [
  'exposure','contrast','highlights','shadows','whites','blacks','vibrance','saturation',
  'warmth','tint','fade','vignette','curveShadows','curveMidtones','curveHighlights',
  'texture','clarity','dehaze','sharpen','denoise'
];

const concise = (value, limit) => String(value || '').trim().slice(0, limit);
const maskRect=r=>r&&['x','y','width','height'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.width>=.005&&r.height>=.005&&r.x+r.width<=1.0001&&r.y+r.height<=1.0001 ? {x:r.x,y:r.y,width:r.width,height:r.height}:null;
const emptyAction = () => ({kind:'none',label:'',presetId:null,changes:[],crop:null});
const regionKeys = ['exposure','highlights','shadows','whites','blacks','warmth','tint','vibrance','saturation'];

export function normalizeDesignReply(value) {
  const reply = concise(value?.reply, 700) || '先告诉我你希望这张照片呈现什么感觉，我再给出更有针对性的建议。';
  const principle = concise(value?.principle, 240);
  const raw = value?.action || {};
  const action = emptyAction();
  if(raw.kind==='tools'){
    action.kind='tools';action.operations=normalizeToolPlan(raw.operations,{}, {resolveGeometry:false});action.label=concise(raw.label,60)||'工具编辑方案';
  } else if(raw.kind==='plan' && Array.isArray(raw.steps) && raw.steps.length<=8) {
    const steps=raw.steps.slice(0,8).map(step=>{
      if(step.kind==='rotate' && Number.isFinite(step.angle) && Math.abs(step.angle)<=5 && Math.abs(step.angle)>.001)return {kind:'rotate',angle:step.angle,label:concise(step.label,60)};
      const normalized=normalizeDesignReply({reply:'step',action:{...step,kind:step.kind==='masked'?'adjustment':step.kind}}).action;
      if(!['adjustment','crop','style'].includes(normalized.kind))return null;
      if(step.kind==='masked'){
        const rect=maskRect(step.rect),excluded=Array.isArray(step.exclude)?step.exclude.map(maskRect):[];
        if(!rect||excluded.some(r=>!r)||excluded.length>8)return null;
        return {...normalized,kind:'masked',rect,exclude:excluded,feather:Number.isFinite(step.feather)?Math.max(0,Math.min(.8,step.feather)):.2};
      }
      return normalized;
    });
    // A malformed sub-edit invalidates the whole plan; never silently drop a constraint.
    if(steps.length && steps.every(Boolean)){action.kind='plan';action.steps=steps;action.label=concise(raw.label,60)||'分步修图方案';}
  } else if (raw.kind === 'style' && presetById(raw.presetId)) {
    action.kind = 'style';
    action.presetId = raw.presetId;
    action.label = concise(raw.label, 36) || `试用「${presetById(raw.presetId).name}」`;
  } else if (['adjustment','region'].includes(raw.kind) && Array.isArray(raw.changes)) {
    const used = new Set();
    action.changes = raw.changes.filter(item => {
      if (!(raw.kind === 'region' ? regionKeys : agentAdjustmentKeys).includes(item?.key) || used.has(item.key) || !Number.isFinite(item.value)) return false;
      used.add(item.key);
      return true;
    }).slice(0,4).map(item => ({
      key:item.key,
      value:Math.max(item.key === 'exposure' ? -.4 : -25, Math.min(item.key === 'exposure' ? .4 : 25, item.value))
    })).filter(item => Math.abs(item.value) >= .001);
    if (action.changes.length) {
      action.kind = raw.kind;
      action.label = concise(raw.label, 36) || (raw.kind === 'region' ? '试用这处局部微调' : '试用这组微调');
    }
  } else if (raw.kind === 'crop') {
    const crop = validCrop(raw.crop, {suggestion:true});
    if (crop) {
      action.kind = 'crop';
      action.crop = crop;
      action.label = concise(raw.label, 36) || '预览构图建议';
    }
  }
  action.goal=concise(raw.goal,160);action.tradeoff=concise(raw.tradeoff,240);
  const question=concise(value?.clarification?.question,180);
  const choices=Array.isArray(value?.clarification?.choices) ? value.clarification.choices.filter(item=>typeof item==='string').slice(0,2).map(item=>concise(item,80)):[];
  if(question)Object.assign(action,emptyAction());
  if(['adjustment','region'].includes(action.kind))assertTintCorrectionDirection([action.label,action.goal].join('。'),action.changes.find(item=>item.key==='tint')?.value);
  return {reply,principle,action,clarification:question ? {question,choices}:null};
}

export function localDesignReply(question, context = {}) {
  let query = concise(question, 800).toLowerCase();
  const intent=describeIntent(context.creativeIntent);
  const requested=describeIntent(query);
  if(!intent.text && requested.vague && !context.focusAnnotation)return normalizeDesignReply({reply:'先说说想改哪里，或想保留什么。',clarification:{question:requested.question,choices:requested.choices}});
  const conflict=intent.text && !context.focusAnnotation && /我想|想试|调成|变成|更有|试试/.test(query) && requested.kind!=='custom' && requested.kind!==intent.kind && (intent.kind==='skin' && ['cinema','film','mono','vivid'].includes(requested.kind) || intent.kind==='mono' && requested.kind!=='mono' || intent.kind==='quiet' && requested.kind==='vivid');
  if(conflict)return normalizeDesignReply({reply:'这和之前设定的目标不同，先确认用哪个方向。',clarification:{question:'保留当前意图，还是改用你刚提出的方向？',choices:[intent.text,requested.text]}});
  if(intent.vague && !context.focusAnnotation)return normalizeDesignReply({reply:'先说说想要的效果，再决定怎么调整。',clarification:{question:intent.question,choices:intent.choices}});
  if(intent.text && !context.focusAnnotation && !/裁|构图|亮|暗|曝光|高光|阴影|饱和|暖|冷|对比|质感|主体|肤色/.test(query)) query=intent.text.toLowerCase();
  if(intent.kind==='skin' && !context.focusAnnotation && !/曝光|高光|阴影|太暗|太亮|构图|裁/.test(query))return normalizeDesignReply({reply:'以肤色真实为目标，先保留原有颜色。当前本地模式不能识别脸部或判断肤色偏差；请标记具体位置并说明偏色，或接通视觉顾问再判断。不据此自动增色或套用强烈风格。',principle:'肤色真实优先于历史风格偏好，避免没有依据地改变白平衡。'});
  const focus = context.focusAnnotation;
  if (focus) {
    const note = concise(focus.note,180);
    const region = context.regionStats?.region;
    const whole = context.regionStats?.whole;
    const difference = region && whole ? region.mean-whole.mean : null;
    const comparison = difference === null ? '本地还无法读取这处的画面数据' : difference > .08 ? '标记区确实比整张照片平均更亮' : difference < -.08 ? '标记区确实比整张照片平均更暗' : '标记区与整张照片的平均亮度接近';
    const colorDifference = region && whole ? region.saturation-whole.saturation : null;
    const colorComparison = colorDifference === null ? '本地无法判断这里的具体颜色' : colorDifference > .08 ? '这处的色彩比整张照片平均更浓' : colorDifference < -.08 ? '这处的色彩比整张照片平均更淡' : '这处的饱和度与整张照片接近';
    const intro = `第 ${focus.number} 处，你在意「${note}」。${comparison}。`;
    if (/裁|构图|杂|边缘|多余|干扰|留白/.test(note)) {
      const crop = context.analysis?.cropRecommendation;
      const outside = crop && (focus.rect.x+focus.rect.width < crop.rect.x || focus.rect.x > crop.rect.x+crop.rect.width || focus.rect.y+focus.rect.height < crop.rect.y || focus.rect.y > crop.rect.y+crop.rect.height);
      return normalizeDesignReply({
        reply:`${intro}这类问题先判断干扰是否在边缘，以及裁掉后会不会丢掉有用的空间。${outside ? '现有裁剪建议会移除这处，可以先打开预览核对。' : '现有裁剪建议未明确移除这处；可在「构图与裁剪」中手动调整。'} 本地模式无法判断具体物体是什么。`,
        principle:'只裁掉明确分散视线的部分，同时保留交代场景的空间。',
        action:outside ? {kind:'crop',crop:crop.rect,label:'预览这处裁剪'} : undefined
      });
    }
    if (/太暗|偏暗|不够亮|看不清|提亮|更亮|亮一点|阴影|黑/.test(note)) return normalizeDesignReply({
      reply:`${intro}可以小幅提亮标记范围内的阴影，让内容更可读，同时保住整张照片原有的光线方向。`,
      principle:'看清重要内容就好，不必提亮所有阴影。',
      action:{kind:'region',label:'轻提这处阴影',changes:[{key:'shadows',value:22},{key:'exposure',value:.08}]}
    });
    if (/太亮|过亮|曝|刺眼|抢眼|压暗|降亮|高光/.test(note)) return normalizeDesignReply({
      reply:`${intro}可以先降低这处的高光，看看是否还会分散注意力。调整只落在标记范围内，并会在边缘淡出。`,
      principle:'局部亮点是否需要压暗，取决于它是否抢走了主体的注意力。',
      action:{kind:'region',label:'轻收这处高光',changes:[{key:'highlights',value:-23},{key:'exposure',value:-.08}]}
    });
    if (/色|饱和|偏黄|偏蓝|偏绿|肤色|颜色/.test(note)) return normalizeDesignReply({
      reply:`${intro}${colorComparison}。先比较这里与周围的颜色，再试着做局部调整；肤色等复杂颜色仍需要你对照原片确认。`,
      principle:'色彩统一来自主色之间的关系，而不是每个区域都有相同饱和度。',
      action:/肤色/.test(note) ? undefined : /偏黄/.test(note) ? {kind:'region',label:'减轻这处偏黄',changes:[{key:'warmth',value:-10}]} : /偏蓝/.test(note) ? {kind:'region',label:'减轻这处偏蓝',changes:[{key:'warmth',value:10}]} : /偏绿/.test(note) ? {kind:'region',label:'减轻这处偏绿',changes:[{key:'tint',value:10}]} : /太淡|偏淡|不够饱和/.test(note) ? {kind:'region',label:'轻提这处色彩',changes:[{key:'vibrance',value:12}]} : {kind:'region',label:'轻收这处色彩',changes:[{key:'vibrance',value:-15},{key:'saturation',value:-7}]}
    });
    return normalizeDesignReply({
      reply:`${intro}这个问题需要识别主体和背景。本地模式只能测量光色，建议连接 AI 模型后再判断；也可以直接说明这处需要提亮、压暗还是调整颜色。`,
      principle:'先确定想改哪里，以及哪些内容要保留。'
    });
  }
  const analysis = context.analysis || {};
  const explicitDirection = /更|试|换|转|调成|太|偏|裁掉|裁成|黑白|单色|胶片|电影|mono|film|cinema|(?:想|希望|推荐|找).*(?:亮|暗|暖|冷|安静|力量|柔和|自然|风格|氛围)/.test(query);
  if (analysis.conclusion?.kind === 'keep' && !explicitDirection) {
    const preserved = Object.values(analysis.observations || {}).filter(item => item.verdict === 'keep').slice(0,2).map(item => item.finding).join(' ');
    return normalizeDesignReply({
      reply:`${analysis.observationSource === 'demo' ? '参考示例的预写讲解，' : context.source === 'ai' ? '结合已有的视觉审片，' : '参考已有结论，'}目前建议保留原片。${analysis.conclusion.reason} ${preserved}`,
      principle:'没有明确需要调整的地方时，可以保留原片。'
    });
  }
  const recs = Array.isArray(analysis.recommendations) ? analysis.recommendations.map(item=>({...item,adjustments:remainingAdjustments(item.adjustments,context.currentAdjustments)})) : [];
  const light = recs.find(item => item.id === 'light') || recs[0];
  const color = recs.find(item => item.id === 'color') || recs[1];
  const depth = recs.find(item => item.id === 'depth') || recs[2];
  const base = analysis.summary || '可以先明确主体，再决定光线与色彩要把视线带向哪里。';
  const observation = base.split(/[。！？]/)[0].slice(0,70);
  const intro = context.source === 'ai' ? '结合这张照片的视觉诊断，' : analysis.observationSource==='demo' ? '参考示例的预写讲解和本地光色统计，':'根据这张照片的本地光色分析，';
  const adjustment = (item, keys) => ({
    kind:'adjustment',label:'试用这组微调',presetId:null,crop:null,
    changes:keys.filter(key => Math.abs(item?.adjustments?.[key] || 0) > .001)
      .map(key => ({key,value:item.adjustments[key]}))
  });
  if (/裁|构图|杂乱|边缘|比例|留白|画幅|crop/.test(query)) {
    const crop = analysis.cropRecommendation;
    return normalizeDesignReply(crop ? {
      reply:`${intro}${crop.reason} 我建议先预览裁剪框，再检查主体与关键光源有没有被切掉。`,
      principle:'好构图不是裁得越紧越好；保留能够交代空间与情绪的部分。',
      action:{kind:'crop',label:'预览构图建议',crop:crop.rect}
    } : {
      reply:`${intro}目前没有足够可靠的自动裁剪依据。${base} 如果你在意某个边缘，可以打开构图工具手动试一版，再用前后对比判断。`,
      principle:'裁剪应当解决明确的视觉干扰，而不是只为了让画面显得更满。'
    });
  }
  if (/黑白|单色|mono/.test(query)) {
    const id = context.subject === 'landscape' ? 'silent-silver' : 'mono-story';
    return normalizeDesignReply({
      reply:`${intro}${observation}。可以试试「${presetById(id).name}」，观察去掉色彩后，主体和明暗层次是否仍然清楚。`,
      principle:'黑白会放大亮度关系与画面结构；请特别检查主体是否仍从背景中分离。',
      action:{kind:'style',presetId:id,label:'试用黑白方向'}
    });
  }
  if (/安静|克制|轻盈|柔和|留白/.test(query)) {
    const id = ['landscape','architecture'].includes(context.subject) ? 'misty-air' : context.subject === 'night' ? 'blue-hour' : 'daily-soft';
    return normalizeDesignReply({
      reply:`${intro}${observation}。想让它更安静，可试「${presetById(id).name}」，让对比与颜色都留一点余地。`,
      principle:'安静感常来自有选择地减少对比与色彩，而不是把所有细节抹平。',
      action:{kind:'style',presetId:id,label:`试用「${presetById(id).name}」`}
    });
  }
  if (/力量|戏剧|强烈|冲击/.test(query) && depth) {
    return normalizeDesignReply({
      reply:`${intro}${depth.reason} 想增强力量感，可先只加一点层次，并检查暗部有没有被压死。`,
      principle:depth.lesson || '只加强重点位置的明暗差异，避免整张照片反差过大。',
      action:adjustment(depth,['contrast','blacks','vignette'])
    });
  }
  if (/胶片|电影|氛围|风格|高级|情绪|film|cinema/.test(query)) {
    const id = /胶片|film/.test(query) ? (context.subject === 'landscape' ? 'open-road' : 'quiet-film')
      : /电影|cinema/.test(query) ? (context.subject === 'night' ? 'cinema-night' : 'quiet-film')
      : /自然/.test(query) ? (context.subject === 'landscape' ? 'open-road' : context.subject === 'night' ? 'blue-hour' : 'daily-soft')
      : presetById(context.recommendedStyle) ? context.recommendedStyle : 'daily-soft';
    return normalizeDesignReply({
      reply:`${intro}${observation}。想试另一种风格，可以预览「${presetById(id).name}」，留意它是否保留原有光线方向。`,
      principle:'可以降低风格强度，保留原有的光色。',
      action:{kind:'style',presetId:id,label:`试用「${presetById(id).name}」`}
    });
  }
  if (/色|暖|冷|饱和|肤色|自然|color/.test(query) && color) {
    return normalizeDesignReply({
      reply:`${intro}${color.reason} 我会先小幅调整自然饱和度与色温，再看主体颜色是否仍真实。`,
      principle:color.lesson || '可以只增强主要颜色，避免整张照片都过于鲜艳。',
      action:adjustment(color,['vibrance','saturation','warmth'])
    });
  }
  if (/亮|暗|曝光|高光|阴影|层次|light|dark/.test(query) && light) {
    return normalizeDesignReply({
      reply:`${intro}${light.reason} 先小幅调整明暗，再检查亮部细节。`,
      principle:light.lesson || '先保护亮部，再决定暗部需要多少信息。',
      action:adjustment(light,['exposure','highlights','shadows'])
    });
  }
  if (/对比|质感|立体|焦点|主体/.test(query) && depth) {
    return normalizeDesignReply({
      reply:`${intro}${depth.reason} 先看缩略图中第一眼落在哪里，再决定是否需要加强层次。`,
      principle:depth.lesson || '对比应当帮助观众找到视觉重点。',
      action:adjustment(depth,['contrast','blacks','vignette'])
    });
  }
  if(intent.text)return normalizeDesignReply({reply:`仅凭本地光色统计，还无法针对「${intent.text}」给出具体建议。先保留现有效果；可以标记想改的位置，或连接 AI 模型分析。`,principle:'没有明确的调整理由时，可以先保留当前效果。'});
  return normalizeDesignReply({
    reply:light ? `${intro}我会先看明暗关系。${light.reason} 试完比较主体是否更清楚、亮部是否仍有层次。` : `${intro}${base} 你想保留自然光色，还是增强明暗对比？`,
    principle:analysis.insight || light?.lesson || '先确定想让观众看哪里，再考虑亮度与色彩。',
    action:light ? adjustment(light,['exposure','highlights','shadows']) : emptyAction()
  });
}
