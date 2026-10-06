import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, readFile, rm, chmod} from 'node:fs/promises';
import {join, delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {installPhotographyEye} from '../../scripts/install-photography-eye.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const id = 'framelark-eye@framelark';
async function fixture(t, {skills = ['photography-eye'], enabled = true, existing = false, origin = 'https://github.com/GeminiLight/FrameLark.git', refreshErrors = []} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'framelark-eye-quick-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, '.codex-plugin'));
  await writeFile(join(root, '.codex-plugin/plugin.json'), JSON.stringify({name: 'framelark-eye', version: '0.1.0', skills: './skills/'}));
  for (const skill of skills) {
    await mkdir(join(root, 'skills', skill), {recursive: true});
    await writeFile(join(root, 'skills', skill, 'SKILL.md'), '---\nname: ' + skill + '\n---\nPhotographic guidance.');
  }
  if (existing) {
    execFileSync('git', ['init', '--quiet'], {cwd: root});
    execFileSync('git', ['remote', 'add', 'origin', origin], {cwd: root});
  }
  const calls = [];
  const codex = args => {
    calls.push(args);
    if (args[1] === 'marketplace' && args[2] === 'list') return {marketplaces: existing ? [{name: 'framelark', root}] : []};
    if (args[1] === 'marketplace' && args[2] === 'upgrade') return {errors: refreshErrors};
    if (args[1] === 'marketplace' && args[2] === 'add') return {installedRoot: root};
    if (args[1] === 'add') return {pluginId: id, installedPath: root};
    if (args[1] === 'list') return {installed: [{pluginId: id, installed: true, enabled}]};
    throw Error('Unexpected Codex operation: ' + args.join(' '));
  };
  return {root, codex, calls};
}

test('first install selects only the GitHub photography plugin and verifies enabled state', async t => {
  const f = await fixture(t), result = await installPhotographyEye({codex: f.codex});
  assert.equal(result.ok, true); assert.equal(result.enabled, true); assert.equal(result.installed, true);
  assert.deepEqual(result.skills, ['photography-eye']); assert.equal(result.retouchDependencies, 'not-required');
  assert.deepEqual(f.calls, [
    ['plugin', 'marketplace', 'list'], ['plugin', 'marketplace', 'add', 'GeminiLight/FrameLark'],
    ['plugin', 'add', id], ['plugin', 'list', '--marketplace', 'framelark']
  ]);
});

test('repeat install refreshes the canonical repository without removing its marketplace', async t => {
  const f = await fixture(t, {existing: true, origin: 'git@github.com:GeminiLight/FrameLark.git'});
  await installPhotographyEye({codex: f.codex});
  assert.ok(f.calls.some(args => args[2] === 'upgrade'));
  assert.ok(!f.calls.some(args => args.includes('remove') || args.includes('setup')));
});

test('a conflicting marketplace is preserved and never receives an install', async t => {
  const f = await fixture(t, {existing: true, origin: 'https://github.com/example/other.git'});
  await assert.rejects(installPhotographyEye({codex: f.codex}), /已保留原配置/);
  assert.deepEqual(f.calls, [['plugin', 'marketplace', 'list']]);
});

test('refresh errors stop before installing a possibly stale plugin', async t => {
  const f = await fixture(t, {existing: true, refreshErrors: [{message: 'offline'}]});
  await assert.rejects(installPhotographyEye({codex: f.codex}), /市场刷新失败/);
  assert.ok(!f.calls.some(args => args[1] === 'add'));
});

test('disabled plugins and unexpected retouch payloads cannot report success', async t => {
  const disabled = await fixture(t, {enabled: false});
  await assert.rejects(installPhotographyEye({codex: disabled.codex}), /已安装但未启用/);
  const extra = await fixture(t, {skills: ['photography-eye', 'photo-retouch']});
  await assert.rejects(installPhotographyEye({codex: extra.codex}), /安装内容与预期不一致/);
});

test('the complete installer runs from stdin with no checkout or external Node modules', async t => {
  const f = await fixture(t), bin = join(f.root, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'codex'), `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[1]==='marketplace'&&args[2]==='list')console.log('{"marketplaces":[]}');
else if(args[1]==='marketplace')console.log('{}');
else if(args[1]==='add')console.log(JSON.stringify({pluginId:${JSON.stringify(id)},installedPath:${JSON.stringify(f.root)}}));
else if(args[1]==='list')console.log(JSON.stringify({installed:[{pluginId:${JSON.stringify(id)},installed:true,enabled:true}]}));
else process.exit(1);
`);
  await chmod(join(bin, 'codex'), 0o755);
  const code = await readFile(join(repositoryRoot, 'scripts/install-photography-eye.mjs'), 'utf8');
  const result = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: f.root, input: code, encoding: 'utf8', env: {...process.env, PATH: bin + delimiter + process.env.PATH}
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).pluginId, id);
  assert.match(result.stderr, /不代表已安装到其他设备/);
  const dataURL = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const remote = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(dataURL) + ')'], {
    cwd: f.root, encoding: 'utf8', env: {...process.env, PATH: bin + delimiter + process.env.PATH}
  });
  assert.equal(remote.status, 0, remote.stderr);
  assert.equal(JSON.parse(remote.stdout).enabled, true);
});

test('importing installer helpers from an inline script does not install anything', () => {
  const url = new URL('../../scripts/install-photography-eye.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(' + JSON.stringify(url) + ')'], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

for (const prefix of ['', '/FrameLark']) test(`installation page and its resources work at ${prefix || 'the domain root'}`, async t => {
  const output = await mkdtemp(join(tmpdir(), 'framelark-eye-site-'));
  t.after(() => rm(output, {recursive: true, force: true}));
  execFileSync(process.execPath, ['apps/website/build.mjs', '--out', output, '--site-url', `https://example.com${prefix}/`], {cwd: repositoryRoot});
  const page = await readFile(join(output, 'install.html'), 'utf8');
  const link = new URL(page.match(/id="codex-install" href="([^"]+)"/)[1]);
  assert.equal(link.protocol, 'codex:'); assert.equal(link.hostname, 'new');
  assert.match(link.searchParams.get('prompt'), /只安装 framelark-eye@framelark/);
  assert.match(link.searchParams.get('prompt'), /installed 和 enabled 都为 true/);
  assert.match(link.searchParams.get('prompt'), /不能把云端安装说成已安装/);
  assert.ok(page.includes(`src="${prefix}/install.js?v=1"`));
  assert.ok(page.includes(`href="${prefix}/install.css?v=1"`));
  assert.ok(page.includes('codex://plugins/install/framelark-eye?marketplace=framelark'));
  assert.ok((await readFile(join(output, 'index.html'), 'utf8')).includes(`href="${prefix}/install.html"`));
  assert.ok((await readFile(join(output, 'sitemap.xml'), 'utf8')).includes(`https://example.com${prefix}/install.html`));
  await readFile(join(output, 'install.css')); await readFile(join(output, 'install.js'));
});
