import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, getTableName } from 'drizzle-orm';
import { browserFixture } from './browser-fixture.js';
import { config, projectRoot } from '../backend/src/config.js';
import { seedDemo } from './lib/demo-data.js';
import { amapFixture } from './lib/amap-fixture.js';
const fixture = await browserFixture({ routingWorker: false }), output = join(projectRoot, 'data/browser-mobile-layout-check'); await mkdir(output, { recursive: true });
const cases: string[] = [], errors: string[] = []; let page: any;
try {
  const [owner] = await fixture.database.db.select().from(fixture.database.schema.users).where(eq(fixture.database.schema.users.username, fixture.username));
  await seedDemo(fixture.database, { ...config, prefix: getTableName(fixture.database.schema.users).replace(/users$/, ''), mediaRoot: fixture.mediaRoot }, owner!.id, join(fixture.mediaRoot, 'demo.json'));
  const context = await fixture.browser.newContext({ viewport: { width: 393, height: 775 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, locale: 'zh-CN' });
  await context.addInitScript({ content: amapFixture }); page = await context.newPage(); page.on('pageerror', (e: Error) => errors.push(e.message));
  await page.goto(fixture.web); await page.locator('#username').fill(fixture.username); await page.locator('#password').fill(fixture.password); await page.getByRole('button', { name: '打开我的旅行簿', exact: true }).tap();
  await page.getByRole('combobox', { name: '足迹地区', exact: true }).selectOption('420000'); await page.getByRole('heading', { name: '湖北省', exact: true }).waitFor(); await page.locator('.atlas-region-name').first().waitFor();
  const audit = async (label: string, city = false) => { await page.waitForTimeout(250);
    const result = await page.evaluate(`(city => {
      const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const header = rect('.atlas-map-heading'), map = rect(city ? '.city-online-map' : '.atlas-reference-map'), source = rect(city ? '.city-layer-controls' : '.atlas-source'), summary = rect('.atlas-map-bottom'), drawer = rect('.atlas-memory'), nav = rect('.bottom-nav');
      const buttons = [...document.querySelectorAll('.atlas-map-tools>button')].map(b => { const r = b.getBoundingClientRect(); return { y: r.y, bottom: r.bottom, width: r.width, height: r.height, receivesPointer: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('button') === b, radius: getComputedStyle(b).borderRadius }; });
      return { header, map, source, summary, drawer, nav, buttons, overflow: document.documentElement.scrollWidth > innerWidth, viewportHeight: visualViewport?.height ?? innerHeight };
    })(${JSON.stringify(city)})`);

    assert.equal(result.overflow, false, label); assert.ok(result.header.bottom <= result.map.y + 1, label + ' heading'); assert.ok(result.map.bottom <= result.source.y + 1, label + ' map/source'); assert.ok(result.source.bottom <= result.summary.y + 1, label + ' source/summary'); assert.ok(result.summary.bottom <= result.drawer.y + 1, label + ' summary/drawer'); assert.ok(result.drawer.bottom <= result.nav.y + 1, label + ' drawer/nav'); assert.ok(result.nav.bottom <= result.viewportHeight + 1, label + ' viewport'); assert.ok(result.map.height >= 80, label + ' map height');
    assert.equal(result.buttons.length, 3); for (let i=0;i<3;i++) { const b=result.buttons[i]!; assert.equal(b.width,44); assert.equal(b.height,44); assert.equal(b.radius,'0px'); assert.equal(b.receivesPointer,true,label+' toolbar '+i); if(i) assert.ok(result.buttons[i-1]!.bottom<=b.y+.5,label+' separate toolbar buttons'); }
    await page.screenshot({ path: output+'/'+label+'.png' }); await writeFile(output+'/'+label+'.json',JSON.stringify(result,null,2)); cases.push(label);
  };
  for (const [width,height] of [[393,775],[393,660],[393,844],[360,740],[320,640],[393,560]]) { await page.setViewportSize({width,height}); await audit('province-'+width+'x'+height); }
  await page.setViewportSize({width:393,height:775}); await page.waitForTimeout(250); assert.equal(await page.locator('.atlas-region-name').filter({hasText:'武汉市'}).count(),0); assert.equal(await page.locator('.pin-label').filter({hasText:'武汉市'}).count(),1); cases.push('province-city-label-not-duplicated');
  const svg=page.getByRole('group',{name:'足迹地区地图',exact:true}); await page.getByRole('button',{name:'放大足迹地图',exact:true}).tap(); await page.waitForFunction(()=>Number(document.querySelector('[aria-label="足迹地区地图"]')?.getAttribute('data-zoom'))>1); await page.getByRole('button',{name:'缩小足迹地图',exact:true}).tap(); await page.getByRole('button',{name:'重置足迹地图',exact:true}).tap(); assert.equal(await svg.getAttribute('data-zoom'),'1.00'); cases.push('three-toolbar-actions-work-by-touch');
  const cdp=await context.newCDPSession(page), area=(await svg.boundingBox())!, cx=area.x+area.width*.38, cy=area.y+area.height*.5;
  const point=(x:number,id:number)=>({x,y:cy,id,radiusX:2,radiusY:2}); await page.waitForTimeout(350); const beforePinch=Number(await svg.getAttribute('data-zoom'));
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(cx-20,0),point(cx+20,1)]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(cx-20-i*4,0),point(cx+20+i*4,1)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction((z:number)=>Number(document.querySelector('[aria-label="足迹地区地图"]')?.getAttribute('data-zoom'))>z,beforePinch); cases.push('native-two-finger-pinch-zooms-reference-map');
  await page.getByRole('button',{name:'重置足迹地图',exact:true}).tap();
  await page.waitForTimeout(350); const pane=page.locator('.atlas-reference-map .leaflet-map-pane'), beforePan=await pane.getAttribute('style');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(cx,0)]});
  for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(cx+i*6,0)]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]}); await page.waitForTimeout(300);assert.notEqual(await pane.getAttribute('style'),beforePan);cases.push('native-single-finger-pan-moves-map-pane');
  await page.getByRole('button',{name:'重置足迹地图',exact:true}).tap();
  await page.locator('.atlas-drawer-toggle').tap(); await page.getByRole('button',{name:/武汉市.*4 条到访/}).tap(); await page.getByRole('button',{name:'进入城市地图',exact:true}).tap(); await page.locator('.city-footprint-canvas[data-points="3"]').waitFor();
  for (const [width,height] of [[393,775],[393,660],[320,640]]) { await page.setViewportSize({width,height}); await audit('city-'+width+'x'+height,true); }
  await page.getByRole('button',{name:'放大城市地图',exact:true}).tap(); await page.getByRole('button',{name:'缩小城市地图',exact:true}).tap(); await page.getByRole('button',{name:'查看全部城市足迹',exact:true}).tap(); cases.push('city-toolbar-actions-work-by-touch');
  await page.setViewportSize({width:1280,height:900}); await page.waitForTimeout(200); assert.equal(await page.locator('.atlas-memory').evaluate((e:HTMLElement)=>getComputedStyle(e).position),'relative'); await page.screenshot({path:output+'/desktop-city.png'}); cases.push('desktop-sidebar-remains-separate');
  assert.deepEqual(errors,[]); await writeFile(output+'/result.json',JSON.stringify({passed:true,cases,errors,scope:'Android Chromium touch emulation; viewport inferred from supplied screenshot, not physical Xiaomi hardware'},null,2)); console.log('手机布局验证通过：'+cases.length+' 组。');
} catch(e) { console.error(e); console.error({cases,errors}); await page?.screenshot({path:output+'/failure.png'}).catch(()=>{}); process.exitCode=1; }
finally { await fixture.cleanup(); }
