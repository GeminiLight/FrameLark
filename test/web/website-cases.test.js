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
  for(const name of ['arcade-input.jpg','arcade-reference.png','cafe-input.jpg','cafe-reference.png','retouch-comparison.png','series-workspace.png']){
    assert.deepEqual(await readFile(join(output,'assets/cases',name)),await readFile(join(root,'apps/studio/public/assets/cases',name)),name+' is published without changing the approved source');
  }
  assert.match(await readFile(join(output,'examples.css'),'utf8'),/case-pair/);
  assert.ok((await readFile(join(output,'sitemap.xml'),'utf8')).includes(`https://example.com${prefix}/examples.html`));
  const homepage=await readFile(join(output,'index.html'),'utf8');
  const links=[...homepage.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
  for(const anchor of ['photography','cafe','retouch','series']){
    assert.ok(links.includes(`${prefix}/examples.html#${anchor}`),anchor+' has a complete case/source entry from its feature chapter');
    assert.match(cases,new RegExp(`id="${anchor}"`),anchor+' lands at an existing case section');
  }
  for(const scene of ['arcade','cafe']){
    assert.ok(links.includes(`${prefix}/assets/cases/${scene}-input.jpg`),scene+' links to the original input');
    assert.ok(homepage.includes(`src="${prefix}/assets/website/scene-${scene}.webp"`),scene+' has an optimized source preview');
  }
  assert.ok(homepage.includes(`src="${prefix}/assets/website/photography-board.webp"`),'the arcade reference is visible in its chapter');
  assert.ok(homepage.includes(`src="${prefix}/assets/website/cafe-board.webp"`),'the cafe reference is visible in its chapter');
  assert.deepEqual([...homepage.matchAll(/data-eye-case="([^"]+)"/g)].map(match=>match[1]),['lakeside','arcade','cafe'],'the requested lakeside scene leads the switcher');
  assert.match(homepage,/<div class="eye-case-panel" id="eye-panel-lakeside"[^>]*aria-labelledby="eye-tab-lakeside"\s*>/,'the lakeside panel is the visible initial HTML state');
  const styles=await readFile(join(output,'website.css'),'utf8');
  for(const name of ['framelark-ui-cn.woff2','framelark-ui-cn-medium.woff2','framelark-ui-latin.woff2']){
    assert.ok(styles.includes(`${prefix}/assets/website/fonts/${name}`),'font URLs honor the deployment prefix');
    assert.deepEqual(await readFile(join(output,'assets/website/fonts',name)),await readFile(join(root,'apps/website/public/assets/website/fonts',name)),'font bytes survive publication');
  }
  const script=await readFile(join(output,'website.js'),'utf8');
  for(const scene of ['arcade','cafe'])assert.ok(script.includes(`${prefix}/assets/cases/${scene}-reference.png`),scene+' retains the full-resolution board action');
  assert.ok(links.includes(`${prefix}/lakeside-case.html`),'the new lakeside example keeps its complete case page');
  const lakeside=await readFile(join(output,'lakeside-case.html'),'utf8');
  assert.ok(lakeside.includes(`href="${prefix}/#eye"`),'the lakeside case returns to the site chapter');
  for(const name of ['lakeside-original.jpg','lakeside-board.webp'])assert.deepEqual(await readFile(join(output,'assets/website',name)),await readFile(join(root,'apps/website/public/assets/website',name)),name+' remains unchanged');
  assert.ok((await readFile(join(output,'studio/index.html'),'utf8')).includes(`href="${prefix}/examples.html"`),'the published editor links to cases');
});
