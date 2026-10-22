import { config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { mediaService } from '../media.js';
const database = openDatabase(config);
try { console.log(JSON.stringify(await mediaService(database, config).cleanup())); }
catch { console.error('媒体清理失败；未输出文件路径或私密配置。'); process.exitCode = 1; }
finally { await database.pool.end(); }
