import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, mkdtemp, open, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config, projectRoot } from '../config.js';

// Credentials travel through a private options file, never argv or logs.
const quote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
const folder = join(projectRoot, 'data/backups');
const temporary = await mkdtemp(join(tmpdir(), 'atlas-backup-'));
const output = join(folder, new Date().toISOString().replace(/[:.]/g, '-') + '.sql');
let descriptor: number | undefined;
try {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const options = join(temporary, 'mysql.cnf');
  await writeFile(options, '[client]\n' + Object.entries({ host: config.mysql.host, port: String(config.mysql.port), user: config.mysql.user, password: config.mysql.password }).map(([key, value]) => key + '=' + quote(value)).join('\n') + '\n', { mode: 0o600 });
  descriptor = openSync(output, 'wx', 0o600);
  await new Promise<void>((resolve, reject) => {
    const child = spawn('mysqldump', ['--defaults-extra-file=' + options, '--single-transaction', '--no-tablespaces', '--column-statistics=0', '--set-gtid-purged=OFF', '--default-character-set=utf8mb4', '--', config.mysql.database], { stdio: ['ignore', descriptor!, 'ignore'] });
    child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error('Backup failed')));
  });
  closeSync(descriptor); descriptor = undefined;
  const size = (await stat(output)).size;
  const handle = await open(output, 'r'); const tail = Buffer.alloc(Math.min(size, 2048));
  try { await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length)); } finally { await handle.close(); }
  if (!size || !tail.toString('utf8').trimEnd().split('\n').at(-1)?.startsWith('-- Dump completed on')) throw new Error('Incomplete backup');
  console.log(`数据库备份完成：${output}（${size} 字节，权限 600）。图片文件需另行备份；本命令未执行恢复验证。`);
} catch {
  if (descriptor !== undefined) closeSync(descriptor);
  await rm(output, { force: true });
  console.error('数据库备份失败；未输出凭据或数据库错误正文。'); process.exitCode = 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
