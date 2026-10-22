import { spawn } from 'node:child_process';

const children = [
  spawn('npm', ['run', 'dev:api'], { stdio: 'inherit', detached: process.platform !== 'win32' }),
  spawn('npm', ['run', 'dev:web'], { stdio: 'inherit', detached: process.platform !== 'win32' }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try { if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch {}
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => { if (!stopping) { stop(); process.exitCode = code ?? 1; } });
