export const styleCategories = [
  {id:'all',label:'全部'}, {id:'portrait',label:'人像日常'},
  {id:'landscape',label:'自然风景'}, {id:'street',label:'街头城市'},
  {id:'architecture',label:'建筑空间'}, {id:'night',label:'夜色电影'}, {id:'monochrome',label:'黑白结构'},
  {id:'favorites',label:'已收藏'}
];

export const stylePreferences = [
  {id:'auto',label:'自动'}, {id:'airy',label:'轻盈'},
  {id:'film',label:'胶片'}, {id:'vivid',label:'浓郁'},
  {id:'mono',label:'黑白'}
];

export const presets = [
  {
    id:'daily-soft',name:'日常柔光',category:'人像 · 生活',groups:['portrait'],feels:['airy'],
    mood:'轻盈、亲近、保留空气感',inspiration:'灵感线索：滨田英明的日常影像',
    source:'https://hideakihamada.com/works/',
    adjustments:{exposure:.12,contrast:-12,highlights:-17,shadows:16,blacks:9,vibrance:4,saturation:-5,warmth:4,tint:2,fade:10,greenSaturation:-9,blueSaturation:-8,grain:3}
  },
  {
    id:'golden-hour',name:'金色时刻',category:'旅行 · 风景',groups:['landscape','portrait'],feels:['vivid'],
    mood:'加强余晖的暖色与层次',inspiration:'灵感线索：经典风景摄影',
    adjustments:{exposure:.06,contrast:8,highlights:-20,shadows:10,whites:7,blacks:-4,vibrance:10,warmth:13,tint:2,orangeSaturation:8,blueSaturation:-4,vignette:9}
  },
  {
    id:'quiet-film',name:'静谧负片',category:'人像 · 街头',groups:['portrait','street'],feels:['film','airy'],
    mood:'柔和黑位、暖色与细腻颗粒',inspiration:'灵感线索：Saul Leiter 的彩色街头影像',
    source:'https://www.saulleiterfoundation.org/color',
    adjustments:{contrast:-4,highlights:-15,shadows:8,blacks:10,vibrance:-5,saturation:-10,warmth:5,tint:3,fade:15,grain:13,orangeSaturation:6,greenSaturation:-9,blueSaturation:-7}
  },
  {
    id:'blue-hour',name:'蓝调时分',category:'城市 · 夜景',groups:['night','street'],feels:['film'],
    mood:'偏蓝的色调与柔和高光',inspiration:'灵感线索：暮色城市摄影',
    adjustments:{exposure:-.04,contrast:12,highlights:-24,shadows:7,blacks:-7,vibrance:8,saturation:-5,warmth:-11,tint:3,blueSaturation:14,greenSaturation:-8,vignette:10}
  },
  {
    id:'misty-air',name:'晨雾留白',category:'风景 · 建筑',groups:['landscape','architecture'],feels:['airy'],
    mood:'低对比、柔和色彩与留白',inspiration:'灵感线索：极简风景摄影',
    adjustments:{exposure:.1,contrast:-17,highlights:-14,shadows:17,blacks:13,vibrance:-7,saturation:-15,warmth:-2,fade:13,blueSaturation:-11,greenSaturation:-8}
  },
  {
    id:'mono-story',name:'黑白叙事',category:'纪实 · 建筑',groups:['monochrome','street','architecture'],feels:['mono'],
    mood:'用明暗结构代替色彩',inspiration:'灵感线索：何藩的黑白光影',
    source:'https://fanho-forgetmenot.com/',
    adjustments:{contrast:18,highlights:-13,shadows:-5,whites:9,blacks:-9,fade:4,vignette:9,grain:9,monochrome:100}
  },
  {
    id:'luminous-poem',name:'微光诗篇',category:'人像 · 自然',groups:['portrait','landscape'],feels:['airy'],
    mood:'明亮、柔和、低对比',inspiration:'灵感线索：川内伦子的光影作品',
    source:'https://rinkokawauchi.com/en/works/',
    adjustments:{exposure:.13,contrast:-14,highlights:-21,shadows:17,whites:4,blacks:12,vibrance:-4,saturation:-9,warmth:2,fade:14,blueSaturation:-10,grain:3}
  },
  {
    id:'street-grain',name:'街头颗粒',category:'街头 · 黑白',groups:['street','monochrome'],feels:['mono','film'],
    mood:'粗颗粒与强烈的黑白反差',inspiration:'灵感线索：森山大道的街头影像',
    source:'https://www.moriyamadaido.com/',
    adjustments:{contrast:30,highlights:5,shadows:-11,whites:10,blacks:-22,grain:27,clarity:11,sharpen:7,monochrome:100}
  },
  {
    id:'silent-silver',name:'静默银调',category:'风景 · 黑白',groups:['landscape','monochrome'],feels:['mono','airy'],
    mood:'银灰色调与柔和的明暗过渡',inspiration:'灵感线索：Michael Kenna 的风景作品',
    source:'https://www.michaelkenna.com/gallery.php',
    adjustments:{exposure:.03,contrast:3,highlights:-18,shadows:16,whites:5,blacks:7,fade:13,grain:3,monochrome:100}
  },
  {
    id:'journey-color',name:'旅途浓彩',category:'旅行 · 人像',groups:['portrait','landscape'],feels:['vivid'],
    mood:'鲜明而有层次的暖色旅途',inspiration:'灵感线索：Steve McCurry 的肖像与旅途影像',
    source:'https://www.stevemccurry.com/portraits',
    adjustments:{contrast:9,highlights:-16,shadows:8,vibrance:18,saturation:7,warmth:8,orangeSaturation:10,blueSaturation:8,clarity:6,vignette:4}
  },
  {
    id:'color-crossroads',name:'色彩交汇',category:'街头 · 彩色',groups:['street'],feels:['vivid','film'],
    mood:'明暗交错中保留跳跃的色块',inspiration:'灵感线索：Alex Webb 的彩色街头影像',
    source:'https://www.magnumphotos.com/event/photographers/alex-webb/',
    adjustments:{contrast:18,highlights:-20,shadows:-4,whites:9,blacks:-9,vibrance:12,saturation:8,orangeSaturation:12,blueSaturation:9,greenSaturation:-5,clarity:7}
  },
  {
    id:'ordinary-color',name:'日常原色',category:'生活 · 街头',groups:['portrait','street'],feels:['vivid'],
    mood:'突出日常物件的色彩差异',inspiration:'灵感线索：William Eggleston 的日常彩色摄影',
    source:'https://egglestonartfoundation.org/',
    adjustments:{contrast:4,highlights:-11,shadows:8,vibrance:13,saturation:6,warmth:3,orangeSaturation:14,greenSaturation:6,blueSaturation:7,fade:5,grain:5}
  },
  {
    id:'open-road',name:'公路淡彩',category:'旅行 · 风景',groups:['landscape','street'],feels:['airy','film'],
    mood:'低对比与自然淡彩',inspiration:'灵感线索：Stephen Shore 的公路与日常作品',
    source:'https://www.stephenshore.net/photographs.php',
    adjustments:{exposure:.07,contrast:-10,highlights:-15,shadows:13,saturation:-9,warmth:3,fade:12,greenSaturation:-4,blueSaturation:-6,grain:3}
  },
  {
    id:'cinema-night',name:'夜色影院',category:'城市 · 夜景',groups:['night','street'],feels:['film'],
    mood:'冷影与暖光之间的电影感',inspiration:'灵感线索：城市夜景摄影',
    adjustments:{exposure:-.09,contrast:22,highlights:-26,shadows:-6,whites:4,blacks:-18,warmth:-8,blueSaturation:12,orangeSaturation:8,vignette:16,grain:9}
  }
];

export const presetById = id => presets.find(item => item.id === id);
