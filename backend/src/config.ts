import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';

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
  amap?: { jsKey: string; securityCode: string };
  routing?: { endpoint: string; engineVersion: string; profileSha256: string; dataVersion: string; tiles: string[] };
}
function routingConfig(): AppConfig['routing'] {
  if (env.BROUTER_ENABLED !== 'true') return undefined;
  const manifest = JSON.parse(readFileSync(resolve(projectRoot, env.BROUTER_MANIFEST || 'data/brouter/manifest.json'), 'utf8'));
  if (manifest.version !== 1 || !/^data\/brouter\/versions\/[a-zA-Z0-9]+$/.test(manifest.directory) || !/^[a-f0-9]{64}$/.test(manifest.profileSha256) || !/^[a-f0-9]{64}$/.test(manifest.dataVersion) || !/^\d+\.\d+\.\d+$/.test(manifest.engineVersion)) throw new Error('Invalid BRouter manifest');
  const tiles = Object.keys(manifest.tiles); if (!tiles.length || tiles.length > 8 || tiles.some(tile => !/^E\d{1,3}_N\d{1,2}$/.test(tile) || !existsSync(join(projectRoot, manifest.directory, 'segments4', tile + '.rd5')))) throw new Error('Routing dataset unavailable');
  const profile = readFileSync(join(projectRoot, manifest.directory, 'profiles2/hiking-mountain.brf'));
  if (createHash('sha256').update(profile).digest('hex') !== manifest.profileSha256) throw new Error('Routing profile changed; rebuild manifest');
  return { endpoint: 'http://127.0.0.1:17777/brouter', engineVersion: manifest.engineVersion, profileSha256: manifest.profileSha256, dataVersion: manifest.dataVersion, tiles };
}
export const config: AppConfig = {
  mysql: { host: required('MYSQL_HOST'), port: Number(required('MYSQL_PORT')), database: required('MYSQL_DATABASE'), user: required('MYSQL_USER'), password: required('MYSQL_PASSWORD') },
  host: env.API_HOST ?? '127.0.0.1', port: Number(env.API_PORT ?? 3080),
  origins: (env.APP_ORIGINS ?? 'http://127.0.0.1:5178,http://localhost:5178').split(',').map(x => x.trim()).filter(Boolean),
  cookieSecure: env.COOKIE_SECURE === 'true' || (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'false'),
  prefix: '', loginRateMax: 10,
  mediaRoot: resolve(projectRoot, env.MEDIA_ROOT || 'data/media'), mediaQuotaBytes: positive('MEDIA_QUOTA_BYTES', 1073741824), uploadMaxBytes: positive('UPLOAD_MAX_BYTES', 20971520, 52428800),
  amap: env.AMAP_JS_KEY && env.AMAP_JS_SECURITY_CODE ? { jsKey: env.AMAP_JS_KEY, securityCode: env.AMAP_JS_SECURITY_CODE } : undefined,
  routing: routingConfig(),
};
export const initialUser = { username: env.ADMIN_USERNAME ?? 'owner', password: env.ADMIN_PASSWORD };
