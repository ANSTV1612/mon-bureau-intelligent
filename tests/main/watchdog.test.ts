import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startWatchdog, WATCHDOG_SOURCE, type Watchdog } from '../../src/main/watchdog';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let proc: ChildProcess | null = null;
let dog: Watchdog | null = null;

afterEach(() => {
  dog?.stop();
  proc?.kill();
});

describe('chien de garde du démarrage', () => {
  it('ne fait rien tant que le processus principal répond', async () => {
    proc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)']);
    const marker = path.join(os.tmpdir(), `mbi-wd-${Date.now()}-a`);
    dog = startWatchdog(
      { pid: proc.pid!, exe: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')`], timeoutMs: 2500, lifetimeMs: 30000 },
      process.execPath,
    );
    await sleep(4000);
    expect(proc.exitCode).toBeNull();
    expect(fs.existsSync(marker)).toBe(false);
  }, 10000);

  it("termine l'application figée (parent du canal de surveillance) puis la relance", async () => {
    // Topologie réelle : le processus figé est celui qui a lancé le chien de garde.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbi-wd-'));
    const marker = path.join(dir, 'relance.txt');
    const log = path.join(dir, 'chien.log');
    const sourceFile = path.join(dir, 'watchdog.js');
    fs.writeFileSync(sourceFile, WATCHDOG_SOURCE);
    const parentScript = `
      const { spawn } = require('child_process');
      const cfg = { pid: process.pid, exe: process.execPath, args: ['-e', "require('fs').writeFileSync(${JSON.stringify(marker).replace(/"/g, '\\"')}, 'relance')"], timeoutMs: 1500, lifetimeMs: 30000, logFile: ${JSON.stringify(log)} };
      const child = spawn(process.execPath, [${JSON.stringify(sourceFile)}], { env: { ...process.env, MBI_WATCHDOG: JSON.stringify(cfg) }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
      const beat = setInterval(() => child.connected && child.send('ok'), 300);
      setTimeout(() => { clearInterval(beat); for (;;) {} }, 1000); // puis le processus se fige
    `;
    proc = spawn(process.execPath, ['-e', parentScript]);
    const exited = new Promise<boolean>((resolve) => proc!.once('exit', () => resolve(true)));
    for (let i = 0; i < 60 && !fs.existsSync(marker); i++) await sleep(200);
    expect(await Promise.race([exited, sleep(2000).then(() => false)])).toBe(true);
    expect(fs.readFileSync(marker, 'utf8')).toBe('relance');
    const journal = fs.readFileSync(log, 'utf8');
    expect(journal).toMatch(/Aucun signal depuis/);
    expect(journal).toMatch(/Relance :/);
    fs.rmSync(dir, { recursive: true, force: true });
  }, 20000);
});
