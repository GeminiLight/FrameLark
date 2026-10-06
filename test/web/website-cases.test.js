import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../',import.meta.url));

for(const prefix of ['', '/FrameLark'])test(`published cases work at ${prefix||'the domain root'}`,async t=>{
  const output=await mkdtemp(join(tmpdir(),'framelark-website-cases-'));
  t.after(()=>rm(output,{recursive:true,force:true}));
  execFileSync(process.execPath,['apps/website/build.mjs','--out',output,'--site-url',`https://example.com${prefix}/`],{cwd:root});
  const cases=await readFile(join(output,'examples.html'),'utf8');
  assert.ok(cases.includes(`src="${prefix}/assets/cases/arcade-input.jpg"`),'the scene input remains visible');
  assert.ok(cases.includes(`src="${prefix}/assets/cases/arcade-reference.png"`),'the selected output remains visible');
  assert.match(cases,new RegExp(`href="${prefix}/studio/"[^>]*data-case-studio`),'the case CTA opens the published editor');
  assert.ok(cases.includes(`href="${prefix}/"`),'the case brand returns to the homepage');
  assert.ok(!cases.includes(`href="${prefix}/studio/" aria-label="帧好`),'the brand link is not mistaken for the editor CTA');
  assert.deepEqual(await readFile(join(output,'assets/cases/arcade-reference.png')),await readFile(join(root,'apps/studio/public/assets/cases/arcade-reference.png')),'the approved image is published without pixel changes');
  assert.match(await readFile(join(output,'examples.css'),'utf8'),/case-pair/);
  assert.ok((await readFile(join(output,'sitemap.xml'),'utf8')).includes(`https://example.com${prefix}/examples.html`));
  const homepage=await readFile(join(output,'index.html'),'utf8');
  assert.ok(homepage.includes(`href="${prefix}/examples.html"`),'the official homepage has a case entry');
  assert.ok(homepage.includes(`src="${prefix}/assets/cases/arcade-input.jpg"`),'the homepage shows the original input beside its output');
  assert.ok((await readFile(join(output,'studio/index.html'),'utf8')).includes(`href="${prefix}/examples.html"`),'the published editor links to cases');
});
