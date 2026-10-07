export function installationGuide({names = [], retouchReady = false, version} = {}) {
  const eye = names.includes('photography-eye');
  const retouch = names.includes('photo-retouch');
  const series = names.includes('photo-series');
  const retouchState = !retouch ? 'not-installed' : retouchReady === true ? 'ready' : 'needs-setup';
  const tasks = [];
  if (eye) tasks.push({id: 'scout', label: '找画面 · 摄影眼', localState: 'not-required', prompt: '用 FrameLark 看这张现场照，这里咋拍？', followup: '喜欢 P3，站哪里？我又拍了一张，继续看看。'});
  if (retouch) {
    tasks.push({id: 'retouch', label: '修照片 · 精修台', localState: retouchState, prompt: '用 FrameLark 精修这张原片，准备发朋友圈，先给我能比较的试片。', followup: '选自然那版，把这里调柔一点。就这版，导出。'});
  }
  if(series) tasks.push({id: 'series', label: '做组图 · 组图册', localState: retouch ? retouchState : 'needs-retouch', prompt: '用 FrameLark 从这个照片目录做朋友圈九宫格，先定主题，保留原片。', followup: '合照保留，换掉最重复的那张，给我整组预览。'});
  const readiness = retouchState === 'ready' ? '本地修图工具已就绪。'
    : retouchState === 'needs-setup' ? '插件中的照片精修已安装，本地图片依赖仍需准备；暂不称精修已就绪。'
    : series ? '组图册已安装，还需同时安装照片精修 Skill 作为本地处理引擎。'
    : eye ? '摄影眼已安装。实际精修和组图需要统一插件。' : '未识别到 FrameLark Skill。';
  return {
    tasks, retouchState, nextAction: 'new-chat',
    hostCapabilities: {vision: 'check-in-session', imageGeneration: 'check-in-session'},
    message: [
      `FrameLark${version ? ' ' + version : ''} · 下一步`, readiness,
      '开启新对话，附上照片或提供可访问的目录，选择一句开始：',
      ...tasks.map(task => `${task.label}\n  ${task.prompt}\n  继续：${task.followup}`),
      '看图与可选生图以当前会话的工具为准；安装成功不代表生图已可用。'
    ].join('\n')
  };
}
