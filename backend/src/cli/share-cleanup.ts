import { config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { shareService } from '../shares.js';
const database = openDatabase(config);
try { console.log(JSON.stringify(await shareService(database, config).cleanup())); }
catch { console.error('分享历史清理未完成，未输出凭据或私有数据。'); process.exitCode = 1; }
finally { await database.pool.end(); }
