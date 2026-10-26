/** Install a reviewed static export into the project resolved by the running OpenDesign instance. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rename, stat, chown, writeFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { projectRoot } from '../backend/src/config.js';
const source = resolve(process.env.PROTOTYPE_OUTPUT || join(projectRoot, 'data/opendesign-sync-20261027/export'));
const manifest = JSON.parse(await readFile(join(source, 'current/manifest.json'), 'utf8'));
const review = JSON.parse(await readFile(resolve(source, '../round1/result.json'), 'utf8'));
assert.equal(review.passed, true, 'The standalone preview must pass before installation');
assert.equal(review.exportedAt, manifest.exportedAt, 'Review must cover this exact export');
const daemon = process.env.OPENDESIGN_URL || 'http://127.0.0.1:7456';
const info = await (await fetch(daemon + '/api/projects/' + manifest.projectId)).json() as any;
assert.equal(info.project?.id, manifest.projectId); assert.ok(info.resolvedDir);
const destination = resolve(info.resolvedDir), original = await readFile(join(destination, 'index.html'));
assert.equal(createHash('sha256').update(original).digest('hex'), manifest.baseline, 'The prototype changed after export; inspect before overwriting');
const identity = await stat(destination), backup = resolve(source, '../backup-' + new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(backup, { recursive: true, mode: 0o700 });
const previous = (await readdir(destination)).filter(name => !name.startsWith('.') && (/\.(?:html|css|js|md|json)$/.test(name) || name === 'assets' || name === 'current'));
for (const name of previous) await cp(join(destination, name), join(backup, name), { recursive: true, preserveTimestamps: true });
const inventory: string[] = [];
async function copyDirectory(relative: string) {
  const path = join(source, relative), target = join(destination, relative), metadata = await stat(path);
  if (metadata.isDirectory()) { await mkdir(target, { recursive: true }); await chown(target, identity.uid, identity.gid); for (const name of await readdir(path)) await copyDirectory(join(relative, name)); }
  else {
    await mkdir(dirname(target), { recursive: true });
    const temporary = join(dirname(target), '.prototype-sync-' + randomUUID());
    await cp(path, temporary); await chown(temporary, identity.uid, identity.gid); await rename(temporary, target); inventory.push(relative);
  }
}
// The old entry stays usable until all of its new dependencies exist.
for (const name of (await readdir(source)).filter(name => name !== 'index.html')) await copyDirectory(name);
const designPath = join(destination, 'DESIGN.md'), design = await readFile(designPath, 'utf8');
const current = '# 当前静态设计基线 · 2026-10-27\n\n当前入口已按本人要求反向同步至旅行网页的最新页面与样式。默认打开 index.html；完整目录为 prototype-index.html，共 ' + (manifest.pages.length + 1) + ' 个页面／状态。页面是可编辑 HTML，样式位于 current/styles/，预览跳转位于 current/prototype.js。\n\n内容来自独立演示夹具，摄影为原型已有示例；不读取本人数据库或私密媒体，不连接业务 API。地区图为静态预览，城市图为可编辑 SVG 示意，不作导航。表单可填写，保存、分享与账号操作仅提示预览。\n\n城市地图采用紧凑顶栏、单行回忆入口、按需路线、旅程／地点小摘要、数字聚合点及重复记录／重合旅程候选。暖纸白与森林绿沿用当前网页。原 v4 脚本、样式和素材保留，当前入口不加载旧业务演示脚本。\n\n修改页面时直接编辑对应 HTML 与 current/styles/ 中的样式。再次导出需明确执行，不能自动覆盖在 OpenDesign 中进行的新设计。\n\n---\n\n以下为 v4 历史规范；有差异以当前 HTML／CSS 和上述说明为准。\n\n';
await writeFile(designPath, current + design); await chown(designPath, identity.uid, identity.gid);
const artifactPath = join(destination, 'index.html.artifact.json'), artifact = JSON.parse(await readFile(artifactPath, 'utf8'));
await writeFile(artifactPath, JSON.stringify({ ...artifact, title: '迹屿 · 当前网页静态原型', updatedAt: new Date().toISOString() }, null, 2) + '\n'); await chown(artifactPath, identity.uid, identity.gid);
await copyDirectory('index.html');
await writeFile(join(backup, 'restore-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), projectId: manifest.projectId, previous, installed: inventory, entryBaseline: manifest.baseline }, null, 2), { mode: 0o600 });
await writeFile(resolve(source, '../installation.json'), JSON.stringify({ installedAt: new Date().toISOString(), projectId: manifest.projectId, backup, pages: manifest.pages.length + 1 }, null, 2), { mode: 0o600 });
console.log(JSON.stringify({ installed: true, pages: manifest.pages.length + 1, backup, ownershipPreserved: true }));
