import { config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { migrate } from '../db/migrate.js';
const database = openDatabase(config);
try { await migrate(database.pool); console.log('数据库迁移完成。'); }
catch { console.error('数据库迁移失败；请检查连接与迁移记录。未输出连接参数。'); process.exitCode = 1; }
finally { await database.pool.end(); }
