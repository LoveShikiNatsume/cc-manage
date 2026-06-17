import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }

      const err = new Error(`${command} ${args.join(' ')} exited with ${code}`);
      err.exitCode = code ?? 1;
      reject(err);
    });
  });
}

let exitCode = 0;

try {
  await run(npm, ['run', 'build']);
  await run(npx, ['electron-rebuild', '-f', '-w', 'better-sqlite3']);
  await run(npx, ['electron', 'dist/electron/main.js']);
} catch (err) {
  exitCode = typeof err?.exitCode === 'number' ? err.exitCode : 1;
} finally {
  try {
    await run(npm, ['rebuild', 'better-sqlite3']);
  } catch (err) {
    exitCode = exitCode || (typeof err?.exitCode === 'number' ? err.exitCode : 1);
  }
}

process.exit(exitCode);
