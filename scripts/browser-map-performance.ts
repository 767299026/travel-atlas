import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { browserFixture } from './browser-fixture.js';
import { projectRoot } from '../backend/src/config.js';
const fixture=await browserFixture({routingWorker:false}),name=process.env.PERF_LABEL||'current',output=join(projectRoot,'data/map-performance');await mkdir(output,{recursive:true});
try{
 const context=await fixture.browser.newContext({viewport:{width:393,height:775},hasTouch:true,isMobile:true,locale:'zh-CN'}),page=await context.newPage();
 await page.goto(fixture.web);await page.locator('#username').fill(fixture.username);await page.locator('#password').fill(fixture.password);await page.getByRole('button',{name:'打开我的旅行簿',exact:true}).click();await page.locator('.map-region,.atlas-reference-map canvas').first().waitFor();
 const cdp=await context.newCDPSession(page);await cdp.send('Performance.enable');await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const results=[];
 for(const scope of (process.env.PERF_SCOPES||'100000,420000').split(',')){
  if(scope==='world')await page.getByRole('button',{name:'世界',exact:true}).click();else await page.getByRole('combobox',{name:'足迹地区',exact:true}).selectOption(scope);await page.waitForFunction(()=>!!document.querySelector('[aria-label="足迹地区地图"]'));await page.waitForTimeout(300);
  const svg=page.getByRole('group',{name:'足迹地区地图',exact:true}),box=(await svg.boundingBox())!;
  await page.evaluate(`(() => {const w=window;w.perfSample={frames:[],longTasks:[],pathWrites:0,last:0,active:true};w.perfObserver=new MutationObserver(rs=>w.perfSample.pathWrites+=rs.filter(r=>r.type==='attributes').length);w.perfObserver.observe(document.querySelector('[aria-label="足迹地区地图"]'),{attributes:true,attributeFilter:['d'],subtree:true});w.taskObserver=new PerformanceObserver(list=>w.perfSample.longTasks.push(...list.getEntries().map(e=>e.duration)));w.taskObserver.observe({type:'longtask'});function frame(t){const s=w.perfSample;if(!s.active)return;if(s.last)s.frames.push(t-s.last);s.last=t;requestAnimationFrame(frame);}requestAnimationFrame(frame);})()`);

  const before=(await cdp.send('Performance.getMetrics')).metrics;await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5);await page.mouse.down();
  for(let pass=0;pass<3;pass++){await page.mouse.move(box.x+box.width*.7,box.y+box.height*.58,{steps:40});await page.mouse.move(box.x+box.width*.4,box.y+box.height*.5,{steps:40});}
  await page.mouse.up();await page.waitForTimeout(100);const after=(await cdp.send('Performance.getMetrics')).metrics;
  const sample=await page.evaluate(()=>{const w=window as any,s=w.perfSample;s.active=false;w.perfObserver.disconnect();w.taskObserver.disconnect();const f=[...s.frames].sort((a:number,b:number)=>a-b);return{frames:f.length,medianFrameMs:f[Math.floor(f.length*.5)]??null,p95FrameMs:f[Math.floor(f.length*.95)]??null,framesOver25ms:f.filter((n:number)=>n>25).length,longTasks:s.longTasks.length,maxLongTaskMs:Math.max(0,...s.longTasks),pathWrites:s.pathWrites};});
  const delta=(metric:string)=>after.find((m:any)=>m.name===metric).value-before.find((m:any)=>m.name===metric).value;
  results.push({scope,...sample,scriptMs:Math.round(delta('ScriptDuration')*1000),taskMs:Math.round(delta('TaskDuration')*1000)});
  if(process.env.EXPECT_STATIC_PATHS==='true')assert.equal(sample.pathWrites,0,'map paths must remain unchanged during drag');
 }
 await writeFile(join(output,name+'.json'),JSON.stringify({name,cpuThrottle:4,viewport:'393x775',driver:'240 mouse moves per map; 100ms settle after input; headless Chromium, not physical high-refresh hardware',results},null,2));console.log(JSON.stringify({name,results}));
}finally{await fixture.cleanup();}
