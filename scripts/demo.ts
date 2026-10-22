import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { config, initialUser, projectRoot } from '../backend/src/config.js';
import { openDatabase } from '../backend/src/db/client.js';
import { seedDemo, cleanDemo } from './lib/demo-data.js';
const mode = process.argv[2] ?? 'status';
if (!['seed', 'cleanup', 'status'].includes(mode)) throw Error('用法：npm run demo -- seed|cleanup|status');
const directory = join(projectRoot, 'data/demo'), manifestPath = join(directory, 'map-review-v1.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
let current: any; try { current = JSON.parse(await readFile(manifestPath, 'utf8')); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
if (mode === 'status') { console.log(JSON.stringify({ present: !!current, complete: current?.complete ?? false, cleaned: current?.cleaned ?? false })); }
else {
  const lock = manifestPath + '.lock'; await mkdir(lock, { mode: 0o700 }); const database = openDatabase(config);
  try {
    if (mode === 'seed' && current?.cleaned) throw Error('原演示清单已清理，重新生成前请先归档该清单。');
    if (mode === 'cleanup' && !current) throw Error('没有演示清单。');
    const [owner] = await database.db.select().from(database.schema.users).where(eq(database.schema.users.username, initialUser.username));
    if (!owner || !owner.active || current && current.ownerId !== owner.id) throw Error('本人账号与清单不一致。');
    if (!(mode === 'seed' && current?.complete) && !(mode === 'cleanup' && current?.cleaned)) {
      try { execFileSync(process.execPath, ['--import', 'tsx', 'backend/src/cli/backup.ts'], { cwd: projectRoot, stdio: 'pipe' }); } catch { throw Error('备份失败，未执行演示数据写入。'); }
      console.log('正式库 SQL 备份完成；未输出配置或凭据。');
    }
    const result = mode === 'seed' ? await seedDemo(database, config, owner.id, manifestPath) : await cleanDemo(database, config, manifestPath);
    console.log(JSON.stringify({ action: mode, complete: (result as any).complete, removedJourneys: (result as any).removedJourneys, manifest: 'data/demo/map-review-v1.json' }));
  } catch (e) { console.error(e instanceof Error && !('sql' in e) ? e.message : '演示数据操作失败，进度清单已保留。'); process.exitCode = 1; }
  finally { await database.pool.end(); await rm(lock, { recursive: true }); }
}
