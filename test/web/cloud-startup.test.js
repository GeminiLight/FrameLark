import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));
const cloud=await import('../../scripts/build-photography-eye-cloud.mjs').catch(()=>null);

test('cloud startup is a self-contained conversation workflow without installation commands',async()=>{
  assert.equal(typeof cloud?.buildCloudGuide,'function');
  const result=await cloud.buildCloudGuide();
  for(const required of ['当前对话','私有项目','不是插件安装','一张主推','四张候选','暖纸','小帧提醒'])assert.ok(result.guide.includes(required),required);
  assert.ok(!/`(?:node|npm|codex)\s/.test(result.guide),'Cloud users are not instructed to run local commands.');
  assert.ok(!/\]\((?:\.\.\/)?references\//.test(result.guide),'Reference links resolve inside the file or to public sources.');
  assert.ok(result.projectInstructions.length<2000);
  assert.ok(result.guide.includes('reference-board-design'),'The board design guide is bundled.');
});

test('published startup files match the maintained skill-derived export',async()=>{
  assert.equal(typeof cloud?.buildCloudGuide,'function');
  const result=await cloud.buildCloudGuide();
  for(const path of ['CLOUD.md','apps/website/public/downloads/photography-eye.cloud.txt'])assert.equal(await readFile(join(root,path),'utf8'),result.guide,path+' must be regenerated after changing the Skill.');
  assert.equal(await readFile(join(root,'apps/website/public/downloads/photography-eye.project.txt'),'utf8'),result.projectInstructions);
});

for(const prefix of ['', '/FrameLark'])test(`mobile cloud setup and downloads work at ${prefix||'the domain root'}`,async t=>{
  const output=await mkdtemp(join(tmpdir(),'framelark-cloud-site-'));t.after(()=>rm(output,{recursive:true,force:true}));
  execFileSync(process.execPath,['apps/website/build.mjs','--out',output,'--site-url',`https://example.com${prefix}/`],{cwd:root});
  const page=await readFile(join(output,'cloud.html'),'utf8');
  assert.match(page,/当前对话/);assert.match(page,/私有项目/);
  assert.ok(page.includes(`href="${prefix}/downloads/photography-eye.cloud.txt"`),'The phone can download the guide.');
  assert.deepEqual(await readFile(join(output,'downloads/photography-eye.cloud.txt')),await readFile(join(root,'CLOUD.md')));
  assert.ok((await readFile(join(output,'index.html'),'utf8')).includes(`href="${prefix}/cloud.html"`),'The homepage has a cloud setup entry.');
});
