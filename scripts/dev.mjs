// Mode développement : serveur Vite (rechargement à chaud de l'interface)
// + compilation continue du processus principal + relance d'Electron.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';

const builder = spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { stdio: 'inherit' });

let electron = null;
let restartTimer = null;
function startElectron() {
  const args = ['.'];
  if (process.platform === 'linux') args.push('--no-sandbox');
  electron = spawn(electronBinary, args, {
    stdio: 'inherit',
    env: { ...process.env, MBI_DEV_SERVER_URL: url },
  });
  electron.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM') shutdown(code ?? 0);
  });
}
function restartElectron() {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (electron) {
      electron.removeAllListeners('exit');
      electron.kill('SIGTERM');
    }
    startElectron();
  }, 400);
}
function shutdown(code) {
  builder.kill();
  server.close();
  process.exit(code);
}

setTimeout(startElectron, 1500);
watch('dist/main', restartElectron);
watch('dist/preload', restartElectron);
process.on('SIGINT', () => shutdown(0));
