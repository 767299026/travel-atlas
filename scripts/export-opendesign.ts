/** Export rendered UI as editable HTML/CSS. Uses disposable data, never the owner's account. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { eq, getTableName } from 'drizzle-orm';
import { browserFixture } from './browser-fixture.js';
import { seedDemo } from './lib/demo-data.js';
import { amapFixture } from './lib/amap-fixture.js';
import { config, projectRoot } from '../backend/src/config.js';

const output = resolve(process.env.PROTOTYPE_OUTPUT || join(projectRoot, 'data/opendesign-sync-20261027/export'));
const daemon = process.env.OPENDESIGN_URL || 'http://127.0.0.1:7456';
const projectId = process.env.OPENDESIGN_PROJECT_ID || '29b3ea48-0738-4712-963e-ec914fab4f77';
const info = await (await fetch(daemon + '/api/projects/' + projectId)).json() as any;
assert.equal(info.project?.id, projectId); assert.ok(info.resolvedDir);
const baseline = createHash('sha256').update(await readFile(join(info.resolvedDir, 'index.html'))).digest('hex');
await mkdir(join(output, 'current/styles'), { recursive: true });
await mkdir(join(output, 'current/maps'), { recursive: true });
await mkdir(join(output, 'assets'), { recursive: true });
for (const name of ['wuhan.jpg', 'kunming.jpg', 'chongqing.jpg', 'tokyo.jpg', 'SOURCES.md']) await cp(join(info.resolvedDir, 'assets', name), join(output, 'assets', name));
const styles = ['prototype-layout', 'prototype-base', 'prototype-journeys', 'app', 'atlas', 'maps', 'shares', 'footprint-cards', 'city-memories'];
for (const name of styles) await cp(join(projectRoot, 'frontend/src/styles', name + '.css'), join(output, 'current/styles', name + '.css'));
await cp(join(projectRoot, 'scripts/prototype-preview.js'), join(output, 'current/prototype.js'));
await cp(join(projectRoot, 'scripts/prototype-preview.css'), join(output, 'current/preview.css'));
const fixture = await browserFixture({ routingWorker: false });
const pages: { file: string; title: string; group: string }[] = [];
let page: any;
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
try {
  const [owner] = await fixture.database.db.select().from(fixture.database.schema.users).where(eq(fixture.database.schema.users.username, fixture.username));
  await seedDemo(fixture.database, { ...config, prefix: getTableName(fixture.database.schema.users).replace(/users$/, ''), mediaRoot: fixture.mediaRoot }, owner!.id, join(fixture.mediaRoot, 'demo.json'));
  const context = await fixture.browser.newContext({ viewport: { width: 393, height: 775 }, locale: 'zh-CN' });
  await context.addInitScript({ content: amapFixture + `
  globalThis.__name=(fn)=>fn;
  const Base=window.AMap.Map;
  const world=(p,z)=>{const s=256*2**z,l=p[1]*Math.PI/180;return [(p[0]+180)/360*s,(.5-Math.log(Math.tan(Math.PI/4+l/2))/(2*Math.PI))*s]};
  window.AMap.Map=class extends Base {
    getZooms(){return [3,20]}
    lngLatToContainer(p){const a=world(p,this.zoom),b=world(this.center,this.zoom);return {getX:()=>a[0]-b[0]+this.element.clientWidth/2,getY:()=>a[1]-b[1]+this.element.clientHeight/2}}
    position(){for(const item of this.items){if(item.options?.content){const p=this.lngLatToContainer(item.options.position);item.options.content.style.cssText='position:absolute;left:'+p.getX()+'px;top:'+p.getY()+'px'}}}
    add(items){super.add(items);this.position()}
    setZoom(z){super.setZoom(z);this.position()}
    getFitZoomAndCenterByOverlays(items,padding,max=15){const ps=items.flatMap(i=>i.options.path||[i.options.position]).filter(Boolean);if(!ps.length)return [10,[114.3,30.56]];const xs=ps.map(p=>p[0]),ys=ps.map(p=>p[1]),c=[(Math.min(...xs)+Math.max(...xs))/2,(Math.min(...ys)+Math.max(...ys))/2];let z=max;while(z>3){const a=world([Math.min(...xs),Math.min(...ys)],z),b=world([Math.max(...xs),Math.max(...ys)],z);if(Math.abs(a[0]-b[0])<this.element.clientWidth-140&&Math.abs(a[1]-b[1])<this.element.clientHeight-140)break;z-=.25}return [z,c]}
    setFitView(items){const v=this.getFitZoomAndCenterByOverlays(items);this.setZoomAndCenter(v[0],v[1],true)}
  };` });
  page = await context.newPage(); page.on('dialog', (dialog: any) => dialog.accept());
  const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.goto(fixture.web); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).click(); await page.locator('.atlas-reference-map canvas').waitFor();
  const session = (await (await context.request.get(fixture.web + '/api/v1/auth/session')).json()).data;
  const command = async (path: string, body: any, method = 'post') => {
    const r = await context.request[method](fixture.web + '/api/v1' + path, { headers: { origin: fixture.web, 'x-csrf-token': session.csrfToken }, data: { ...body, clientMutationId: randomUUID() } });
    assert.ok(r.ok(), 'Disposable export data request: ' + r.status()); return (await r.json()).data;
  };
  const journeys = (await (await context.request.get(fixture.web + '/api/v1/journeys?status=completed')).json()).data.items;
  const journey = journeys.find((j: any) => j.destinations.includes('武汉市')); assert.ok(journey);
  const diary = (await (await context.request.get(fixture.web + '/api/v1/diaries')).json()).data.items.find((d: any) => d.title.includes('江城'));
  // A second synthetic visit provides coincident records and overlapping-journey states.
  const extra = await command('/journeys', { title: '【演示】再访江城 · 秋日散步', destinations: ['武汉市'], origin: '武汉站', duration: 1, startDate: '2026-10-02' });
  let actual = await command('/journeys/' + extra.journey.id + '/actual', {});
  const coordinates = [[114.306, 30.543], [114.312, 30.554], [114.289, 30.558]], names = ['黄鹤楼', '昙华林', '武昌江滩'];
  actual = (await command('/routes/' + actual.id + '/commands', { baseVersion: actual.version, operations: coordinates.map((p, i) => ({ type: 'add_stop', clientRef: 'draft:p' + i, dayId: actual.days[0].id, arrivalMode: 'hike', stop: { label: names[i], region: '武汉市', role: 'visit', note: '独立原型示例', time: null, location: { longitude: p[0], latitude: p[1], crs: 'GCJ02' } } })) })).route;
  for (const stop of actual.days[0].stops) await command('/routes/' + actual.id + '/stops/' + stop.id + '/visit', { routeVersion: actual.version, visitedOn: '2026-10-02', note: '原型演示', place: { countryCode: 'CHN', areaCode: '420100' } });
  for (const [i, segment] of actual.segments.entries()) actual = (await command('/routes/' + actual.id + '/segments/' + segment.id + '/geometry', { baseVersion: actual.version, expectedGeometryRef: null, kind: 'manual', sourceNote: '原型演示补绘，不用于导航', geometry: { crs: 'GCJ02', parts: [[coordinates[i], [(coordinates[i]![0]! + coordinates[i + 1]![0]!) / 2, (coordinates[i]![1]! + coordinates[i + 1]![1]!) / 2 + .0007], coordinates[i + 1]]] } }, 'put')).route;
  const settle = async () => { await page.waitForTimeout(450); };
  const go = async (path: string) => { if (path === '/map') await page.evaluate(() => sessionStorage.clear()); await page.goto(fixture.web + path); await page.locator('.bottom-nav').waitFor(); await settle(); };
  const shot = async (file: string, title: string, group: string) => {
    await settle();
    const region = page.locator('.atlas-reference-map');
    const regionImage = await region.count() ? 'current/maps/' + file.replace('.html', '.png') : null;
    if (regionImage) { const hidden = await page.addStyleTag({ content: '.atlas-map-tools,.atlas-map-heading,.atlas-source,.atlas-map-bottom,.atlas-memory,dialog{visibility:hidden!important}' }); await region.screenshot({ path: join(output, regionImage) }); await hidden.evaluate((element: HTMLElement) => element.remove()); }
    const html = await page.evaluate(({ regionImage, file }: any) => {
      const root = document.getElementById('app')!.cloneNode(true) as HTMLElement;
      // Serialize live form state rather than Vue's original attributes.
      const original = [...document.querySelectorAll('#app input,#app textarea,#app select')];
      [...root.querySelectorAll('input,textarea,select')].forEach((element, i) => {
        const live = original[i] as HTMLInputElement;
        if (element instanceof HTMLTextAreaElement) element.textContent = live.value;
        else if (element instanceof HTMLSelectElement) [...element.options].forEach(option => option.toggleAttribute('selected', option.value === live.value));
        else { element.setAttribute('value', element.type === 'password' ? '' : live.value); element.toggleAttribute('checked', live.checked); }
      });
      for (const image of root.querySelectorAll('img')) { image.setAttribute('src', 'assets/wuhan.jpg'); image.removeAttribute('srcset'); image.removeAttribute('width'); image.removeAttribute('height'); image.setAttribute('alt', '原型示例摄影，非本人实拍'); }
      const source = document.querySelector('.atlas-reference-map'), target = root.querySelector('.atlas-reference-map');
      if (source && target && regionImage) {
        const rect = source.getBoundingClientRect(); target.innerHTML = '<img class="prototype-region-image" alt="静态地区地图预览" src="' + regionImage + '">';
        for (const element of source.querySelectorAll('button')) { const r = element.getBoundingClientRect(); if (!r.width || !r.height) continue; const hot = document.createElement('button'); hot.className = 'prototype-map-hotspot'; hot.setAttribute('aria-label', element.getAttribute('aria-label') || element.textContent || '查看城市'); hot.dataset.prototypeGo = 'city.html'; hot.style.cssText = 'left:' + (r.x - rect.x) / rect.width * 100 + '%;top:' + (r.y - rect.y) / rect.height * 100 + '%;width:' + r.width / rect.width * 100 + '%;height:' + r.height / rect.height * 100 + '%'; target.append(hot); }
      }
      // Preserve editable markers and add a key-free SVG city schematic beneath them.
      const city = root.querySelector('.city-online-map') as HTMLElement | null, liveCity = document.querySelector('.city-online-map');
      if (city && liveCity) {
        const map = (window as any).fixtureMaps.at(-1), width = liveCity.clientWidth, height = liveCity.clientHeight;
        const paths = map.items.filter((item: any) => item.options?.path).map((item: any) => '<polyline points="' + item.options.path.map((p: any) => { const q = map.lngLatToContainer(p); return q.getX() + ',' + q.getY(); }).join(' ') + '" fill="none" stroke="' + item.options.strokeColor + '" stroke-width="' + item.options.strokeWeight + '" stroke-dasharray="' + (item.options.strokeStyle === 'dashed' ? '7 5' : '') + '"/>').join('');
        const svg = '<svg class="prototype-city-base" viewBox="0 0 ' + width + ' ' + height + '" preserveAspectRatio="none" aria-label="城市底图示意"><rect width="100%" height="100%" fill="#eaf0ec"/><path d="M-40 180 Q140 100 450 390 L450 510 Q140 230 -40 290Z" fill="#c9d9d8"/><g fill="none" stroke="#fafbf8" stroke-width="14"><path d="M0 30L400 240M-30 400L440 40M50 0L390 600M-80 620L430 250M30 775L180 0"/></g><g fill="none" stroke="#d9e1dc" stroke-width="2"><path d="M0 30L400 240M-30 400L440 40M50 0L390 600M-80 620L430 250M30 775L180 0"/></g><g fill="#657c73" font-size="12" font-family="sans-serif"><text x="38" y="90">汉口</text><text x="275" y="430">武昌</text><text x="140" y="245" transform="rotate(28 140 245)">长 江</text></g>' + paths + '</svg>';
        city.insertAdjacentHTML('afterbegin', svg); city.insertAdjacentHTML('beforeend', '<small class="prototype-map-credit">城市底图示意 · 非导航</small>');
        for (const marker of city.querySelectorAll<HTMLElement>('.city-marker-object')) { marker.style.left = parseFloat(marker.style.left) / width * 100 + '%'; marker.style.top = parseFloat(marker.style.top) / height * 100 + '%'; }
      }
      for (const element of root.querySelectorAll<HTMLElement>('.online-map')) {
        const map = (window as any).fixtureMaps.find((item: any) => item.element.classList.contains('online-map'));
        if (!map) continue;
        const width = map.element.clientWidth || 350, height = map.element.clientHeight || 360;
        const lines = map.items.filter((item: any) => item.options?.path).map((item: any) => '<polyline points="' + item.options.path.map((p: any) => { const q = map.lngLatToContainer(p); return q.getX() + ',' + q.getY(); }).join(' ') + '" fill="none" stroke="#315e4c" stroke-width="4" stroke-linecap="round"/>').join('');
        const dots = map.items.filter((item: any) => item.options?.position).map((item: any) => { const q = map.lngLatToContainer(item.options.position); return '<circle cx="' + q.getX() + '" cy="' + q.getY() + '" r="6" fill="#315e4c" stroke="#fffdf4" stroke-width="2"/>'; }).join('');
        element.innerHTML = '<svg class="prototype-city-base" viewBox="0 0 ' + width + ' ' + height + '"><rect width="100%" height="100%" fill="#e8f0ec"/><path d="M0 80L400 300M0 270L400 60M60 0L250 360" stroke="#fffdf4" stroke-width="12"/>' + lines + dots + '</svg><small class="prototype-map-credit">路线底图示意 · 非导航</small>';
      }
      for (const el of root.querySelectorAll('[style]')) { if (el.getAttribute('style')?.includes('background-image') && el.getAttribute('style')?.includes('/api/')) el.removeAttribute('style'); }
      for (const el of root.querySelectorAll('[data-selected-record],[data-selected-journey],[data-choice-id],[data-journey-id]')) for (const attribute of [...el.attributes]) if (/^data-(selected|choice|journey)/.test(attribute.name)) el.removeAttribute(attribute.name);
      for (const a of root.querySelectorAll('a')) { a.removeAttribute('target'); const href = a.getAttribute('href') || ''; a.setAttribute('href', href.startsWith('/journeys') ? 'journey-days.html' : href.startsWith('/map') ? 'index.html' : '#'); }
      root.querySelector('.private-label')?.setAttribute('data-prototype-go', 'prototype-index.html');
      return root.outerHTML.replaceAll('浏览器验证', '慢慢旅行').replaceAll('browser-owner', 'traveler').replaceAll('已保存到服务器', '原型示例').replaceAll('【演示插画】用于检查封面与图文排版，不是真实旅行照片。', '示例摄影，沿用原型已有参考素材，非本人实拍。').replaceAll(/最后保存：[^<]+/g, '原型示例 · 不连接服务器');
    }, { regionImage, file });
    assert.ok(!html.includes(fixture.password));
    const pageStyles = [...styles.slice(0, 5), ...(/^(?:index|map-|world|province|city)/.test(file) ? ['footprint-cards', 'city-memories'] : []), ...(file === 'route-map.html' ? ['maps'] : []), ...(file.startsWith('share') ? ['shares'] : [])];
    const head = pageStyles.map(name => '<link rel="stylesheet" href="current/styles/' + name + '.css">').join('\n');
    await writeFile(join(output, file), '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>迹屿 · ' + escape(title) + '</title>\n' + head + '\n<link rel="stylesheet" href="current/preview.css"><script defer src="current/prototype.js"></script></head>\n<body data-prototype-page="' + file + '">\n' + html + '\n</body></html>\n');
    pages.push({ file, title, group }); console.log('Exported: ' + file);
  };
  await go('/map'); await page.locator('.atlas-reference-map canvas').waitFor(); await shot('index.html', '中国足迹', '足迹');
  await page.getByRole('button', { name: '寻找', exact: true }).click(); await shot('map-search.html', '寻找城市', '足迹'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '时光', exact: true }).click(); await shot('map-time.html', '时光年份', '足迹'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '新增足迹或心愿', exact: true }).click(); await shot('map-add.html', '记录足迹入口', '足迹'); await page.keyboard.press('Escape');
  await page.locator('.atlas-memory .atlas-drawer-toggle').click(); await shot('map-cities.html', '城市回忆卡片', '足迹');
  await page.getByRole('button', { name: '世界', exact: true }).click(); await shot('world.html', '世界足迹', '足迹');
  await go('/map'); await page.getByRole('button', { name: '寻找', exact: true }).click(); await page.getByRole('combobox', { name: '足迹地区', exact: true }).selectOption('420000'); await page.keyboard.press('Escape'); await shot('province.html', '湖北省足迹', '足迹');
  await page.getByRole('button', { name: '寻找', exact: true }).click(); await page.getByRole('searchbox', { name: '搜索城市足迹', exact: true }).fill('武汉'); await page.locator('.atlas-search-results').getByRole('button', { name: /武汉市/ }).click(); await page.getByRole('button', { name: '进入城市地图', exact: true }).click(); await page.locator('.city-map-message').waitFor({ state: 'hidden' }); await shot('city.html', '城市足迹概览', '城市地图');
  await page.locator('.city-cluster-anchor').first().click(); await page.locator('.city-map-choices').waitFor(); await shot('city-records.html', '重复到访候选', '城市地图'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '展开城市回忆', exact: true }).click(); await page.locator('.city-journey-card').first().waitFor(); await shot('city-memories.html', '城市旅程列表', '城市地图');
  await page.locator('.city-journey-card').first().click(); await shot('city-journey.html', '旅程足迹与摘要', '城市地图');
  await page.getByRole('button', { name: '取消选择', exact: true }).click(); await settle();
  // Pick the record through the small candidate list; it is deliberately not a random member.
  if (await page.locator('.city-cluster-anchor').count()) { await page.locator('.city-cluster-anchor').first().click(); await page.locator('.city-map-choice').first().click(); } else await page.locator('.city-marker-anchor').first().click();
  await shot('city-place.html', '地点足迹与摘要', '城市地图'); await page.getByRole('button', { name: '取消选择', exact: true }).click();
  await page.getByRole('button', { name: '展开地图工具', exact: true }).click(); await page.getByRole('button', { name: '地图内容', exact: true }).click(); await shot('city-layers.html', '地图内容设置', '城市地图'); await page.getByRole('checkbox', { name: '显示全部路线', exact: true }).check(); await page.locator('.city-map-layers').getByRole('button', { name: '关闭', exact: true }).click(); await settle();
  await page.evaluate(() => { const m = (window as any).fixtureMaps.at(-1); document.querySelector('.city-online-map')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); m.handlers.click({ lnglat: [114.309, 30.5492] }); }); await page.locator('.city-map-choices').waitFor(); await shot('city-routes.html', '重合旅程候选', '城市地图');
  await go('/journeys'); await shot('journeys.html', '计划中的旅程', '旅程'); await page.getByRole('button', { name: '已完成', exact: true }).click(); await page.locator('.flow-card').first().waitFor(); await shot('journeys-completed.html', '已完成的旅程', '旅程');
  await go('/journeys/new'); await shot('journey-new.html', '新建旅程', '旅程');
  await go('/journeys/' + journey.id); await page.getByRole('button', { name: '行程概览', exact: true }).click(); await shot('journey-overview.html', '行程概览', '旅程'); await page.getByRole('button', { name: '每日安排', exact: true }).click(); await shot('journey-days.html', '每日安排', '旅程');
  await page.getByRole('button', { name: '添加地点', exact: true }).click(); await shot('journey-stop.html', '添加地点表单', '旅程'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑旅程信息', exact: true }).click(); await shot('journey-options.html', '行程信息表单', '旅程'); await page.keyboard.press('Escape');
  await go('/journeys/' + journey.id + '/actual'); await shot('journey-actual.html', '实际行程记录', '旅程');
  await go('/journeys/' + journey.id + '/actual/map'); await page.locator('.map-page .editor-title').waitFor(); await shot('route-map.html', '路线地图与 GPX', '旅程');
  await go('/journeys/' + journey.id + '/share'); await page.locator('#share-title').waitFor(); await shot('share.html', '分享范围设置', '分享'); await page.getByRole('button', { name: '预览访客将看到的内容', exact: true }).click(); await page.locator('.share-preview').waitFor(); await shot('share-preview.html', '访客内容预览', '分享');
  await go('/memories'); await page.locator('.diary-card,.flow-card,.memory-card').first().waitFor(); await shot('memories.html', '图文回忆', '回忆');
  await go('/diaries/' + diary.id); await page.locator('.flow-journal').waitFor(); await shot('diary-read.html', '日记阅读', '回忆');
  await go('/diaries/' + diary.id + '/edit'); await page.locator('#diary-title').waitFor(); await shot('diary-edit.html', '编辑日记', '回忆');
  await go('/diaries/new'); await page.locator('#diary-title').waitFor(); await shot('diary-new.html', '新建日记', '回忆');
  await go('/me'); await page.locator('.atlas-profile-stats').waitFor(); await shot('profile.html', '我的旅行簿', '我的');
  await go('/wishes'); await shot('wishes.html', '我的心愿', '我的'); await go('/settings'); await page.locator('#profile-name').waitFor(); await shot('settings.html', '个人设置', '我的');
  assert.deepEqual(errors, []);
  const catalog = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>迹屿 · 页面目录</title><link rel="stylesheet" href="current/styles/prototype-base.css"><link rel="stylesheet" href="current/preview.css"></head><body class="prototype-catalog"><main><a href="index.html">← 返回足迹</a><p class="eyebrow">TRAVEL ATLAS / DESIGN REFERENCE</p><h1>把现在的迹屿，带回设计里</h1><p>当前网页的页面与样式快照。内容均为演示，地图为静态预览；不连接业务服务。</p>' + [...new Set(pages.map(p => p.group))].map(group => '<section><h2>' + group + '</h2><div class="prototype-page-grid">' + pages.filter(p => p.group === group).map(p => '<a href="' + p.file + '"><strong>' + p.title + '</strong><small>' + p.file + '</small><span>打开 →</span></a>').join('') + '</div></section>').join('') + '</main></body></html>';
  await writeFile(join(output, 'prototype-index.html'), catalog); await writeFile(join(output, 'current/manifest.json'), JSON.stringify({ exportedAt: new Date().toISOString(), projectId, sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim(), baseline, pages, data: 'disposable fixtures only', maps: 'local static regional previews and editable city SVG schematic' }, null, 2));
  console.log(JSON.stringify({ output, pages: pages.length + 1, errors, ownerBusinessData: 'untouched' }));
} catch (error) { await page?.screenshot({ path: join(output, '../export-failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally { await fixture.cleanup(); }
