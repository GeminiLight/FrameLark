import {validateDocument} from './document.js';
import {applyCommands} from './commands.js';
import {documentHash,contentHash} from './identity.js';
import {object,identifier,title,hashValue,ids,fail} from './values.js';
export function normalizeDocumentProposal(proposal){
  object(proposal,['baseRevision','baseHash','requestId','name','goal','tradeoff','items','selectedItemIds','provenance','scopeStepId'],['baseRevision','baseHash','items']);
  if(!Number.isSafeInteger(proposal.baseRevision)||proposal.baseRevision<0)fail('INVALID_PROPOSAL','提案基础 revision 无效。');hashValue(proposal.baseHash);if(proposal.requestId!==undefined)identifier(proposal.requestId);
  for(const key of ['name','goal','tradeoff'])if(proposal[key]!==undefined&&(typeof proposal[key]!=='string'||proposal[key].length>(key==='name'?120:600)))fail('INVALID_PROPOSAL','提案说明过长或无效。');
  if(proposal.scopeStepId!==undefined&&proposal.scopeStepId!==null)identifier(proposal.scopeStepId);
  if(proposal.provenance!==undefined){object(proposal.provenance,['policy','generatedBy'],['policy','generatedBy']);if(JSON.stringify(proposal.provenance).length>8192)fail('INVALID_PROPOSAL','策略来源过大。');}
  if(!Array.isArray(proposal.items)||!proposal.items.length||proposal.items.length>24)fail('INVALID_PROPOSAL','提案需要 1～24 项。');ids(proposal.items.map(item=>item.id),24);let count=0;const seen=new Set();
  for(const item of proposal.items){object(item,['id','title','commands','dependsOn','visual'],['id','title','commands']);title(item.title);ids(item.dependsOn||[],24);if(item.visual!==undefined){object(item.visual,['goal','benefit','tradeoff','findingIds'],['goal','benefit','tradeoff','findingIds']);for(const key of ['goal','benefit','tradeoff'])if(typeof item.visual[key]!=='string'||!item.visual[key].trim()||item.visual[key].length>600)fail('INVALID_PROPOSAL','视觉目标、收益和代价需具体文字。');ids(item.visual.findingIds,12);}if(!Array.isArray(item.commands)||!item.commands.length)fail('INVALID_PROPOSAL','提案项需要有限命令。');count+=item.commands.length;for(const dependency of item.dependsOn||[])if(!seen.has(dependency))fail('INVALID_ORDER','提案依赖必须位于前面。');seen.add(item.id);}
  if(count>24||JSON.stringify(proposal).length>1024*1024)fail('INVALID_PROPOSAL','提案命令或输入大小超过限制。');if(proposal.selectedItemIds!==undefined)ids(proposal.selectedItemIds,24);
  return {...structuredClone(proposal),items:proposal.items.map(item=>({...structuredClone(item),dependsOn:item.dependsOn||[]}))};
}
export function compileDocumentProposal(base,input,selectedItemIds){
  validateDocument(base);const proposal=normalizeDocumentProposal(input),beforeHash=documentHash(base);if(base.revision!==proposal.baseRevision||beforeHash!==proposal.baseHash)fail('STALE_REVISION','提案依据的编辑文档已变化，请重新预览。');
  const selected=selectedItemIds??proposal.selectedItemIds??proposal.items.map(item=>item.id);ids(selected,24);const chosen=new Set(selected);
  if(selected.some(id=>!proposal.items.some(item=>item.id===id)))fail('UNKNOWN_ITEM','选择包含不存在的提案项。');for(const item of proposal.items)if(chosen.has(item.id)&&item.dependsOn.some(id=>!chosen.has(id)))fail('DEPENDENCY_REQUIRED','请同时选择提案所需的资源。',{itemId:item.id,dependsOn:item.dependsOn});
  const commands=proposal.items.filter(item=>chosen.has(item.id)).flatMap(item=>item.commands),requestId=(proposal.requestId||'proposal')+'-'+contentHash({beforeHash,commands}).slice(0,12);
  const result=commands.length?applyCommands(base,commands,{expectedRevision:proposal.baseRevision,expectedHash:proposal.baseHash,requestId:requestId.slice(0,80)}):{next:structuredClone(base),noChange:true,transaction:null};
  const candidateHash=documentHash(result.next),selectionHash=contentHash({source:base.source,baseHash:beforeHash,baseRevision:base.revision,items:proposal.items,selectedItemIds:selected,candidateHash});
  return {document:result.next,transaction:result.transaction||null,items:proposal.items,selectedItemIds:[...selected],selectionHash,candidateHash,noChange:beforeHash===candidateHash,proposal};
}
