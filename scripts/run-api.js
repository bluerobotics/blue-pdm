/**
 * Runs the REST API from its TypeScript sources for local development.
 *
 * The API validates `NODE_ENV` and defaults it to `production`, so that a
 * deployment which sets nothing gets the conservative behaviour rather than a
 * developer's. Development is therefore something you opt into, and this is
 * the opt-in: it is what makes the Vite dev server an allowed CORS origin and
 * the logs pretty-printed.
 *
 * It is a script rather than `NODE_ENV=development npx tsx …` inline in
 * package.json because that spelling is POSIX shell syntax. npm runs scripts
 * through cmd.exe on Windows, where it is a syntax error, and this repository
 * is developed on Windows.
 *
 * Usage: node scripts/run-api.js [--watch]
 */

const { spawn } = require('child_process');
const path = require('path');

// Resolved and run under `node` directly rather than through `npx tsx`. npx
// needs a shell on Windows, and spawning with `shell: true` both concatenates
// arguments without escaping them and prints a deprecation warning on every
// start.
let tsxCli;
try {
  const manifestPath = require.resolve('tsx/package.json');
  tsxCli = path.resolve(path.dirname(manifestPath), require(manifestPath).bin);
} catch {
  console.error('tsx is not installed. Run `npm install` first.');
  process.exit(1);
}

const watch = process.argv.includes('--watch');
const args = [tsxCli, ...(watch ? ['--watch'] : []), 'api/server.ts'];

const child = spawn(process.execPath, args, {
  stdio: 'inherit',
  cwd: path.join(__dirname, '..'),
  // An explicit NODE_ENV still wins, so `NODE_ENV=test node scripts/run-api.js`
  // does what it says.
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV || 'development' },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});

child.on('error', (error) => {
  console.error('Failed to start the API:', error.message);
  process.exit(1);
});
