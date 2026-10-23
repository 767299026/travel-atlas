import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq, getTableName } from 'drizzle-orm';
import { browserFixture } from './browser-fixture.js';
import { config, projectRoot } from '../backend/src/config.js';
import { seedDemo } from './lib/demo-data.js';
import { containsAtlasPoint } from '../frontend/src/maps/atlasNavigation.js';
import { openMapTools, waitForMapCenter } from './lib/map-tools.js';

const fixture = await browserFixture({ routingWorker: false });
const output = projectRoot + '/data/browser-atlas-label-check';
await mkdir(output, { recursive: true });
const cases: string[] = [], errors: string[] = [], samples: any[] = []; let page: any;
try {
  const [owner] = await fixture.database.db.select().from(fixture.database.schema.users).where(eq(fixture.database.schema.users.username, fixture.username));
  await seedDemo(fixture.database, { ...config, prefix: getTableName(fixture.database.schema.users).replace(/users$/, ''), mediaRoot: fixture.mediaRoot }, owner!.id, fixture.mediaRoot + '/demo.json');
  const context = await fixture.browser.newContext({ viewport: { width: 393, height: 775 }, locale: 'zh-CN' });
  await context.addInitScript('globalThis.__name = (fn) => fn');
  page = await context.newPage(); page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.goto(fixture.web); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).click();
  const map = page.locator('.atlas-reference-map');
  await map.locator('canvas').waitFor();
  const settle = async () => { await page.locator('.atlas-map-status').waitFor({ state: 'hidden' }); await page.waitForTimeout(400); };
  const inspect = async (name: string) => {
    await settle();
    const sample = await page.evaluate(() => {
      const host = document.querySelector<HTMLElement>('.atlas-reference-map')!, view = host.getBoundingClientRect();
      const rect = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const labels = [...host.querySelectorAll<HTMLElement>('.atlas-region-name,.atlas-place-marker .pin-label')].filter(e => getComputedStyle(e).visibility === 'visible').map(e => {
        const r = rect(e), marker = rect(e.closest('.leaflet-marker-icon')!);
        return { name: e.textContent, kind: e.classList.contains('atlas-region-name') ? 'region' : 'place', ...r, dx: r.x + r.width / 2 - marker.x - marker.width / 2, dy: r.y + r.height / 2 - marker.y - marker.height / 2 };
      });
      const overlaps = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
      const collisions = labels.flatMap((a, i) => labels.slice(i + 1).filter(b => overlaps(a, b)).map(b => [a.name, b.name]));
      const tools = rect(host.parentElement!.querySelector('.atlas-map-tools')!);
      const dots = [...host.querySelectorAll('.pin-core')].map(rect);
      return { name: '', scope: host.dataset.scope, level: host.dataset.level, moving: host.dataset.labelsMoving, labels, collisions, controls: labels.filter(a => overlaps(a, tools)).map(a => a.name), dots: labels.filter(a => dots.some(b => overlaps(a, b))).map(a => a.name), outside: labels.filter(a => a.x < view.x || a.right > view.right || a.y < view.y || a.bottom > view.bottom - 30).map(a => a.name), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    sample.name = name; samples.push(sample);
    assert.ok(sample.labels.length >= (sample.scope === '100000' && Number(sample.level) >= 5 ? 1 : 3), name + ': keep available names visible, including a tight crop before automatic province entry');
    assert.deepEqual(sample.collisions, [], name + ': visible text rectangles overlap');
    assert.deepEqual(sample.controls, [], name + ': labels overlap map tools');
    assert.deepEqual(sample.dots, [], name + ': labels cover visit dots');
    assert.deepEqual(sample.outside, [], name + ': labels cross the viewport or source attribution');
    assert.equal(sample.overflow, false);
    for (const region of sample.labels.filter((a: any) => a.kind === 'region')) assert.ok(Math.abs(region.dx) <= 1 && Math.abs(region.dy) <= 1, name + ': administrative label moved away from its geographic anchor: ' + region.name);
    await page.screenshot({ path: output + '/' + name + '.png' }); cases.push(name);
    return sample;
  };
  await inspect('national-default-fixed-label-anchors');
  const features = (await (await context.request.get(fixture.web + '/api/v1/atlas/maps/100000')).json()).data.features;
  const anchors = await page.locator('.atlas-region-label').evaluateAll((elements: HTMLElement[]) => elements.map(e => ({ code: e.dataset.regionCode, point: [Number(e.dataset.labelLongitude), Number(e.dataset.labelLatitude)] })));
  assert.ok(anchors.length >= 30, 'compute interior anchors even for currently hidden names');
  for (const a of anchors) assert.ok(containsAtlasPoint(features.find((f: any) => f.code === a.code), a.point), 'administrative name must be anchored inside its own region: ' + a.code);
  cases.push('all-national-label-anchors-inside-own-polygons');
  // Sample each animation frame, including overlapping old label positions during zoom-out.
  await page.evaluate(() => {
    (window as any).labelFrames = [];
    const sample = () => {
      const host = document.querySelector<HTMLElement>('.atlas-reference-map')!;
      const visible = [...host.querySelectorAll<HTMLElement>('.atlas-region-name,.atlas-place-marker .pin-label')].filter(e => getComputedStyle(e).visibility === 'visible');
      (window as any).labelFrames.push({ moving: host.dataset.labelsMoving === 'true', visible: visible.length });
      if ((window as any).labelFrames.length < 65) requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  await openMapTools(page); await page.getByRole('button', { name: '放大足迹地图', exact: true }).click(); await page.waitForTimeout(1250);
  const frames = await page.evaluate(() => (window as any).labelFrames);
  assert.ok(frames.filter((f: any) => f.moving).length >= 3, 'exercise real Leaflet zoom animation');
  assert.ok(frames.filter((f: any) => f.moving).every((f: any) => f.visible === 0), 'hide transient text until final marker positions are known');
  await inspect('national-zoom-3_5-tools-open');
  for (let i = 0; i < 4; i++) { await openMapTools(page); await page.getByRole('button', { name: '放大足迹地图', exact: true }).click(); await inspect('national-zoom-' + (4 + i * .5)); }
  await openMapTools(page); await page.getByRole('button', { name: '重置足迹地图', exact: true }).click(); await waitForMapCenter(page);
  await page.getByRole('button', { name: '收起地图工具', exact: true }).click();
  await inspect('national-reset-restores-names');
  const visit = page.getByRole('button', { name: '武汉市，已到访', exact: true });
  await visit.focus(); await inspect('focused-visit-obeys-collision-rules');
  const box = await map.boundingBox(); await page.mouse.move(box.x + box.width * .55, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height * .62, { steps: 8 }); await page.mouse.up();
  await openMapTools(page); await page.getByRole('button', { name: '重置足迹地图', exact: true }).click();
  await page.waitForFunction(() => document.querySelector<HTMLElement>('.atlas-reference-map')?.dataset.cameraMoving === 'true');
  await page.waitForTimeout(80); await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .55, box.y + box.height * .55, { steps: 5 }); await page.mouse.up();
  await settle();
  assert.equal(await map.getAttribute('data-labels-moving'), 'false', 'interrupted flyTo must restore names');
  await inspect('interrupted-recenter-restores-names');
  await page.getByRole('button', { name: '世界', exact: true }).click(); await inspect('world-default-collision-and-fixed-anchors');
  for (let i = 0; i < 3; i++) { await openMapTools(page); await page.getByRole('button', { name: '放大足迹地图', exact: true }).click(); await inspect('world-zoom-' + i); }
  await page.getByRole('button', { name: '中国', exact: true }).click(); await settle();
  await page.getByRole('button', { name: '寻找', exact: true }).click(); await page.getByRole('combobox', { name: '足迹地区', exact: true }).selectOption('420000'); await inspect('hubei-fixed-anchors-and-place-dots');
  for (const [width, height] of [[320, 640], [393, 660], [844, 393], [1280, 900]]) { await page.setViewportSize({ width, height }); await inspect('hubei-' + width + 'x' + height); }
  assert.deepEqual(errors, []);
  await writeFile(output + '/result.json', JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), cases, errors, frames, samples, scope: 'isolated tables and media; real Leaflet, real text rectangles and zoom animation' }, null, 2));
  console.log('图鉴文字浏览器验证通过：' + cases.length + ' 组。');
} catch (error) { console.error(error); console.error({ cases, errors }); await page?.screenshot({ path: output + '/failure.png' }).catch(() => {}); process.exitCode = 1; }
finally { await fixture.cleanup(); }
