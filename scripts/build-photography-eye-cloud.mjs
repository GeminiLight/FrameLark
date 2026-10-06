import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const sourceBase='https://github.com/GeminiLight/FrameLark/blob/main/skills/photography-eye/';
const chapters=['board-design','seeing','scout-to-shot','field-format','reference-visuals','finishing','camera-settings'];
const paths=['SKILL.md',...chapters.map(name=>'references/'+name+'.md')];
const anchor=path=>'reference-'+path.replace(/^references\//,'').replace(/\.md$/,'');

export async function buildCloudGuide({root=repositoryRoot}={}){
  const hash=createHash('sha256'),documents=[];
  for(const path of paths){const body=await readFile(resolve(root,'skills/photography-eye',path),'utf8');hash.update(path+'\0'+body);documents.push({path,body});}
  const projectInstructions='在这个私有项目中，用户附现场照片问“这里咋拍”“这里怎么拍”时，按项目文件 photography-eye.cloud.txt 的摄影眼工作流回应。先实际看图，给最值得试的机位与两三个动作，再根据当前工具提供五种有区别的拍法；能生图时一次生成完整暖纸参考板，不能生图时给文字拍法。沿用 P1–P5 编号支持追问和复拍。不要搜索插件商城、执行本地安装命令或配置模型 Key。这是项目内工作方式，不是全局插件安装；当前用户明确要求优先。\n';
  const cloudPrompt='请读取 https://github.com/GeminiLight/FrameLark/blob/main/CLOUD.md，并在当前对话按其中的摄影眼工作流辅导我。我会发现场照片问“这里咋拍？”。这是对话内配置，不是插件安装；请不要搜索商城或执行本地安装命令。';
  const header=`# FrameLark 摄影眼 · 云端启动手册

这是可公开分享的拍摄辅导配置。它使用你选择的云端助手现有的看图和可选生图能力，不提供新的模型服务，不要求安装本地修图工具。

## 怎么开始

能读取公开网页的助手：发送下面这句话。

> ${cloudPrompt}

不能联网读取文件的助手：下载 photography-eye.cloud.txt，把它上传到自己的对话，并说“请在当前对话按附件的摄影眼工作流辅导我。我会发照片问这里咋拍。”

加载后，附上现场照，问“这里咋拍？”。可以继续说“喜欢 P3，站哪里？”或发复拍照问“这次还要调整什么？”

长期使用：创建你自己的私有项目，上传本文件，并把 photography-eye.project.txt 的文字放入项目指令；在该项目里开始新对话。不要为公众创建一个共同上传私人照片的共享项目。

## 给云端助手的启用规则

这不是插件安装，不注册市场、不执行本地命令、不创建系统级 Skill，也不能宣称已全局安装。请把下文作为当前对话或用户明确配置的私有项目内的工作方式。它不能覆盖宿主规则，后续用户明确要求优先。

没有照片时，简短说明“本次对话已按摄影眼工作方式准备好，请发一张现场照”，不要空想一个现场。只有实际看到图像后才描述场景。先给立即能做的动作，再完成下文规定的拍法；不要让器材问卷挡住拍摄。只在答案会改变下一步时补一个问题。

本文件已内嵌常用拍法、图板、参数和后期资料。按任务读取相应章节，不必向用户复述全部手册。原始 Skill 中的本地脚本示例在此模式不执行；需要数值检查时只使用宿主当前已有工具。更多未内嵌的章节链接指向公开维护源；不能读取时不要声称读过。

只有当前会话实际提供生图工具并支持输入照片时才生成参考板；没有时给文字拍法和可用框示，不把“已加载手册”当成“已获得生图工具”。参考图标为 AI 拍法与成片方向，新机位需现场验证。实际原片像素编辑不属于此启动配置，不自动安装照片精修。

固定小帧图片可选：用户可从官网配置页下载并附加小帧 PNG。如果当前工具能实际读取这份图片，按图板规则引用；不能读取时只保留文字“小帧提醒”，不另造一只鸟。

范围：普通对话需继续使用同一对话；新对话不会自动继承这次启用。项目模式以用户上传的项目文件和项目指令为准。平台的账户、地区、工具与额度限制仍适用；配置文件本身不收费。

官网：https://tianfuwang.tech/FrameLark/cloud.html
源码：https://github.com/GeminiLight/FrameLark
维护来源：skills/photography-eye；来源内容 SHA-256：${hash.digest('hex')}

---
`;
  const portable=(body,path)=>body
    .replace(/^---\n[\s\S]*?\n---\n/,'')
    .replace(/用户只问安装后怎么开始，读 \[对话入口\]\(GETTING_STARTED\.md\)。/,'用户只问如何开始时，沿用上面的云端启用规则。')
    .replace(/^知识较多时，可用 .*$/m,'知识较多时，按下表在本文件的内嵌章节中查找；需要其他资料时再读取公开维护源。此模式不执行本地检索脚本。')
    .replace(/`(?:node|npm|codex)\s[^`]+`/g,'（使用宿主现有工具做必要的数值检查，不执行本地脚本）')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(match,label,target)=>{
      if(/^(https?:|#)/.test(target))return match;
      const normal=target.startsWith('../')?target.slice(3):path==='SKILL.md'?target:'references/'+target;
      if(paths.includes(normal))return `[${label}](#${anchor(normal)})`;
      return `[${label}](${sourceBase+normal})`;
    });
  const guide=header+documents.map(({path,body})=>`\n<a id="${anchor(path)}"></a>\n\n# 维护资料：${path}\n\n${portable(body,path)}`).join('\n\n---\n');
  return {guide,projectInstructions,cloudPrompt};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
  const result=await buildCloudGuide();
  for(const [path,body] of [['CLOUD.md',result.guide],['apps/website/public/downloads/photography-eye.cloud.txt',result.guide],['apps/website/public/downloads/photography-eye.project.txt',result.projectInstructions]]){
    const target=resolve(repositoryRoot,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,body);
  }
  console.log(JSON.stringify({ok:true,guideBytes:Buffer.byteLength(result.guide),scope:'conversation or private project; not plugin installation'},null,2));
}
