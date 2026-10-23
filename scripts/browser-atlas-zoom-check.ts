import { openMapTools, waitForMapCenter } from './lib/map-tools.js';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq, getTableName } from 'drizzle-orm';
import { browserFixture } from './browser-fixture.js';
import { config, projectRoot } from '../backend/src/config.js';
import { seedDemo } from './lib/demo-data.js';
import { amapFixture } from './lib/amap-fixture.js';
const fixture = await browserFixture({ routingWorker: false }), output = projectRoot + '/data/browser-atlas-zoom-check';
await mkdir(output, { recursive: true });
const cases: string[] = [], errors: string[] = []; let page: any;
try {
  const [owner] = await fixture.database.db.select().from(fixture.database.schema.users).where(eq(fixture.database.schema.users.username, fixture.username));
  await seedDemo(fixture.database, { ...config, prefix: getTableName(fixture.database.schema.users).replace(/users$/, ''), mediaRoot: fixture.mediaRoot }, owner!.id, fixture.mediaRoot + '/demo.json');
  const context = await fixture.browser.newContext({ viewport: { width: 393, height: 775 }, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  await context.addInitScript({ content: amapFixture }); page = await context.newPage(); page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(fixture.web); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).click();
  const map = page.getByRole('group', { name: '足迹地区地图', exact: true });
  const settle = async () => { await page.locator('.atlas-native-canvas .atlas-map-status').waitFor({ state: 'hidden' }); await page.waitForTimeout(450); };
  const marker = () => page.getByRole('button', { name: '武汉市，已到访', exact: true }).locator('.pin-core');
  const zoomAtWuhan = async () => { const b = await marker().boundingBox(); assert.ok(b); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -80); await page.waitForTimeout(550); };
  const scope = () => map.getAttribute('data-scope');
  await map.waitFor(); await settle(); await page.screenshot({ path: output + '/china-palette.png' });
  assert.equal(await map.getAttribute('data-projection'), 'EPSG:3857');
  const regions = (await (await context.request.get(fixture.web + '/api/v1/atlas/maps/100000')).json()).data.features;
  const anchorNames = ['新疆维吾尔自治区', '黑龙江省', '海南省'];
  const anchors = await page.evaluate((names: string[]) => names.map(name => { const element = [...document.querySelectorAll<HTMLElement>('.atlas-region-label')].find(e => e.title === name)!; const b = element.getBoundingClientRect(), host = document.querySelector('.atlas-reference-map')!.getBoundingClientRect(); return { name, x: b.x + b.width / 2 - host.x, y: b.y + b.height / 2 - host.y, lng: Number(element.dataset.labelLongitude), lat: Number(element.dataset.labelLatitude) }; }), anchorNames);
  const source = anchors.map((a: any) => [a.lng, a.lat]);
  assert.equal(regions.length > 30, true);
  const projectedY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) * 180 / Math.PI;
  const sx = (anchors[1].x - anchors[0].x) / (source[1][0] - source[0][0]), sy = (anchors[2].y - anchors[1].y) / (projectedY(source[1][1]) - projectedY(source[2][1]));
  assert.ok(Math.abs(sx / sy - 1) < .02, 'rendered Mercator coordinates must use equal horizontal and vertical scales');
  const x0 = anchors[0].x - source[0][0] * sx, y0 = anchors[2].y + projectedY(source[2][1]) * sy;
  const areaForBounds = await map.boundingBox(); assert.ok(x0 + 73.5 * sx >= 0 && x0 + 135.1 * sx <= areaForBounds.width, 'default view must contain the mainland east/west extent');
  assert.ok(y0 - projectedY(53.57) * sy >= 0 && y0 - projectedY(18.0) * sy <= areaForBounds.height, 'default view must contain the mainland north/south extent');
  cases.push('mercator-outline-proportions-and-complete-default-mainland-view');
  const canvas = await page.locator('.atlas-reference-map canvas').elementHandle();
  for (let i = 0; i < 8 && await scope() === '100000'; i++) await zoomAtWuhan();
  assert.equal(await scope(), '420000'); await page.getByRole('heading', { name: '湖北省', exact: true }).waitFor(); await settle();
  assert.ok(await canvas.evaluate((e: HTMLElement) => e.isConnected), 'reuse the Canvas during scope changes');
  assert.ok(Number(await map.getAttribute('data-level')) >= 6, 'keep the zoom instead of refitting province bounds');
  assert.equal(await page.locator('.atlas-drawer-scroll').count(), 0); await page.screenshot({ path: output + '/wheel-enters-hubei.png' }); cases.push('wheel-focus-enters-hubei-without-click-or-camera-reset');
  const before = Number(await map.getAttribute('data-level'));
  await openMapTools(page); await page.getByRole('button', { name: '缩小足迹地图', exact: true }).click(); await page.waitForTimeout(600); assert.equal(await scope(), '420000');
  await openMapTools(page); await page.getByRole('button', { name: '放大足迹地图', exact: true }).click(); await page.waitForTimeout(600); assert.equal(await scope(), '420000'); assert.equal(Number(await map.getAttribute('data-level')), before); cases.push('separate-thresholds-prevent-province-oscillation');
  for (let i = 0; i < 6 && await page.locator('.city-footprint-canvas').count() === 0; i++) await zoomAtWuhan();
  await page.locator('.city-footprint-canvas[data-city="420100"][data-points="3"]').waitFor(); await page.waitForTimeout(500);
  assert.equal(await page.locator('.city-footprint-canvas').getAttribute('data-zoom'), '10', 'city entry shows city overview rather than jumping to a cluster of visits');
  assert.equal(await page.locator('.atlas-drawer-scroll').count(), 0); await page.screenshot({ path: output + '/wheel-enters-wuhan.png' }); cases.push('continued-wheel-enters-city-2d-with-footprints-and-collapsed-drawer');
  for (let i = 0; i < 3; i++) { await openMapTools(page); await page.getByRole('button', { name: '缩小城市地图', exact: true }).click(); await page.waitForTimeout(250); }
  await map.waitFor(); await settle(); assert.equal(await scope(), '420000'); assert.equal(await map.getAttribute('data-level'), '6.50'); cases.push('city-zoom-out-returns-to-province-once');
  for (let i = 0; i < 3; i++) { await openMapTools(page); await page.getByRole('button', { name: '缩小足迹地图', exact: true }).click(); await page.waitForTimeout(500); }
  await settle(); assert.equal(await scope(), '100000'); cases.push('province-zoom-out-returns-to-national');
  await openMapTools(page); await page.getByRole('button', { name: '重置足迹地图', exact: true }).click(); await waitForMapCenter(page); await page.waitForTimeout(600); assert.equal(await scope(), '100000');
  await page.setViewportSize({ width: 360, height: 740 }); await page.waitForTimeout(600); assert.equal(await scope(), '100000'); await page.setViewportSize({ width: 393, height: 775 }); await page.waitForTimeout(400); cases.push('reset-and-resize-do-not-drill');
  const atlas = (await (await context.request.get(fixture.web + '/api/v1/atlas')).json()).data, wuhan = atlas.places.find((p: any) => p.place.cityCode === '420100').place.center;
  const dot = await marker().boundingBox(), scale = 256 * 2 ** Number(await map.getAttribute('data-level')) / 360;
  const mercatorY = (latitude: number) => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360)) * 180 / Math.PI;
  const ocean = { x: dot.x + dot.width / 2 + (129 - wuhan[0]) * scale, y: dot.y + dot.height / 2 - (mercatorY(18) - mercatorY(wuhan[1])) * scale };
  const area = await map.boundingBox(); assert.ok(ocean.x < area.x + area.width && ocean.y < area.y + area.height - 34, 'sea sample must be inside the actual map viewport');
  await page.mouse.move(ocean.x, ocean.y);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -80); await page.waitForTimeout(500); }
  assert.equal(await scope(), '100000'); assert.ok(Number(await map.getAttribute('data-level')) >= 6); cases.push('zoom-over-water-does-not-pick-nearest-province');
  await openMapTools(page); await page.getByRole('button', { name: '重置足迹地图', exact: true }).click(); await waitForMapCenter(page);
  await page.getByRole('button', { name: '世界', exact: true }).click(); await settle();
  for (let i = 0; i < 8 && await scope() === 'world'; i++) {
    const b = await page.getByRole('button', { name: '中国，已有足迹', exact: true }).boundingBox(); assert.ok(b); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.wheel(0, -80); await page.waitForTimeout(500);
  }
  await settle(); assert.equal(await scope(), '100000'); cases.push('world-zoom-over-china-enters-national');
  for (let i = 0; i < 8 && await scope() === '100000'; i++) { await openMapTools(page); await page.getByRole('button', { name: '缩小足迹地图', exact: true }).click(); await page.waitForTimeout(500); }
  await settle(); assert.equal(await scope(), 'world'); cases.push('national-zoom-out-returns-world');
  await page.getByRole('button', { name: '中国', exact: true }).click(); await settle();
  while (Number(await map.getAttribute('data-level')) < 4.75) await zoomAtWuhan();
  const pinchBox = await marker().boundingBox(), cx = pinchBox.x + pinchBox.width / 2, cy = pinchBox.y + pinchBox.height / 2;
  const cdp = await context.newCDPSession(page), fingers = (radius: number) => [{ x: cx - radius, y: cy, id: 0, radiusX: 2, radiusY: 2 }, { x: cx + radius, y: cy, id: 1, radiusX: 2, radiusY: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: fingers(14) });
  for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: fingers(14 + i * 4) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await page.waitForTimeout(650); await settle();
  assert.equal(await scope(), '420000'); cases.push('two-finger-pinch-over-hubei-enters-province');
  await page.getByRole('button', { name: '中国', exact: true }).click(); await settle();
  const fail = (route: any) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEMPORARY', message: '省级边界暂不可用' } }) });
  await page.route('**/api/v1/atlas/maps/420000', fail);
  for (let i = 0; i < 8 && await scope() === '100000'; i++) await zoomAtWuhan();
  await page.getByText('省级边界暂不可用', { exact: true }).waitFor(); await page.waitForTimeout(500);
  assert.equal(await page.locator('.city-footprint-canvas').count(), 0);
  await page.unroute('**/api/v1/atlas/maps/420000', fail); await page.getByRole('button', { name: '重新加载底图', exact: true }).click(); await settle();
  assert.equal(await scope(), '420000'); assert.equal(await map.getAttribute('data-region-count'), '17'); cases.push('failed-auto-boundary-load-can-retry-without-entering-wrong-level');
  assert.deepEqual(errors, []); await writeFile(output + '/result.json', JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, cases, errors, scope: 'isolated database and media; real Leaflet wheel and polygon data; city SDK interaction double' }, null, 2)); console.log('缩放层级浏览器验证通过：' + cases.length + ' 组。');
} catch (e) { console.error(e); console.error({ cases, errors }); await page?.screenshot({ path: output + '/failure.png' }).catch(() => {}); process.exitCode = 1; }
finally { await fixture.cleanup(); }
