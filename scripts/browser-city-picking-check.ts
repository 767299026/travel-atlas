import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { browserFixture } from './browser-fixture.js';
import { amapFixture } from './lib/amap-fixture.js';
import { projectRoot } from '../backend/src/config.js';
const fixture = await browserFixture({ routingWorker: false }), real = process.env.REAL_AMAP === 'true';
const output = projectRoot + '/data/city-picking-20261026/' + (process.env.REVIEW_LABEL || (real ? 'real-round1' : 'fixture'));
await mkdir(output, { recursive: true }); const cases: string[] = [], errors: string[] = []; let page: any;
try {
  const base = real ? 'https://travel.yiqu.love' : fixture.web;
  const context = await fixture.browser.newContext({ viewport: { width: 393, height: 775 }, locale: 'zh-CN' });
  await context.addInitScript('globalThis.__name=(fn)=>fn;');
  if (!real) await context.addInitScript({ content: amapFixture });
  else {
    if (process.env.VECTOR_AMAP !== 'false') await context.addInitScript('window.forceWebGL=true;');
    await context.route(base + '/**', async (route: any) => {
      const url = new URL(route.request().url()), root = process.env.FRONTEND_TEST_DIST!;
      if (url.pathname.startsWith('/api/')) return route.fulfill({ response: await route.fetch({ url: 'http://127.0.0.1:3091' + url.pathname + url.search }) });
      if (url.pathname.startsWith('/assets/')) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript', body: await readFile(root + url.pathname) });
      if (route.request().resourceType() === 'document') return route.fulfill({ contentType: 'text/html', body: await readFile(root + '/index.html') });
      return route.continue();
    });
  }
  page = await context.newPage(); page.on('pageerror', (error: Error) => errors.push(error.message.replace(/https?:\/\/\S+/g, '[url]'))); page.on('dialog', (dialog: any) => dialog.accept());
  await page.goto(base); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).click(); await page.locator('.atlas-reference-map canvas').waitFor();
  const call = (path: string, body?: unknown, method = 'POST') => page.evaluate(async ({ path, body, method }: any) => {
    const session = (await (await fetch('/api/v1/auth/session')).json()).data;
    const response = await fetch('/api/v1' + path, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: body ? JSON.stringify({ ...body, clientMutationId: crypto.randomUUID() }) : undefined });
    if (!response.ok) throw Error('Isolated fixture request failed: ' + response.status);
    return (await response.json()).data;
  }, { path, body, method });
  const coordinates = [[114.3, 30.6], [114.3002, 30.6], [114.31, 30.6], [114.32, 30.6]], names = ['江边起点', '附近观景处', '中间休息处', '步道终点'];
  for (const [index, title] of ['甲日沿江散步', '乙日沿江重访'].entries()) {
    const date = index ? '2026-10-02' : '2025-10-01';
    const created = await call('/journeys', { title, destinations: ['武汉市'], origin: '', startDate: date, duration: 1 });
    let route = await call('/journeys/' + created.journey.id + '/actual', {});
    const tripCoordinates = index ? coordinates : [...coordinates, ...Array.from({ length: 4 }, () => coordinates[0]!)];
    route = (await call('/routes/' + route.id + '/commands', { baseVersion: route.version, operations: tripCoordinates.map((point, i) => ({ type: 'add_stop', clientRef: 'draft:p' + i, dayId: route.days[0].id, arrivalMode: i < coordinates.length ? 'hike' : 'unknown', stop: { label: names[i] || '江边补记 ' + (i - 3), region: '武汉市', role: 'visit', note: '隔离交互测试，非实地路线', time: null, location: { longitude: point[0], latitude: point[1], crs: 'GCJ02' } } })) })).route;
    for (const stop of route.days[0].stops) await call('/routes/' + route.id + '/stops/' + stop.id + '/visit', { routeVersion: route.version, visitedOn: date, note: '隔离交互测试', place: { countryCode: 'CHN', areaCode: '420100' } });
    for (const [i, segment] of route.segments.slice(0, coordinates.length - 1).entries()) route = (await call('/routes/' + route.id + '/segments/' + segment.id + '/geometry', { baseVersion: route.version, expectedGeometryRef: null, kind: 'manual', sourceNote: '隔离交互测试的相同折线，非导航数据', geometry: { crs: 'GCJ02', parts: [[coordinates[i], coordinates[i + 1]]] } }, 'PUT')).route;
  }
  await page.reload(); // Refresh summaries created through the isolated API.
  await page.locator('.atlas-reference-map canvas').waitFor();
  // Install capture after reload; the real SDK is loaded explicitly in this test context.
  await page.evaluate(async () => {
    const win = window as any;
    if (!win.AMap) { const caps = (await (await fetch('/api/v1/maps/capabilities')).json()).data; win._AMapSecurityConfig = { serviceHost: location.origin + caps.amap.serviceHost }; await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://webapi.amap.com/maps?v=2.0&key=' + encodeURIComponent(caps.amap.jsKey); script.onload = () => resolve(); script.onerror = () => reject(Error('SDK failed')); document.head.append(script); }); }
    win.AMap.Map = new Proxy(win.AMap.Map, { construct(target, args) { const map = Reflect.construct(target, args); win.pickingMap = map; return map; } });
  });
  await page.getByRole('button', { name: '寻找', exact: true }).click(); await page.getByRole('searchbox', { name: '搜索城市足迹', exact: true }).fill('武汉'); await page.locator('.atlas-search-results').getByRole('button', { name: /武汉市/ }).click(); await page.getByRole('button', { name: '进入城市地图', exact: true }).click();
  const canvas = page.locator('.city-footprint-canvas'), settle = async () => { await page.locator('.city-map-message').waitFor({ state: 'hidden', timeout: 60000 }); await page.waitForFunction(() => document.querySelector('.city-footprint-canvas')?.getAttribute('data-rendering') === 'false'); await page.waitForTimeout(real ? 1800 : 100); if (real) await page.waitForFunction(() => { const win = window as any, map = win.pickingMap, center = map.getCenter(), key = [map.getZoom().toFixed(3), center.getLng().toFixed(6), center.getLat().toFixed(6)].join(':'); const previous = win.pickingSettled; win.pickingSettled = { key, count: previous?.key === key ? previous.count + 1 : 0 }; return win.pickingSettled.count >= 4; }, undefined, { polling: 250, timeout: 15000 }); };
  const shot = async (name: string) => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.ok(await page.locator('.bottom-nav').evaluate((element: HTMLElement) => element.getBoundingClientRect().bottom <= innerHeight + 1)); await page.screenshot({ path: output + '/' + name + '.png' }); cases.push(name); };
  const clickable = async (selector: string) => { for (const item of await page.locator(selector).all()) if (await item.evaluate((element: HTMLElement) => { const box = element.getBoundingClientRect(); return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('button') === element; })) return item; throw Error('No clickable ' + selector); };
  await settle(); assert.equal(await canvas.getAttribute('data-visible-points'), '12'); assert.ok(Number(await canvas.getAttribute('data-markers')) < 12); await shot('overview-clustered');
  const before = Number(await canvas.getAttribute('data-zoom')); await (await clickable('.city-cluster-anchor[data-record-count="8"]')).click(); await settle(); await page.waitForTimeout(real ? 3200 : 1700); assert.ok(Number(await canvas.getAttribute('data-zoom')) > before); await shot('nearby-cluster-zooms'); if (await page.locator('.city-map-choices').count()) await page.getByRole('button', { name: '关闭候选列表', exact: true }).click();
  await page.evaluate(() => (window as any).pickingMap.setZoomAndCenter(20, [114.3, 30.6], true)); await settle(); if (real) await page.waitForTimeout(1800);
  const cluster = await clickable('.city-cluster-anchor[data-record-count="6"],.city-cluster-anchor[data-record-count="8"]'), recordChoices = Number(await cluster.getAttribute('data-record-count')); await cluster.click(); await page.locator('.city-map-choices').waitFor(); assert.equal(await page.locator('.city-map-choice').count(), recordChoices); const text = await page.locator('.city-map-choices').innerText(); assert.ok(text.includes('甲日沿江散步') && text.includes('乙日沿江重访')); await shot('coincident-records-choice');
  const recordZoom = await canvas.getAttribute('data-zoom'); await page.locator('.city-choice-list').hover(); await page.mouse.wheel(0, 180); await page.waitForFunction(() => (document.querySelector('.city-choice-list')?.scrollTop ?? 0) > 0); assert.equal(await canvas.getAttribute('data-zoom'), recordZoom); cases.push('long-record-list-scrolls-without-map-zoom');
  const zoom = await canvas.getAttribute('data-zoom'); await page.keyboard.press('Escape'); assert.equal(await page.locator('.city-map-choices').count(), 0); assert.equal(await canvas.getAttribute('data-zoom'), zoom); assert.ok(await cluster.evaluate((element: HTMLElement) => document.activeElement === element)); cases.push('escape-restores-cluster-focus-and-camera');
  await cluster.press('Enter'); await page.locator('.city-map-choices').waitFor(); const record = await page.locator('.city-map-choice').first().getAttribute('data-choice-id'); await page.locator('.city-map-choice').first().click(); await settle(); assert.equal(await canvas.getAttribute('data-selected-record'), record); assert.equal(await canvas.getAttribute('data-visible-points'), '1'); assert.equal(await page.locator('.city-memory.expanded').count(), 0); await shot('selected-record-preview');
  await page.getByRole('button', { name: '取消选择', exact: true }).click(); await settle(); await page.getByRole('button', { name: '展开地图工具', exact: true }).click(); await page.getByRole('button', { name: '查看全部城市足迹', exact: true }).click(); await settle(); await page.getByRole('button', { name: '地图内容', exact: true }).click(); await page.getByRole('checkbox', { name: '显示全部路线', exact: true }).check(); await settle(); await page.locator('.city-map-layers').getByRole('button', { name: '关闭', exact: true }).click();
  const tapRoute = async () => {
    if (!real) { await page.locator('.city-online-map').dispatchEvent('pointerdown'); return page.evaluate(() => { const map = (window as any).pickingMap; map.handlers.click({ lnglat: [114.315, 30.6] }); map.handlers.click({ lnglat: [114.315, 30.6] }); }); }
    const pixel = await page.evaluate(() => { const pixel = (window as any).pickingMap.lngLatToContainer([114.315, 30.6]); return { x: pixel.getX(), y: pixel.getY() }; }), box = await page.locator('.city-online-map').boundingBox(); await page.mouse.click(box.x + pixel.x, box.y + pixel.y);
  };
  await tapRoute(); await page.locator('.city-map-choices').waitFor(); assert.equal(await page.locator('.city-map-choice').count(), 2); await shot('overlapping-journeys-choice');
  const routeZoom = await canvas.getAttribute('data-zoom'), popup = await page.locator('.city-map-choices').boundingBox(); await page.mouse.move(popup.x + 60, popup.y + 65); await page.mouse.wheel(0, 140); await page.waitForTimeout(250); assert.equal(await canvas.getAttribute('data-zoom'), routeZoom); cases.push('scrolling-candidates-does-not-zoom-map');
  for (const [width, height] of [[320, 640], [844, 393], [1280, 900]]) { await page.setViewportSize({ width, height }); await page.waitForTimeout(300); await shot('choice-' + width); }
  const journey = await page.locator('.city-map-choice').first().getAttribute('data-choice-id'); await page.locator('.city-map-choice').first().click(); await settle(); assert.equal(await canvas.getAttribute('data-selected-journey'), journey); assert.equal(await canvas.getAttribute('data-visible-paths'), '3'); await shot('selected-whole-journey');
  if (!real) { await page.evaluate(() => { const win = window as any; win.oldRouteClick = win.pickingMap.items.find((item: any) => item.options?.path).handlers.click; }); await page.getByRole('button', { name: '时光', exact: true }).click(); await page.getByRole('combobox', { name: '足迹年份', exact: true }).selectOption('2025'); await settle(); const pathCount = await canvas.getAttribute('data-visible-paths'); await page.evaluate(() => (window as any).oldRouteClick()); assert.equal(await canvas.getAttribute('data-selected-journey'), ''); assert.equal(await canvas.getAttribute('data-visible-paths'), pathCount); cases.push('old-route-events-cannot-restore-previous-year-selection'); }
  if (!real) { await page.getByRole('button', { name: '时光', exact: true }).click(); await page.getByRole('combobox', { name: '足迹年份', exact: true }).selectOption('all'); await settle(); await page.evaluate(() => { const map = (window as any).pickingMap, zoom = map.setZoom; map.setZoom = function (value: number) { zoom.call(this, Math.min(14, value)); }; map.setZoomAndCenter(14, [114.3, 30.6], true); }); await settle(); await (await clickable('.city-cluster-anchor[data-record-count="8"]')).click(); await page.locator('.city-map-choices').waitFor({ timeout: 6000 }); assert.equal(await page.locator('.city-map-choice').count(), 8); await shot('provider-limit-still-offers-records'); }
  assert.deepEqual(errors, []); await writeFile(output + '/result.json', JSON.stringify({ passed: true, cases, errors, scope: real ? 'Real SDK with isolated synthetic records, no owner business data' : 'Isolated database and AMap test adapter' }, null, 2)); console.log('城市聚合与选择验证通过：' + cases.length + ' 组；' + (real ? '真实 SDK／隔离数据' : '隔离替身'));
} catch (error) { console.error(error instanceof Error ? error.message : 'Picking verification failed'); console.error({ cases, errors }); if (real) console.error(await page.evaluate(() => { const map = (window as any).pickingMap, a = map?.lngLatToContainer([114.3,30.6]), b = map?.lngLatToContainer([114.3002,30.6]); return { zoom: map?.getZoom(), gap: a && b ? [b.getX()-a.getX(),b.getY()-a.getY()] : null, clusters: [...document.querySelectorAll('.city-cluster-anchor')].map(e=>(e as HTMLElement).dataset.recordCount) }; }).catch(()=>null)); await page?.screenshot({ path: output + '/failure.png' }).catch(() => {}); process.exitCode = 1; }
finally { await fixture.cleanup(); }
