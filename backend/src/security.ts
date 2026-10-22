import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';

const settings = { N: 65536, r: 8, p: 2, maxmem: 128 * 1024 * 1024 };
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => scryptCallback(password, salt, 64, settings, (error, result) => error ? reject(error) : resolve(result)));
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex'); const key = await derive(password, salt);
  return `scrypt$65536$8$2$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, salt, hex] = encoded.split('$');
  if (algorithm !== 'scrypt' || n !== '65536' || r !== '8' || p !== '2' || !salt || !hex || !/^[a-f0-9]{128}$/.test(hex)) return false;
  const key = await derive(password, salt); return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
let dummy: Promise<string> | undefined;
export const dummyHash = () => dummy ??= hashPassword('not-an-actual-account-password');
