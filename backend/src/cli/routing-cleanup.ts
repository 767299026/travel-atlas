import { config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { routingService } from '../routing.js';
const database = openDatabase(config);
try { console.log(JSON.stringify(await routingService(database, config).cleanup())); }
catch { console.error('任务历史清理失败；未输出私有内容。'); process.exitCode = 1; }
finally { await database.pool.end(); }
