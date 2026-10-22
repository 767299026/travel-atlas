import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

let folder = dirname(fileURLToPath(import.meta.url));
while (!(existsSync(join(folder, 'package.json')) && JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')).name === 'travel-journal')) {
  const parent = dirname(folder); if (parent === folder) throw new Error('Project root not found'); folder = parent;
}
export const projectRoot = folder;
const file = existsSync(join(folder, '.env')) ? parseEnv(readFileSync(join(folder, '.env'), 'utf8')) : {};
const env = { ...file, ...process.env };
const required = (key: string) => { const value = env[key]; if (!value) throw new Error(`Missing configuration: ${key}`); return value; };
const positive = (key: string, fallback: number, maximum = Number.MAX_SAFE_INTEGER) => { const value = Number(env[key] || fallback); if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) throw new Error(`Invalid configuration: ${key}`); return value; };
export interface AppConfig {
  mysql: { host: string; port: number; database: string; user: string; password: string };
  host: string; port: number; origins: string[]; cookieSecure: boolean; prefix: string; loginRateMax: number;
  mediaRoot: string; mediaQuotaBytes: number; uploadMaxBytes: number;
  rateLimitMax?: number;
}
export const config: AppConfig = {
  mysql: { host: required('MYSQL_HOST'), port: Number(required('MYSQL_PORT')), database: required('MYSQL_DATABASE'), user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD') },
  host: env.API_HOST ?? '127.0.0.1', port: Number(env.API_PORT ?? 3080),
  origins: (env.APP_ORIGINS ?? 'http://127.0.0.1:5178,http://localhost:5178').split(',').map(x => x.trim()).filter(Boolean),
  cookieSecure: env.COOKIE_SECURE === 'true' || (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'false'),
  prefix: '', loginRateMax: 10,
  mediaRoot: resolve(projectRoot, env.MEDIA_ROOT || 'data/media'), mediaQuotaBytes: positive('MEDIA_QUOTA_BYTES', 1073741824), uploadMaxBytes: positive('UPLOAD_MAX_BYTES', 20971520, 52428800),
};
export const initialUser = { username: env.ADMIN_USERNAME ?? 'owner', password: env.ADMIN_PASSWORD };
