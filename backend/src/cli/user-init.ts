import { randomUUID, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { config, initialUser, projectRoot } from '../config.js';
import { openDatabase } from '../db/client.js';
import { hashPassword } from '../security.js';
const database = openDatabase(config); const { users } = database.schema;
try {
  const existing = await database.db.select({ id: users.id }).from(users).limit(1);
  if (existing.length) console.log('已有账号，未重置密码。');
  else {
    const password = initialUser.password || randomBytes(24).toString('base64url');
    if (password.length < 12 || password.length > 128 || !/^[a-zA-Z0-9_.-]{1,64}$/.test(initialUser.username)) throw new Error('Invalid initial account configuration');
    if (!initialUser.password) {
      appendFileSync(join(projectRoot, '.env'), `\n# Website login; independent of MySQL credentials\nADMIN_USERNAME=${initialUser.username}\nADMIN_PASSWORD=${password}\n`, { mode: 0o600 }); chmodSync(join(projectRoot, '.env'), 0o600);
    }
    await database.db.insert(users).values({ id: randomUUID(), username: initialUser.username, displayName: '我的旅行', passwordHash: await hashPassword(password), createdAt: new Date() });
    console.log('初始网站账号已创建；登录配置见项目 .env 的 ADMIN_USERNAME / ADMIN_PASSWORD。');
  }
} catch { console.error('账号初始化失败；请检查配置及数据库迁移。'); process.exitCode = 1; }
finally { await database.pool.end(); }
