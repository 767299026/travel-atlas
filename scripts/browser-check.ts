// Runs against isolated MySQL tables and a loopback-only Vue preview. No production fixtures are created.
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { config, projectRoot } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/client.js';
import { migrate, removeTestTables } from '../backend/src/db/migrate.js';
import { buildApp } from '../backend/src/app.js';
import { hashPassword } from '../backend/src/security.js';

const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', cookieSecure: false, loginRateMax: 100, origins: [...config.origins, 'http://127.0.0.1:5188'] };
const database = openDatabase(cfg), password = randomBytes(24).toString('base64url');
let app: Awaited<ReturnType<typeof buildApp>> | undefined, browser: any, preview: ReturnType<typeof spawn> | undefined;
const directory = join(projectRoot, 'data/browser-check'); mkdirSync(directory, { recursive: true, mode: 0o700 });
try {
  await migrate(database.pool, cfg.prefix);
  await database.db.insert(database.schema.users).values({ id: randomUUID(), username: 'browser-fixture', displayName: '浏览器验证', passwordHash: await hashPassword(password), createdAt: new Date() });
  app = await buildApp(cfg, database); await app.listen({ host: '127.0.0.1', port: 3090 });
  const vitePath = join(dirname(createRequire(join(projectRoot, 'frontend/package.json')).resolve('vite/package.json')), 'bin/vite.js');
  preview = spawn(process.execPath, [vitePath, 'preview', '--host', '127.0.0.1', '--port', '5188', '--strictPort'], { cwd: join(projectRoot, 'frontend'), stdio: 'ignore', env: { ...process.env, TRAVEL_API_TARGET: 'http://127.0.0.1:3090' } });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) { if (preview.exitCode !== null) throw new Error('Vue preview failed to start'); try { if ((await fetch('http://127.0.0.1:5188')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  if (!ready) throw new Error('Vue preview readiness timeout');
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' }); const page = await context.newPage(); const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.name));
  const login = async () => { await page.locator('#username').fill('browser-fixture'); await page.locator('#password').fill(password); await page.getByRole('button', { name: '打开我的旅行簿' }).click(); await page.getByRole('button', { name: '旅程', exact: true }).waitFor(); };
  await page.goto('http://127.0.0.1:5188'); await login();
  await page.getByRole('button', { name: '创建第一个行程' }).click();
  await page.locator('#title').fill('黄山与宏村 · 浏览器验证'); await page.locator('#origin').fill('杭州东站'); await page.locator('#destinations').fill('黄山、宏村'); await page.locator('#duration').fill('2');
  await page.getByRole('button', { name: '开始安排' }).click(); await page.getByRole('heading', { name: '黄山与宏村 · 浏览器验证' }).waitFor();
  const journeyURL = page.url();
  const add = async (label: string, note: string) => {
    await page.getByRole('button', { name: '添加地点', exact: true }).click(); await page.locator('#stop-name').fill(label); await page.locator('#stop-region').fill('安徽省黄山市'); await page.locator('#stop-time').fill('18:30'); await page.locator('#stop-note').fill(note); await page.locator('#stop-mode').selectOption('rail'); await page.getByRole('button', { name: '确认修改', exact: true }).click();
  };
  await add('同名酒店', '入住前电话确认'); await add('同名酒店', '另一家同名地点');
  assert.equal(await page.getByRole('button', { name: '编辑地点：同名酒店', exact: true }).count(), 2);
  await page.getByRole('button', { name: '同名酒店的更多操作', exact: true }).first().click(); await page.getByRole('button', { name: '移到另一天', exact: true }).click(); await page.getByRole('button', { name: '确认修改', exact: true }).click();
  await page.getByText('入住前电话确认', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存行程', exact: true }).click(); await page.getByText(/已保存到服务器 · 版本/).waitFor();
  await page.reload(); await page.getByRole('button', { name: /第 2 天/ }).click(); await page.getByText('入住前电话确认', { exact: true }).waitFor();
  // Native modal remains keyboard accessible and leaves controls reachable at 320px.
  await page.setViewportSize({ width: 320, height: 720 }); await page.getByRole('button', { name: '编辑地点：同名酒店', exact: true }).click();
  assert.ok(await page.getByRole('dialog', { name: '编辑地点' }).isVisible()); await page.keyboard.press('Escape'); assert.equal(await page.locator('dialog').count(), 0);
  assert.ok(await page.getByRole('button', { name: '编辑地点：同名酒店', exact: true }).evaluate((el: Element) => el === document.activeElement));
  const longName = '黄山风景区云谷寺至白鹅岭沿途非常长的待定位景点名称'.repeat(4);
  await add(longName, '窄屏与长内容验证');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(directory, 'mobile-320.png'), fullPage: true });
  // Simulate connection loss: do not claim a save, keep the same request key for retry.
  await page.route('**/api/v1/routes/*/commands', (request: any) => request.abort());
  await page.getByRole('button', { name: '保存行程', exact: true }).click(); await page.getByText(/连接失败，修改尚未保存到服务器/).waitFor();
  assert.ok(await page.getByText('修改尚未保存到服务器', { exact: true }).isVisible());
  await page.unroute('**/api/v1/routes/*/commands');
  await page.reload(); await page.getByRole('button', { name: /第 2 天/ }).click(); await page.getByText('窄屏与长内容验证', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存行程', exact: true }).click(); await page.getByText(/已保存到服务器 · 版本/).waitFor();
  // Local drafts survive leave/return; discarding remains an explicit action.
  await add('本机草稿地点', '尚未提交'); await page.getByRole('button', { name: '返回旅程列表', exact: true }).click(); await page.getByRole('button', { name: '保留草稿并离开' }).click();
  await page.goto(journeyURL); await page.getByRole('button', { name: /第 2 天/ }).click(); await page.getByText('尚未提交', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存行程', exact: true }).click(); await page.getByText(/已保存到服务器 · 版本/).waitFor();
  // A second context edits the same base version. The later browser keeps its pending draft.
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await context.storageState(), locale: 'zh-CN' }); const second = await secondContext.newPage();
  await second.goto(journeyURL); await second.getByRole('button', { name: '添加地点', exact: true }).click(); await second.locator('#stop-name').fill('并发草稿'); await second.getByRole('button', { name: '确认修改', exact: true }).click();
  await add('先保存的修改', '并发版本验证'); await page.getByRole('button', { name: '保存行程', exact: true }).click(); await page.getByText(/已保存到服务器 · 版本/).waitFor();
  await second.getByRole('button', { name: '保存行程', exact: true }).click(); await second.getByText('发现服务器版本更新', { exact: true }).waitFor(); assert.ok(await second.getByRole('button', { name: '编辑地点：并发草稿', exact: true }).isVisible());
  await second.screenshot({ path: join(directory, 'conflict-390.png'), fullPage: true }); await secondContext.close();
  await page.getByRole('button', { name: '返回旅程列表', exact: true }).click(); await page.getByRole('button', { name: '我的', exact: true }).click(); await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.locator('#username').waitFor(); await login(); await page.goto(journeyURL); await page.getByRole('button', { name: /第 2 天/ }).click(); await page.getByText('入住前电话确认', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 900 }); await page.screenshot({ path: join(directory, 'desktop.png'), fullPage: true });
  assert.deepEqual(errors, []); writeFileSync(join(directory, 'result.json'), JSON.stringify({ checkedAt: new Date().toISOString(), passed: true, cases: ['create', 'duplicate-place-names', 'cross-day-move', 'server-save-refresh', 'mobile-320-no-overflow', 'dialog-escape-focus', 'failed-save-and-draft-recovery', 'leave-keep-draft', 'concurrent-conflict', 'logout-login-restore'], pageErrors: errors }, null, 2));
  console.log('浏览器验证通过：10 组流程，桌面 / 320px / 390px；截图与结果在 data/browser-check。');
} catch (error) {
  if (browser) { const page = browser.contexts()[0]?.pages()[0]; if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error(error instanceof Error ? error.name + ': ' + error.message.replaceAll(password, '[redacted]') : 'Browser check failed'); process.exitCode = 1;
} finally { if (browser) await browser.close(); preview?.kill('SIGTERM'); if (app) await app.close(); await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); }
