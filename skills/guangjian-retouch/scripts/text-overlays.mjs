import {GlobalFonts,createCanvas} from '@napi-rs/canvas';

export const letteringVersion='lettering-v1';
export const letteringStyles={
  airy:{label:'留白短句',font:'sans',color:'#FFF8EE',background:'#FFF1DD',weight:400},
  sticker:{label:'奶油贴纸',font:'rounded',color:'#594539',background:'#FFF1DD',weight:600},
  editorial:{label:'小标题',font:'serif',color:'#FFF8EE',background:'#FFF1DD',weight:400}
};
const error=(code,message)=>{throw Object.assign(new Error(message),{code});};
const range=(value,defaultValue,min,max,label)=>{const n=value===undefined?defaultValue:value;if(typeof n!=='number'||!Number.isFinite(n)||n<min||n>max)error('TEXT_RANGE',`${label}应在 ${min}～${max} 之间。`);return n;};
const choice=(v,d,values,label)=>{const value=v??d;if(!values.includes(value))error('TEXT_OPTION',`${label}不支持，请运行 lettering 查看文字模式选项。`);return value;};
const color=(v,d)=>{const value=v??d;if(typeof value!=='string'||!/^#[\da-f]{6}$/i.test(value))error('TEXT_COLOR','文字和底色请使用 #RRGGBB。');return value.toUpperCase();};
export function cleanTextOverlays(value=[]) {
  if(!Array.isArray(value)||value.length>4)error('TEXT_LIMIT','文字层最多 4 处；传入空数组可移除全部文字。');
  const allowed=['id','text','x','y','width','size','style','font','color','background','weight','align','rotation','opacity','decoration'];
  const result=value.map((item,i)=>{
    if(!item||typeof item!=='object'||Array.isArray(item)||Object.keys(item).some(k=>!allowed.includes(k)))error('TEXT_LAYER','文字层含不支持的字段。请查看文字模式说明。');
    if(typeof item.text!=='string'||!item.text.trim()||[...item.text].length>120||item.text.split('\n').length>6||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(item.text))error('TEXT_CONTENT','每处文字应为 1～120 个字符、最多 6 行。');
    const style=choice(item.style,'airy',Object.keys(letteringStyles),'样式'),defaults=letteringStyles[style];
    const id=item.id??`text-${i+1}`;if(typeof id!=='string'||!/^[-\w]{1,64}$/.test(id))error('TEXT_ID','文字层编号应为 1～64 位字母、数字、下划线或短横线。');
    const layer={id,text:item.text.trim(),style,font:choice(item.font,defaults.font,['sans','rounded','serif'],'字体'),weight:choice(item.weight,defaults.weight,[400,600],'字重'),
      x:range(item.x,.07,.02,.94,'左侧位置'),y:range(item.y,.78,.02,.94,'顶部位置'),width:range(item.width,.6,.08,.96,'文字宽度'),size:range(item.size,.045,.018,.12,'字号比例'),
      color:color(item.color,defaults.color),background:color(item.background,defaults.background),align:choice(item.align,'left',['left','center','right'],'对齐'),
      rotation:range(item.rotation,0,-12,12,'倾斜角度'),opacity:range(item.opacity,1,.2,1,'不透明度'),decoration:choice(item.decoration,'none',['none','heart','sparkle'],'装饰')};
    if(layer.x+layer.width>.980001)error('TEXT_BOUNDS','文字范围超出右侧安全边距，请减少宽度或向左移动。');
    return layer;
  });
  if(new Set(result.map(x=>x.id)).size!==result.length)error('TEXT_ID','文字层编号不能重复。');
  return result;
}
function installedFamilies(){return GlobalFonts.families.map(x=>x.family);}
function fontChoices(){
  const families=installedFamilies(),pick=names=>names.find(n=>families.includes(n));
  const cjkSans=pick(['PingFang SC','Noto Sans CJK SC','Noto Sans SC','Microsoft YaHei','WenQuanYi Zen Hei','Source Han Sans SC','Arial Unicode MS']);
  const cjkSerif=pick(['Songti SC','Noto Serif CJK SC','Noto Serif SC','Source Han Serif SC','SimSun'])||cjkSans;
  return {cjkSans,cjkSerif,sans:pick(['Helvetica Neue','Arial','DejaVu Sans','Liberation Sans'])||families[0],rounded:pick(['Hiragino Maru Gothic ProN','Arial Rounded MT Bold','Nunito'])||cjkSans||families[0],serif:pick(['Georgia','DejaVu Serif','Liberation Serif'])||families[0]};
}
export function letteringCapabilities(){return {mode:'lettering',styles:Object.entries(letteringStyles).map(([id,x])=>({id,...x})),fonts:fontChoices(),maxLayers:4,coordinates:'x / y / width 相对最终裁剪画幅，size 相对该画幅短边；尺寸变化会等比例缩放。',default:'默认不添加文字；只在 mode: lettering 方案中编辑文字层。'};}
function fontFamily(layer){
  const fonts=fontChoices(),hasCJK=/[\u2E80-\u9FFF\uF900-\uFAFF]/u.test(layer.text);
  if(hasCJK&&!fonts.cjkSans&&!fonts.cjkSerif)error('TEXT_FONT_MISSING','未找到中文字体。请在本机安装 Noto Sans CJK SC 等中文字体，重新启动预览后重试；已有照片和编辑保留。');
  const family=hasCJK?(layer.font==='serif'?fonts.cjkSerif:fonts.cjkSans)||fonts.cjkSerif:fonts[layer.font];
  if(!family)error('TEXT_FONT_MISSING','本机没有可用字体，请安装字体后重试。');
  return family;
}
function textLines(context,text,maxWidth){
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'}),lines=[];
  for(const paragraph of text.split('\n')){
    let line='';
    for(const {segment} of segmenter.segment(paragraph)){
      if(context.measureText(segment).width>maxWidth)error('TEXT_OVERFLOW','文字宽度不足，请加宽范围或减小字号。');
      if(line&&context.measureText(line+segment).width>maxWidth){lines.push(line.trimEnd());line=segment.trimStart();}else line+=segment;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}
function decoration(context,type,x,y,size){
  context.save();context.translate(x,y);context.scale(size,size);context.beginPath();
  if(type==='heart'){context.moveTo(0,.3);context.bezierCurveTo(-.7,-.2,-.5,-.75,0,-.35);context.bezierCurveTo(.5,-.75,.7,-.2,0,.3);context.fill();}
  else{context.moveTo(0,-.6);context.lineTo(.15,-.15);context.lineTo(.6,0);context.lineTo(.15,.15);context.lineTo(0,.6);context.lineTo(-.15,.15);context.lineTo(-.6,0);context.lineTo(-.15,-.15);context.closePath();context.fill();}
  context.restore();
}
export function drawTextOverlays(context,layers,{width,height,compositionRect,sourceRect}) {
  const overlays=cleanTextOverlays(layers);if(!overlays.length)return [];
  // Layout at one canonical resolution, then map into preview, export, or region frames.
  const fullW=compositionRect.width,fullH=compositionRect.height,sx=width/sourceRect.width,sy=height/sourceRect.height,short=Math.min(fullW,fullH),layouts=[];
  for(const layer of overlays){
    const font=fontFamily(layer),size=layer.size*short;
    context.save();context.translate((compositionRect.x-sourceRect.x)*sx,(compositionRect.y-sourceRect.y)*sy);context.scale(sx,sy);
    context.font=`${layer.weight} ${size}px "${font}"`;context.textBaseline='alphabetic';
    const pad=layer.style==='sticker'?size*.45:0,ornament=layer.decoration==='none'?0:size*1.05,maxW=layer.width*fullW,contentW=maxW-pad*2-ornament;
    if(contentW<=0){context.restore();error('TEXT_OVERFLOW','贴纸和装饰占用了文字空间，请加宽范围或减小字号。');}
    const lines=textLines(context,layer.text,contentW),boxW=layer.style==='sticker'?Math.min(maxW,Math.max(...lines.map(line=>context.measureText(line).width))+pad*2+ornament):maxW,lineH=size*1.4,boxH=(lines.length-1)*lineH+size*1.25+pad*2;
    const x=layer.x*fullW,y=layer.y*fullH,cx=x+boxW/2,cy=y+boxH/2,angle=layer.rotation*Math.PI/180,cos=Math.cos(angle),sin=Math.sin(angle),margin=short*.015;
    const corners=[[-boxW/2,-boxH/2],[boxW/2,-boxH/2],[-boxW/2,boxH/2],[boxW/2,boxH/2]].map(([a,b])=>({x:cx+a*cos-b*sin,y:cy+a*sin+b*cos}));
    if(corners.some(p=>p.x<margin||p.y<margin||p.x>fullW-margin||p.y>fullH-margin)){context.restore();error('TEXT_OVERFLOW',`「${layer.text.slice(0,16)}」会超出画面。请缩短文字、减小字号，或向画面内移动。`);}
    context.translate(cx,cy);context.rotate(angle);context.translate(-boxW/2,-boxH/2);context.globalAlpha=layer.opacity;
    if(layer.style==='sticker'){context.fillStyle=layer.background;context.beginPath();context.roundRect(0,0,boxW,boxH,size*.48);context.fill();}
    context.fillStyle=layer.color;
    if(layer.decoration!=='none')decoration(context,layer.decoration,pad+size*.4,pad+size*.63,size*.75);
    context.textAlign=layer.align;const start=pad+ornament;
    const drawnContentW=boxW-pad*2-ornament,anchor=start+(layer.align==='center'?drawnContentW/2:layer.align==='right'?drawnContentW:0);
    lines.forEach((line,i)=>context.fillText(line,anchor,pad+size+i*lineH));
    context.restore();layouts.push({id:layer.id,font,lines,rect:{x:x/fullW,y:y/fullH,width:boxW/fullW,height:boxH/fullH}});
  }
  return layouts;
}
export function validateTextComposition(layers,rect){return drawTextOverlays(createCanvas(1,1).getContext('2d'),layers,{width:1,height:1,compositionRect:rect,sourceRect:rect});}
