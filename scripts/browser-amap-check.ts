import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { browserFixture } from './browser-fixture.js';
import { projectRoot, config } from '../backend/src/config.js';
if (!config.amap) throw new Error('Map configuration is missing');
const output = join(projectRoot, 'data/browser-amap-check'); await mkdir(output, { recursive: true });
const fixture = await browserFixture(); let page: any; const responses: unknown[] = [], failures: unknown[] = [];
try {
  const context = await fixture.browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' }); page = await context.newPage();
  // Record only safe path/status and provider status codes. Never persist credential-bearing URLs.
  page.on('response', async (response: any) => {
    const url = new URL(response.url()); if (!url.pathname.startsWith('/api/v1/maps/')) return;
    let codes: string[] = []; if (url.pathname.includes('_AMapService')) { const text = await response.text().catch(() => ''); codes = [...text.matchAll(/"(?:info|infocode|status)"\s*:\s*"([A-Z_0-9]+)"/g)].map(m => m[1]!).slice(0, 6); }
    responses.push({ path: url.pathname, status: response.status(), codes });
  });
  page.on('requestfailed', (request: any) => { const url = new URL(request.url()); if (url.hostname.includes('amap') || url.pathname.includes('_AMapService')) failures.push({ host: url.hostname, path: url.pathname }); });
  await page.goto(fixture.web); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).click(); await page.getByRole('button', { name: '旅程', exact: true }).waitFor();
  const session = (await (await context.request.get(fixture.web + '/api/v1/auth/session')).json()).data;
  const call = async (path: string, body: unknown) => { const response = await context.request.post(fixture.web + '/api/v1' + path, { headers: { origin: fixture.web, 'x-csrf-token': session.csrfToken }, data: body }); assert.ok(response.ok()); return (await response.json()).data; };
  const created = await call('/journeys', { title: '高德真实服务联调', destinations: ['黄山'], origin: '', duration: 1, startDate: null, clientMutationId: randomUUID() }); const route = created.route;
  await call('/routes/' + route.id + '/commands', { baseVersion: route.version, clientMutationId: randomUUID(), operations: [{ type: 'add_stop', clientRef: 'draft:map', dayId: route.days[0].id, stop: { label: '云谷寺显示测试', region: '', time: null, note: '', role: 'visit', location: { longitude: 118.189, latitude: 30.103, crs: 'WGS84' } }, arrivalMode: 'unknown' }] });
  await page.goto(fixture.web + '/journeys/' + created.journey.id + '/map'); await page.getByRole('button', { name: '加载高德在线地图', exact: true }).click(); await page.locator('.map-visible').waitFor({ timeout: 25000 });
  await page.waitForFunction(() => document.querySelectorAll('.amap-marker').length > 0 || !!document.querySelector('.route-map-canvas .flow-form-errors'), { timeout: 25000 });
  const error = await page.locator('.route-map-canvas .flow-form-errors').count();
  await page.screenshot({ path: join(output, 'real-amap.png'), fullPage: true });
  const result = { checkedAt: new Date().toISOString(), passed: error === 0, realSdk: true, markerCount: await page.locator('.amap-marker').count(), responses, failures, note: 'Loopback SDK/official proxy/display conversion only; not routing, production domain or account policy acceptance.' };
  await writeFile(join(output, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result)); assert.equal(error, 0, 'Real map display or conversion failed; safe diagnostics saved');
} catch { console.error('高德真实服务联调未通过；诊断只保留路径、状态码和错误类别，不记录密钥。'); await writeFile(join(output, 'failure.json'), JSON.stringify({ responses, failures }, null, 2)); process.exitCode = 1; }
finally { await fixture.cleanup(); }
