#!/usr/bin/env node
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {initProject,loadProject,publicProject,preferenceChoices,currentVersion,createCandidate,selectCandidateItems,changeGuards,saveNote,deleteNote,setIntent,acceptCandidate,discardCandidate,restoreVersion,saveReview,saveResultAudit,saveFeedback,recordExport,fail,localFailure} from './project.mjs';
import {configureWorkflow,recordDiagnosis,prepareReview,editSources,rebuildEdits} from './workflow.mjs';
import {initProfile,inspectProfile,learnProfile,editProfile} from './profile.mjs';
import {visualExamples} from './examples.mjs';
import {exportExchange,importExchange} from './exchange.mjs';
import {probeControl} from './probe.mjs';
import {workflowStatus} from './workflow-state.mjs';
import {handoffProject,waitForProject} from './handoff.mjs';
import {handoffView} from './handoff-state.mjs';
import {renderLookSheet} from './look-sheet.mjs';
import {previewPhoto,exportPhoto,createRenderSession} from './render.mjs';
import {editorControlReference} from './engine/control-reference.js';
import {letteringCapabilities} from './text-overlays.mjs';
import {initCollection,inspectCollection,updateCollectionBrief,saveCollectionPlan,collectionSheet,exportCollection} from './collection.mjs';
const help={name:'帧好 · 小帧的本地修片工作台',usage:'node cli.mjs <command> --project <folder> [options]',commands:{
  init:'--image <photo> --project <new-folder> [--intent <表达目标>]',
  'collection-init':'--project <new-collection-folder> --input <JSON|->；images 列表或 directory，最多 500 张，保留原片',
  'collection-inspect':'--project <collection-folder>；主题、稳定照片 ID、单图项目、取舍、版本、新鲜度和导出队列',
  'collection-brief':'--project <collection-folder> --input <JSON|->；用途、主题、目标数量、必留照片和约束',
  'collection-sheet':'--project <collection-folder> [--page 1] [--view current|original|planned] [--selected true]；每页 20 张联系表',
  'collection-plan':'--project <collection-folder> --input <JSON|->；宿主看图后保存选片理由、备选、叙事顺序和定调参考',
  'collection-export':'--project <collection-folder> --input <JSON|->；顺序导出已保存版本；失败可重试，不覆盖文件',
  examples:'[--id <案例ID>] [--query <题材>] 查看可复现原片、试片与反例',
  'profile-init':'--profile <new-file> [--name <名称>] 创建可携带本地偏好档案',
  'profile-read':'--profile <file> [--subject <题材>] [--lighting <光线>] 查看有条件的用户选择',
  'profile-learn':'--profile <file> --project <folder> --input <JSON> 仅从用户明确选择学习',
  'profile-edit':'--profile <file> --input <JSON> 编辑条件说明或 remove:true 删除记录',
  'project-export':'--output <new.frameyn.json> [--version current|<saved-id>] 交换原片、已保存版本、意图、批注与兼容编辑；可明确只导出单版',
  'project-import':'--input <photo.frameyn.json> --project <new-folder> 新增项目，不覆盖旧工作',
  probe:'--input <JSON> 固定画幅和图层，生成单个参数的实际照片试条',
  workflow:'--input <JSON> 配置 manual/reviewed 流程；不带 input 查看阶段与下一步',
  diagnosis:'--input <JSON> 保存当前图像的目标、保留关系、具体问题与检查依据',
  'review-packet':'--input <JSON> 准备独立复审材料，省略旧结论和参数解释',
  'edit-sources':'[--version <id>] 查看手动、风格、局部及选中项目来源',
  rebuild:'--input <JSON> 显式重建指定调整层，生成可撤回试片并保留约束',
  inspect:'读取当前版本、最新批注、意图、候选和真实预览路径；不调用视觉模型',
  handoff:'--input <JSON|->；request/claim/progress/complete/fail/cancel，接续需最新 revision；Agent 接手声明 actorId',
  watch:'[--after-revision <n>] [--timeout 60]；等待接续请求或项目变化，返回后由宿主 Agent 处理；最多等待 600 秒',
  'photo-tools':'工具目录、版本、目标类型与参数 Schema；不调用模型',
  'compose':'--input <tool-plan.json|->；独立子进程执行工具组合，产生逐项候选与实际中间预览',
  controls:'实际参数范围、灰卡响应与风格目录',
  preview:'[--version <id|current|original>] [--max-side 1400] [--region <JSON 原片范围>] [--without-text true]',
  'tool-schema':'输出提供给宿主 Agent 的结构化工具契约；不启动模型服务',
  tool:'--input <call.json|->；执行 allowlist 内的工具名和 JSON 参数',
  select:'--input <selection.json|->；id、revision、selectionHash、selectedItemIds',
  guards:'--input <guards.json|->；lock/protect/unlock，需最新 revision',
  candidate:'--input <plan.json|->；需 revision、baseVersion；settings 为绝对目标；整组精调可用 fromCandidate 继承未接受试片',
  lettering:'不带 --input 查看独立文字模式；--input <plan.json|-> 创建文字候选，需 mode: lettering；不修改修片参数',
  note:'--input <note.json|->；新增或修改圈选和评论',
  'delete-note':'--id <annotation-id> [--revision <n>]',
  intent:'--text <表达目标> [--revision <n>]',
  review:'--input <review.json|->；保存宿主 Agent 的画面观察与保留依据',
  'result-audit':'--input <audit.json|->；实际看成片后记录 ready/revise/reject、问题与下一步；核对版本和预览身份',
  feedback:'--input <feedback.json|->；记录用户明确的 reject/prefer/neutral，不改像素；拒绝版不再作为偏好证据',
  'look-sheet':'--input <sheet.json|->；revision、2～6 个 versions；composition 分别看构图，color 按 referenceVersion 同范围看光色',
  accept:'--id <candidate-id> [--revision <n>] [--selection-hash <hash>] [--by user|agent] [--require-audit true]；逐项候选必填 revision 和 hash，Agent 试修保存不计为用户偏好',
  discard:'--id <candidate-id> [--revision <n>]',
  restore:'--id <version-id> [--revision <n>]',
  compare:'--a <id|original|current> --b <id|current> [--region <JSON 原片范围>]',
  export:'[--version <id|current>] [--preset share|print|original] [--format png|jpeg] [--output <new-file>] [--max-side <px>] [--quality <60..100>] [--dpi <72..1200>] [--without-text true]',
  studio:'[--url http://127.0.0.1:3177]；连接完整工作台，共享文件项目并返回打开地址',
  serve:'[--port 0] [--session-file <private-json-file>]；仅监听 127.0.0.1，按 Ctrl+C 停止'
},notes:['工具只在本地处理像素；审片与对话由宿主 Agent 进行。','JPEG/PNG/WebP/AVIF 输入；macOS 可转换静态 HEIC/HEIF；8 位 sRGB，PNG/JPEG 输出，8192 px / 1600 万像素上限。','原片字节和编辑方案独立保存；已有文件不会被导出覆盖。']};
function args(values){const opts={};for(let i=0;i<values.length;i++){if(!values[i].startsWith('--')||values[i+1]===undefined||values[i+1].startsWith('--'))fail('ARGUMENT','每个选项需要一个值；运行 help 查看用法。');opts[values[i].slice(2)]=values[++i];}return opts;}
async function inspectPreview(session,key,options){try{return await session.previewPhoto(key,options);}catch(error){if(!error.code)throw error;return {error:localFailure(error),available:false};}}
async function input(file,limit=65536){if(!file)fail('INPUT_REQUIRED','请用 --input 提供 JSON 文件，或 - 从标准输入读取。');let bytes='';if(file==='-'){for await(const part of process.stdin){bytes+=part;if(Buffer.byteLength(bytes)>limit)fail('INPUT_SIZE','方案 JSON 超过读取上限，请分批提交。');}}else bytes=await readFile(path.resolve(file),'utf8');if(Buffer.byteLength(bytes)>limit)fail('INPUT_SIZE','方案 JSON 超过读取上限，请分批提交。');try{return JSON.parse(bytes);}catch{fail('INVALID_JSON','JSON 无法读取，请检查格式后重试。');}}
export async function runCLI(values=process.argv.slice(2)) {
  const [command='help',...rest]=values;if(['help','--help','-h'].includes(command))return help;
  const o=args(rest),folder=o.project&&path.resolve(o.project),revision=o.revision===undefined?undefined:Number(o.revision);
  if(command==='controls')return {parameters:publicProject({candidates:[],source:{},versions:[]}).parameters,styles:publicProject({candidates:[],source:{},versions:[]}).styles,grayCardReference:editorControlReference(),directions:{warmth:'正值更暖，负值更冷',tint:'正值减绿／向洋红，负值减洋红／向绿'},semantics:'曝光为 EV；其余数值是本编辑器相对控制，不是 Lightroom 开尔文或通用单位。settings 设为目标值；style 独立叠加。'};
  if(command==='photo-tools'){const {photoTools}=await import('./engine/photo-tools/registry.js');return {tools:photoTools.describe(),execution:'subprocess'};}
  if(command==='lettering'&&!o.input)return letteringCapabilities();
  if(command==='tool-schema'){const {hostToolContract}=await import('./tool-contract.mjs');return hostToolContract();}
  if(command==='examples')return visualExamples({id:o.id,query:o.query});
  if(command.startsWith('profile-')){
    if(!o.profile)fail('PROFILE_REQUIRED','用 --profile 指定档案文件。');
    if(command==='profile-init')return initProfile(path.resolve(o.profile),o.name);
    if(command==='profile-read')return inspectProfile(path.resolve(o.profile),{subject:o.subject,lighting:o.lighting});
    if(command==='profile-edit')return editProfile(path.resolve(o.profile),await input(o.input));
    if(command==='profile-learn'){if(!folder)fail('PROJECT_REQUIRED','用 --project 指定有明确用户选择的照片项目。');return learnProfile(folder,path.resolve(o.profile),await input(o.input));}
    fail('UNKNOWN_COMMAND','未知偏好操作。');
  }
  if(!folder)fail('PROJECT_REQUIRED','请用 --project 指定照片项目目录。');
  switch(command){
    case 'collection-init':return initCollection(folder,await input(o.input,2*1024*1024));
    case 'collection-inspect':return inspectCollection(folder);
    case 'collection-brief':return updateCollectionBrief(folder,await input(o.input,2*1024*1024));
    case 'collection-plan':return saveCollectionPlan(folder,await input(o.input,2*1024*1024));
    case 'collection-sheet':return collectionSheet(folder,{page:o.page?Number(o.page):1,view:o.view||'current',selected:o.selected==='true'});
    case 'collection-export':return exportCollection(folder,await input(o.input,2*1024*1024));
    case 'init':if(!o.image)fail('IMAGE_REQUIRED','请用 --image 指定原片。');return initProject(o.image,folder,{intent:o.intent});
    case 'inspect':{const session=await createRenderSession(folder),p=session.project,preview=await inspectPreview(session,'current'),original=await inspectPreview(session,'original',{showNotes:true}),regions=[];for(const note of p.notes){regions.push({id:note.id,number:note.number,note:note.note,original:await inspectPreview(session,'original',{region:note.rect}),current:await inspectPreview(session,'current',{region:note.rect})});}return {folder,project:{...p,collaboration:handoffView(p),workflowStatus:workflowStatus(p),preferenceChoices:preferenceChoices(p),versions:p.versions.map(({id,name,parentId,createdAt,acceptedBy})=>({id,name,parentId,createdAt,acceptedBy})),candidates:publicProject(p).candidates.map(({state,...c})=>c)},currentVersion:currentVersion(p),preview,original,annotationPreviews:regions,source:'local-pixel-measurement',visualAnalysis:'由宿主 Agent 读取预览判断；本命令未调用视觉模型'};}
    case 'handoff':return handoffProject(folder,await input(o.input));
    case 'watch':return waitForProject(folder,{afterRevision:o['after-revision']===undefined?undefined:Number(o['after-revision']),timeoutMs:o.timeout===undefined?60000:Number(o.timeout)*1000});
    case 'preview':return previewPhoto(folder,o.version||'current',{maxSide:o['max-side']?Number(o['max-side']):1400,region:o.region?JSON.parse(o.region):undefined,withoutText:o['without-text']==='true'});
    case 'lettering':{const plan=await input(o.input);if(plan.mode!=='lettering'||!Array.isArray(plan.textOverlays)||['settings','style','crop','locals'].some(k=>plan[k]!==undefined))fail('LETTERING_PLAN','文字模式需 mode: lettering 和 textOverlays；光色、局部和裁剪请在修片候选中调整。');const result=await createCandidate(folder,plan);return {...result,preview:await previewPhoto(folder,result.candidate.id)};}
    case 'compose':{const {createToolCandidate}=await import('./tool-candidates.mjs');return createToolCandidate(folder,await input(o.input,2*1024*1024));}
    case 'candidate':{const result=await createCandidate(folder,await input(o.input));return {...result,preview:await previewPhoto(folder,result.candidate.id)};}
    case 'select':{const result=await selectCandidateItems(folder,await input(o.input));return {...result,preview:await previewPhoto(folder,result.candidate.id,{selectionHash:result.candidate.selectionHash,revision:result.project.revision})};}
    case 'guards':{const result=await changeGuards(folder,await input(o.input));return {...result,preview:await previewPhoto(folder,result.candidate?.id||result.version.id)};}
    case 'tool':{const {dispatchHostTool}=await import('./tool-contract.mjs');return dispatchHostTool(folder,await input(o.input,2*1024*1024));}
    case 'note':return saveNote(folder,await input(o.input));
    case 'delete-note':return deleteNote(folder,{id:o.id,revision});
    case 'intent':return setIntent(folder,{intent:o.text,revision});
    case 'project-export':return exportExchange(folder,o.output&&path.resolve(o.output),{version:o.version});
    case 'project-import':return importExchange(folder,await input(o.input,48*1024*1024));
    case 'probe':return probeControl(folder,await input(o.input));
    case 'workflow':return o.input?configureWorkflow(folder,await input(o.input)):{workflow:workflowStatus(await loadProject(folder))};
    case 'diagnosis':return recordDiagnosis(folder,await input(o.input));
    case 'review-packet':return prepareReview(folder,await input(o.input));
    case 'edit-sources':return editSources(folder,o.version||'current');
    case 'rebuild':return rebuildEdits(folder,await input(o.input));
    case 'review':return saveReview(folder,await input(o.input));
    case 'result-audit':return saveResultAudit(folder,await input(o.input));
    case 'accept':if(o['require-audit']!==undefined&&!['true','false'].includes(o['require-audit']))fail('AUDIT_INVALID','--require-audit 应为 true 或 false。');return acceptCandidate(folder,{id:o.id,revision,selectionHash:o['selection-hash'],acceptedBy:o.by,requireAudit:o['require-audit']===undefined?undefined:o['require-audit']==='true'});
    case 'feedback':return saveFeedback(folder,await input(o.input));
    case 'look-sheet':return renderLookSheet(folder,await input(o.input));
    case 'discard':return discardCandidate(folder,{id:o.id,revision});
    case 'restore':return restoreVersion(folder,{id:o.id,revision});
    case 'compare':{const p=await loadProject(folder),{findVersion}=await import('./project.mjs'),b=findVersion(p,o.b||'current'),options={region:o.region?JSON.parse(o.region):undefined,referenceCrop:b.state.crop};return {a:await previewPhoto(folder,o.a||'original',options),b:await previewPhoto(folder,b.id,options),alignment:'同一原片坐标、裁剪与倍率；两侧各自版本的光色与局部处理。完整原构图可单独 preview original 查看。'};}
    case 'export':{const result=await exportPhoto(folder,o.version||'current',{preset:o.preset,format:o.format,output:o.output,maxSide:o['max-side']?Number(o['max-side']):undefined,quality:o.quality?Number(o.quality):undefined,dpi:o.dpi?Number(o.dpi):undefined,withoutText:o['without-text']==='true'});await recordExport(folder,result);return result;}
    case 'studio':{const {openStudioProject}=await import('./studio.mjs');return openStudioProject(folder,{url:o.url});}
    case 'serve':{const {serveProject}=await import('./server.mjs');await serveProject(folder,{port:Number(o.port)||0,sessionFile:o['session-file']});return;}
    default:fail('UNKNOWN_COMMAND','未知命令。运行 help 查看用法。');
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)runCLI().then(result=>{if(result)console.log(JSON.stringify({ok:true,...result},null,2));}).catch(error=>{console.error(JSON.stringify({ok:false,error:localFailure(error)},null,2));process.exitCode=1;});
