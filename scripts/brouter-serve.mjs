import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { parseEnv } from 'node:util';
const root = resolve(import.meta.dirname, '..'), env = { ...parseEnv(readFileSync(join(root, '.env'), 'utf8')), ...process.env };
const manifest = JSON.parse(readFileSync(resolve(root, env.BROUTER_MANIFEST || 'data/brouter/manifest.json'), 'utf8'));
if (manifest.version !== 1 || !/^data\/brouter\/versions\/[a-zA-Z0-9]+$/.test(manifest.directory)) throw new Error('Invalid BRouter manifest');
const directory = resolve(root, manifest.directory);
const child = spawn('java', ['-Xms32m', '-Xmx256m', '-XX:ActiveProcessorCount=1', '-DmaxRunningTime=30', '-DuseRFCMimeType=true', '-cp', join(directory, 'brouter.jar'), 'btools.server.RouteServer', join(directory, 'segments4'), join(directory, 'profiles2'), join(directory, 'customprofiles'), '17777', '1', '127.0.0.1'], { stdio: ['ignore', 'ignore', 'pipe'] });
// Upstream stdout includes full request coordinates. Suppress it instead of retaining private routing logs.
let reported = false; child.stderr.on('data', () => { if (!reported) { console.error('路由进程有诊断输出；未记录原始请求或坐标。'); reported = true; } });
child.on('error', () => { console.error('路由进程启动失败，请检查 Java 与本机安装。'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
console.log(`BRouter ${manifest.engineVersion}，回环 17777，单线程，最大堆 256MiB；数据块 ${Object.keys(manifest.tiles).join('、')}。`);
