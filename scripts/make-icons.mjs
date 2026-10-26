// Génère les icônes de l'application à partir des SVG de build/ :
//   build/icon.png (512 px), build/icon.ico (16 → 256 px), resources/icon.png, resources/icon.ico,
//   resources/tray.ico et resources/tray.png (zone de notification).
// Outils nécessaires (une seule fois, les fichiers générés sont versionnés) :
//   - Playwright avec Chromium (rendu des SVG)  - ImageMagick (`convert`, assemblage .ico)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const full = readFileSync(path.join(root, 'build/icon.svg'), 'utf8');
const small = readFileSync(path.join(root, 'build/icon-small.svg'), 'utf8');
const tmp = mkdtempSync(path.join(tmpdir(), 'mbi-icons-'));

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size, file) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  return file;
}

const appSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const appPngs = [];
for (const s of appSizes) appPngs.push(await render(s <= 32 ? small : full, s, path.join(tmp, `app-${s}.png`)));
await render(full, 512, path.join(root, 'build/icon.png'));
const trayPngs = [];
for (const s of [16, 20, 24, 32, 40, 48]) trayPngs.push(await render(small, s, path.join(tmp, `tray-${s}.png`)));
await render(small, 32, path.join(root, 'resources/tray.png'));
await browser.close();

mkdirSync(path.join(root, 'resources'), { recursive: true });
execFileSync('convert', [...appPngs, path.join(root, 'build/icon.ico')]);
execFileSync('convert', [...trayPngs, path.join(root, 'resources/tray.ico')]);
copyFileSync(path.join(root, 'build/icon.ico'), path.join(root, 'resources/icon.ico'));
copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'resources/icon.png'));
rmSync(tmp, { recursive: true, force: true });
console.log('Icônes générées.');
