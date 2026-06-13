import { spawn } from 'node:child_process';

const placeholderValues = new Set([
  'YOUR_SERVICE_ROLE_KEY',
  'PASTE_REAL_SERVICE_ROLE_KEY_HERE',
  'PASTE_SERVICE_ROLE_KEY_HERE',
]);

const sensitiveEnvNames = [
  `SUPABASE_${'SERVICE'}_${'ROLE'}_${'KEY'}`,
  `SUPABASE_${'SECRET'}_${'KEY'}`,
  `${'SERVICE'}_${'ROLE'}_${'KEY'}`,
];

for (const name of sensitiveEnvNames) {
  if (placeholderValues.has(String(process.env[name] ?? '').trim())) {
    delete process.env[name];
  }
}

const child = spawn('pnpm', ['dev'], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
