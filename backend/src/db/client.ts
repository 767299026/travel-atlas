import mysql from 'mysql2/promise';
import type { PoolConnection } from 'mysql2';
import { drizzle } from 'drizzle-orm/mysql2';
import { buildSchema } from './schema.js';
import type { AppConfig } from '../config.js';

export function openDatabase(config: AppConfig) {
  const pool = mysql.createPool({ ...config.mysql, charset: 'utf8mb4', timezone: 'Z', connectionLimit: 4, waitForConnections: true, multipleStatements: false, enableKeepAlive: true });
  pool.pool.on('connection', (connection: PoolConnection) => { connection.query("SET time_zone = '+00:00'", error => { if (error) connection.destroy(); }); });
  const schema = buildSchema(config.prefix);
  const db = drizzle(pool, { schema, mode: 'default' });
  return { pool, db, schema };
}
export type Database = ReturnType<typeof openDatabase>;
export type DbExecutor = Pick<Database['db'], 'select' | 'insert' | 'update' | 'delete'>;
