import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { buildApp } from './app.js';
const database = openDatabase(config); const app = await buildApp(config, database);
try { await database.pool.query('SELECT 1'); await app.listen({ host: config.host, port: config.port }); console.log(`迹屿 API 已启动：http://${config.host}:${config.port}`); }
catch { console.error('API 启动失败，请检查数据库迁移、配置或端口。'); await database.pool.end(); process.exitCode = 1; }
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); await database.pool.end(); process.exit(); });
