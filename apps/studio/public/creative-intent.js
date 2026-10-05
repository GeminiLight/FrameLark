// Intent describes the author's goal; it is never evidence of what is in a photo.
export const cleanIntent=value=>typeof value==='string' ? value.trim().replace(/\s+/g,' ').slice(0,180):'';
export function describeIntent(value) {
  const text=cleanIntent(value);
  const rules=[['skin',/肤色|皮肤|skin/],['mono',/黑白|单色|mono/],['cinema',/电影|cinema/],['quiet',/安静|宁静|清晨|克制|柔和|轻盈|留白/],['film',/胶片|film/],['vivid',/浓郁|鲜明|力量|戏剧|强烈/],['natural',/真实|自然|保留原|纪实/]];
  const kind=rules.find(([,pattern])=>pattern.test(text.toLowerCase()))?.[0] || 'custom';
  const vague=Boolean(text && kind==='custom' && /^(?:请|帮我|想要|我想|想|让它|看起来|更有|有|照片|这张|更|一点|点|一些|非常|很|有点|变得|调得|好看|高级|优化|提升|质感|氛围|情绪|美|漂亮|更好|一下|修片|修好|调整|。|！|\s)+$/.test(text));
  return {text,kind,vague,question:vague?'这张照片，你更想保留自然光色，还是加强电影氛围？':'',choices:vague?['保留自然光色','更有电影感']:[]};
}
export function intentStylePriority(preset,intent) {
  const {text,kind,vague}=describeIntent(intent);if(!text || vague)return 0;
  const a=preset.adjustments,feels=preset.feels;
  if(kind==='skin' || kind==='natural')return a.monochrome ? -2:feels.includes('airy') && Math.abs(a.warmth || 0)<7 && Math.abs(a.saturation || 0)<12 ? 2:feels.includes('vivid') || preset.groups.includes('night') ? -1:1;
  if(kind==='mono')return a.monochrome ? 2:-2;
  if(kind==='quiet')return feels.includes('airy') && !a.monochrome ? 2:feels.includes('vivid') ? -1:0;
  if(kind==='film')return feels.includes('film') && !a.monochrome ? 2:0;
  if(kind==='cinema')return preset.id==='cinema-night' || preset.id==='quiet-film' || preset.id==='blue-hour' ? 2:feels.includes('film') ? 1:0;
  if(kind==='vivid')return feels.includes('vivid') ? 2:0;
  return 0;
}
export function styleSelections(ranked,favorites,limit=2) {
  const recommended=ranked.slice(0,limit),ids=new Set(recommended.map(item=>item.preset.id));
  const favorite=ranked.filter(item=>favorites.includes(item.preset.id) && !ids.has(item.preset.id)).slice(0,limit);
  return {recommended,favorite};
}
