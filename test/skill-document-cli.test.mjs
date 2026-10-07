import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execute=promisify(execFile);
const skill=fileURLToPath(new URL('../skills/photo-retouch/',import.meta.url));
const sharp=createRequire(new URL('../skills/photo-retouch/package.json',import.meta.url))('sharp');
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'framelark-public-document-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const image=join(root,'source.png'),project=join(root,'photo');
  await sharp({create:{width:128,height:96,channels:3,background:'#506070'}}).png().toFile(image);
  async function cli(command,...args){
    const result=await execute(process.execPath,[join(skill,'scripts/cli.mjs'),command,'--project',project,...args],{cwd:root});
    return JSON.parse(result.stdout);
  }
  async function submit(command,plan){
    const input=join(root,'input.json');await writeFile(input,JSON.stringify(plan));return cli(command,'--input',input);
  }
  await cli('init','--image',image);
  return {root,image,project,cli,submit};
}
function proposal(context,commands){
  return {revision:context.revision,baseVersion:context.baseVersion,documentProposal:{
    baseRevision:context.documentRevision,baseHash:context.baseHash,
    items:[{id:'light',title:'曝光试片',commands}]
  }};
}
async function accept(cli,made){
  return cli('accept','--id',made.candidate.id,'--revision',String(made.project.revision),'--selection-hash',made.candidate.selectionHash,'--by','user');
}

test('public document reads let a host propose, accept, reopen and revise pixels without private hashing',async t=>{
  const {root,image,project,cli,submit}=await fixture(t),original=await readFile(image);
  let context=await cli('document');
  const first=await submit('document',proposal(context,[{type:'AddStep',step:{id:'exposure',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.4}}}]));
  assert.ok(first.preview.path);assert.ok((await readFile(first.preview.path)).length>0);
  await accept(cli,first);
  context=await cli('document');assert.equal(context.active,true);
  assert.equal(context.documentRevision,context.document.revision);assert.equal(context.documentHash,context.baseHash);
  const acceptedHash=context.baseHash;
  const second=await submit('document',proposal(context,[{type:'UpdateStepParameters',stepId:'exposure',parameters:{ev:.1}}]));
  assert.notEqual(second.preview.pixelHash,first.preview.pixelHash);
  await accept(cli,second);
  const reopened=await cli('document');assert.notEqual(reopened.baseHash,acceptedHash);
  assert.equal(reopened.document.steps.length,1);assert.equal(reopened.document.steps[0].parameters.ev,.1);
  const exported=await cli('export','--output',join(root,'final.png'));
  assert.equal(exported.versionId,second.candidate.id);
  const before=await sharp(original).raw().toBuffer(),after=await sharp(exported.path).removeAlpha().raw().toBuffer();
  assert.notDeepEqual(after,before);assert.deepEqual(await readFile(join(project,'source/original.bin')),original);
});

test('inspect identifies the current edit protocol and supplies the public identity for continued step edits',async t=>{
  const {cli,submit}=await fixture(t);let inspected=await cli('inspect');
  assert.equal(inspected.editProtocol?.mode,'legacy');assert.equal(inspected.editProtocol.capabilityCommand,'photo-tools');
  const context=await cli('document'),made=await submit('document',proposal(context,[{type:'AddStep',step:{id:'exposure',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.2}}}]));
  await accept(cli,made);inspected=await cli('inspect');
  assert.equal(inspected.editProtocol.mode,'document');assert.equal(inspected.editProtocol.capabilityCommand,'document-tools');assert.equal(inspected.editProtocol.proposalCommand,'document');
  const toolResult=await cli(inspected.editProtocol.capabilityCommand);
  const exposure=toolResult.tools.find(tool=>tool.id==='exposure');assert.ok(exposure);
  assert.ok(.3>=exposure.parameters.properties.ev.minimum&&.3<=exposure.parameters.properties.ev.maximum);
  const next=await submit(inspected.editProtocol.proposalCommand,proposal(inspected,[{type:'UpdateStepParameters',stepId:'exposure',parameters:{ev:.3}}]));
  await accept(cli,next);assert.equal((await cli('document')).document.steps[0].parameters.ev,.3);
});

test('a stale public document identity rejects an edit and leaves the accepted version intact',async t=>{
  const {cli,submit}=await fixture(t),context=await cli('document');
  const made=await submit('document',proposal(context,[{type:'AddStep',step:{id:'exposure',title:'提亮',tool:'exposure',toolVersion:2,parameters:{ev:.2}}}]));
  await accept(cli,made);const fresh=await cli('document');
  await assert.rejects(submit('document',proposal({...fresh,baseHash:context.baseHash,documentRevision:context.documentRevision},[{type:'UpdateStepParameters',stepId:'exposure',parameters:{ev:.3}}])),error=>JSON.parse(error.stderr).error.code==='STALE_REVISION');
  const after=await cli('document');assert.equal(after.baseHash,fresh.baseHash);assert.equal(after.baseVersion,fresh.baseVersion);
});
