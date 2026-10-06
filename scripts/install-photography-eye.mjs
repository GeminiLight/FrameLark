// Standalone GitHub installer: Node built-ins only, so no checkout or npm install is needed.
import {execFileSync} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const repository = 'GeminiLight/FrameLark';
const marketplaceName = 'framelark';
const pluginId = 'framelark-eye@framelark';
const cliGuide = 'https://learn.chatgpt.com/docs/codex/cli';

export function runCodex(args) {
  try {
    return JSON.parse(execFileSync('codex', [...args, '--json'], {
      encoding: 'utf8', maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'inherit']
    }));
  } catch (error) {
    if (error.code === 'ENOENT') throw Error(`找不到 Codex CLI。请先安装支持插件的 CLI：${cliGuide}`);
    throw Error(`Codex 命令失败：codex ${args.join(' ')}。请检查 CLI 版本与网络后重试。`, {cause: error});
  }
}

export async function verifyInstalledPlugin({pluginId, installedPath, skills, version, codex = runCodex}) {
  if (!installedPath) throw Error('Codex 没有返回安装目录，无法核实插件内容。');
  const [name, marketplace] = pluginId.split('@');
  const manifest = JSON.parse(await readFile(join(installedPath, '.codex-plugin/plugin.json'), 'utf8'));
  if (manifest.name !== name || (version && manifest.version !== version) || manifest.skills !== './skills/') {
    throw Error('安装后的插件身份或 Skill 路径与预期不一致。');
  }
  if (manifest.mcpServers || manifest.apps || manifest.hooks) throw Error('安装包包含预期之外的服务或执行钩子。');
  const actualSkills = (await readdir(join(installedPath, 'skills'), {withFileTypes: true}))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  if (JSON.stringify(actualSkills) !== JSON.stringify([...skills].sort())) {
    throw Error(`安装内容与预期不一致：${actualSkills.join(', ')}。`);
  }
  for (const skill of skills) {
    const content = await readFile(join(installedPath, 'skills', skill, 'SKILL.md'), 'utf8');
    if (!new RegExp('^name: ' + skill + '$', 'm').test(content)) throw Error('Skill 身份不一致：' + skill);
  }
  const status = codex(['plugin', 'list', '--marketplace', marketplace]).installed?.find(item => item.pluginId === pluginId);
  if (status?.installed !== true) throw Error('Codex 未确认插件已安装；请在 /plugins 中检查后重试。');
  if (status.enabled !== true) throw Error('插件已安装但未启用。请在 /plugins 中启用它，并检查项目的插件设置。');
  return {pluginId, version: manifest.version, installedPath, installed: true, enabled: true, skills};
}

function isFrameLarkOrigin(origin) {
  return /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)GeminiLight\/FrameLark(?:\.git)?\/?$/i.test(origin.trim());
}

export async function installPhotographyEye({codex = runCodex} = {}) {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 20 || (major === 20 && minor < 9)) throw Error('快速安装需要 Node.js 20.9+。也可让本地 Codex 按官网的安装请求代装。');
  const current = codex(['plugin', 'marketplace', 'list']).marketplaces?.find(item => item.name === marketplaceName);
  if (current) {
    let origin = '';
    try {
      origin = execFileSync('git', ['-C', current.root, 'remote', 'get-url', 'origin'], {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    } catch { /* A local build is a different source; do not silently replace it. */ }
    if (!isFrameLarkOrigin(origin)) {
      throw Error('framelark 市场已指向其他来源或本地构建，已保留原配置。请在本地 Codex 中核对来源，再明确选择是否切换到 GeminiLight/FrameLark。');
    }
    const refreshed = codex(['plugin', 'marketplace', 'upgrade', marketplaceName]);
    if (refreshed.errors?.length) throw Error('FrameLark 市场刷新失败：' + JSON.stringify(refreshed.errors));
  } else {
    codex(['plugin', 'marketplace', 'add', repository]);
  }
  const installed = codex(['plugin', 'add', pluginId]);
  if (installed.pluginId !== pluginId) throw Error('Codex 返回了预期之外的插件，无法确认安装成功。');
  const verified = await verifyInstalledPlugin({pluginId, installedPath: installed.installedPath, skills: ['photography-eye'], codex});
  return {
    ok: true, ...verified, retouchDependencies: 'not-required', next: 'new-chat',
    prompt: '用 FrameLark 摄影眼看这张现场照，这里咋拍？',
    followup: '喜欢 P3，具体站在哪里？我又拍了一张，帮我看看怎么调整。'
  };
}

const direct = process.argv[1]
  ? import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
  : import.meta.url.startsWith('data:') || import.meta.url.endsWith('/[eval1]');
if (direct) {
  try {
    if (process.argv.includes('--help')) {
      console.log('安装独立摄影眼：node scripts/install-photography-eye.mjs\n需要 Node.js 20.9+、Git 和支持插件的 Codex CLI。只安装 framelark-eye@framelark；不准备修图依赖。');
    } else {
      const result = await installPhotographyEye();
      console.log(JSON.stringify(result, null, 2));
      console.error('摄影眼已安装并启用。开启新的本地 Codex 对话，附上现场照，问：这里咋拍？\n看图与可选生图以新会话提供的工具为准。本次安装作用于运行命令的 Codex 环境，不代表已安装到其他设备或 ChatGPT 手机账号。');
    }
  } catch (error) {
    console.error('摄影眼安装未完成：' + error.message);
    process.exitCode = 1;
  }
}
