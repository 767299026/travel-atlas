import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { config, projectRoot } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/client.js';
import { migrate, removeTestTables } from '../backend/src/db/migrate.js';
import { buildApp } from '../backend/src/app.js';
import { hashPassword } from '../backend/src/security.js';

export async function browserFixture() {
  const mediaRoot = await mkdtemp(join(tmpdir(), 'travel-browser-')), web = 'http://127.0.0.1:5189', admin = 'http://127.0.0.1:5191';
  const cfg = { ...config, prefix: 'tjt_' + randomBytes(4).toString('hex') + '_', mediaRoot, cookieSecure: false, loginRateMax: 100, rateLimitMax: 600, origins: [...config.origins, web, admin] };
  const database = openDatabase(cfg), username = 'browser-owner', password = randomBytes(24).toString('base64url'); let app: Awaited<ReturnType<typeof buildApp>> | undefined, browser: any;
  const children: ReturnType<typeof spawn>[] = [];
  const cleanup = async () => {
    if (browser) await browser.close(); for (const child of children) child.kill('SIGTERM'); if (app) await app.close();
    await removeTestTables(database.pool, cfg.prefix); await database.pool.end(); await rm(mediaRoot, { recursive: true, force: true });
  };
  try {
    await migrate(database.pool, cfg.prefix); await database.db.insert(database.schema.users).values({ id: randomUUID(), username, displayName: '浏览器验证', passwordHash: await hashPassword(password), createdAt: new Date() });
    app = await buildApp(cfg, database); await app.listen({ host: '127.0.0.1', port: 3091 });
    for (const [name, port] of [['frontend', 5189], ['admin', 5191]] as const) {
      const directory = join(projectRoot, name), cli = join(dirname(createRequire(join(directory, 'package.json')).resolve('vite/package.json')), 'bin/vite.js');
      const dist = name === 'frontend' ? process.env.FRONTEND_TEST_DIST : process.env.ADMIN_TEST_DIST;
      const child = spawn(process.execPath, [cli, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: directory, stdio: 'ignore', env: { ...process.env, TRAVEL_API_TARGET: 'http://127.0.0.1:3091', ...(dist ? { TRAVEL_DIST_DIR: dist } : {}) } }); children.push(child);
      let ready = false; for (let i = 0; i < 100; i++) { if (child.exitCode !== null) throw new Error(name + ' preview exited'); try { if ((await fetch('http://127.0.0.1:' + port)).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
      if (!ready) throw new Error(name + ' preview not ready');
    }
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright'); browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/google/chrome/chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    return { browser, database, password, username, web, admin, mediaRoot, cleanup };
  } catch (error) { await cleanup(); throw error; }
}
