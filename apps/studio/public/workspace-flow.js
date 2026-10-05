// Presentation follows the current photograph, including exact-version completion.
export function photoPhase({hasPhoto=true,loading=false,analyzing=false,analysisStatus='',assessmentBusy=false,edited=false,exported=false,acceptedSignature='',signature='',hasAcceptedRecord=false}={}) {
  if(!hasPhoto)return {key:'empty',label:'等待照片'};
  if(loading)return {key:'loading',label:'正在读取'};
  if(analyzing)return {key:analysisStatus==='queued' ? 'queued':'analyzing',label:analysisStatus==='queued' ? '等待审片':'正在审片'};
  if(assessmentBusy)return {key:'assessing',label:'正在复评'};
  if(hasAcceptedRecord && acceptedSignature && acceptedSignature===signature)return {key:'finalized',label:'已定稿'};
  if(exported)return {key:'exported',label:'已导出'};
  return edited ? {key:'editing',label:'编辑中'}:{key:'original',label:'原片'};
}

export function editorTab(name) {
  if(name==='suggestions')return 'diagnosis';
  return ['diagnosis','adjust','presets','agent'].includes(name) ? name:'diagnosis';
}

export function inspectionVisibility({hasPhoto=true,edited=false,past=0,future=0,sources=0,versions=0}={}) {
  return {comparison:hasPhoto && edited,history:hasPhoto && Boolean(past || future),sources:hasPhoto && sources>0,versionComparison:versions>=2};
}

export function panelGuidance({tab='diagnosis',phase='original',kind='uncertain',pending=0,edited=false,assessed=false,visual=false,intent='',hasConversation=false}={}) {
  if(['queued','analyzing','assessing'].includes(phase) && tab==='adjust')return {title:'等待时也可以继续精修',description:'审片针对原片，手动调整会保留；复评期间改变参数会使旧复评失效。',action:'light',label:'调整光线'};
  if(['loading','queued','analyzing','assessing'].includes(phase))return {
    title:phase==='loading' ? '正在准备照片':phase==='queued' ? '正在排队等待审片':phase==='assessing' ? '正在比较原片与当前效果':'正在审阅画面',
    description:phase==='loading' ? '读取完成后就可以开始。':phase==='assessing' ? '已有调整保留，完成后可查看调整效果与细节得失。':'已有编辑保留；等待时可切换到其他照片。',
    action:phase==='queued' || phase==='analyzing' ? 'tasks':null,label:'查看任务'
  };
  if(tab==='diagnosis') {
    if(phase==='finalized')return {title:'这一版已经定稿',description:'可以导出，或保存新版本继续尝试。',action:'versions',label:'保存新版本'};
    if(edited && !assessed)return {title:'对比调整前后的效果',description:'比较原片与当前效果，再决定是否保留。',action:'reassess',label:'复评当前效果'};
    if(pending)return {title:'先试一项调整',description:`${pending} 项待尝试，先看目标与作用范围。`,action:'first-suggestion',label:'查看第一条建议'};
    if(kind==='keep' && !edited)return {title:'建议保留',description:'建议保留当前构图和光色，具体理由见下方。',action:'export',label:'导出原片'};
    if(phase==='exported')return {title:'这一版已导出',description:'导出时的版本已保留；继续编辑后，可以重新复评与导出。',action:'versions',label:'查看保留版本'};
    if(edited)return {title:'满意后可以导出',description:'复评依据已在下方；满意后可以导出。',action:'export',label:'导出当前版本'};
    return {title:visual ? '先确定想保留的感觉':'先看原片，再决定要改什么',description:visual ? '没有可靠的自动调整建议，可以继续手动精修。':'当前仅有光色统计，尚未识别主体与构图。',action:'adjust',label:'进入手动精修'};
  }
  if(tab==='suggestions')return pending ? {title:'一次只尝试一处',description:'先预览变化，接受后生效；依据与微调按需展开。',action:'first-suggestion',label:'查看第一条建议'}:{title:edited ? '当前调整已保留':'先保留原片',description:edited ? '还想改变某一处，可进入专业调整。':'没有新增自动调整建议，可按自己的意图微调。',action:'adjust',label:'进入专业调整'};
  if(tab==='adjust')return {title:'调整光线与色彩',description:'参数是手动调整值，已有建议和风格会一起生效。',action:'light',label:'调整光线'};
  if(tab==='presets')return {title:'先预览一种风格',description:intent ? `围绕「${intent}」精选；应用前可调节强度。`:'从为这张照片精选的方向开始，应用前可调节强度。',action:'style',label:'预览推荐风格'};
  return {title:hasConversation ? '围绕当前效果继续讨论':'说说你希望改变什么',description:visual ? '顾问会看当前效果；每个可执行建议先预览，再接受。':'本地引导只读取光色与标记，不识别画面物体。',action:'compose',label:hasConversation ? '继续对话':'写下你的想法'};
}
