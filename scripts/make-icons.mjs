// Génère les icônes et visuels de l'application à partir des logos de build/brand/ :
//   build/icon.ico (16 → 256 px), build/icon.png (512 px), resources/icon.ico, resources/icon.png,
//   resources/tray.ico et resources/tray.png (zone de notification),
//   build/installerSidebar.bmp et build/uninstallerSidebar.bmp (installeur NSIS).
// Outil nécessaire (une seule fois, les fichiers générés sont versionnés) : ImageMagick (`convert`).
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brand = (f) => path.join(root, 'build/brand', f);
const tmp = mkdtempSync(path.join(tmpdir(), 'mbi-icons-'));
const im = (...args) => execFileSync('convert', args);

// Logo « B » centré dans un carré transparent, avec une petite marge.
const square = path.join(tmp, 'b-square.png');
im(brand('bridgestone-b.png'), '-background', 'none', '-gravity', 'center', '-extent', '520x520', square);

function sizes(list, prefix) {
  return list.map((s) => {
    const file = path.join(tmp, `${prefix}-${s}.png`);
    im(square, '-resize', `${s}x${s}`, '-unsharp', '0x0.6', file);
    return file;
  });
}

mkdirSync(path.join(root, 'resources'), { recursive: true });
im(...sizes([16, 20, 24, 32, 40, 48, 64, 96, 128, 256], 'app'), path.join(root, 'build/icon.ico'));
im(square, '-resize', '512x512', path.join(root, 'build/icon.png'));
im(...sizes([16, 20, 24, 32, 40, 48], 'tray'), path.join(root, 'resources/tray.ico'));
im(square, '-resize', '32x32', path.join(root, 'resources/tray.png'));
copyFileSync(path.join(root, 'build/icon.ico'), path.join(root, 'resources/icon.ico'));
copyFileSync(path.join(root, 'build/icon.png'), path.join(root, 'resources/icon.png'));

// Bandeau latéral de l'installeur (164 × 314, BMP 24 bits exigé par NSIS).
const sidebar = path.join(root, 'build/installerSidebar.bmp');
im(
  '-size', '164x314', 'xc:white',
  '(', brand('bridgestone-b.png'), '-resize', '92x', ')', '-gravity', 'north', '-geometry', '+0+46', '-composite',
  '(', brand('bridgestone-wordmark.png'), '-resize', '136x', ')', '-gravity', 'north', '-geometry', '+0+152', '-composite',
  '-font', 'DejaVu-Sans-Bold', '-pointsize', '12', '-fill', '#231815', '-gravity', 'north', '-annotate', '+0+190', 'Mon Bureau Intelligent',
  '-font', 'DejaVu-Sans', '-pointsize', '10', '-fill', '#6b6b6b', '-annotate', '+0+208', 'Outil interne',
  '-fill', '#e60012', '-draw', 'rectangle 0,306 164,314',
  '-type', 'TrueColor', `BMP3:${sidebar}`,
);
copyFileSync(sidebar, path.join(root, 'build/uninstallerSidebar.bmp'));

rmSync(tmp, { recursive: true, force: true });
console.log('Icônes et visuels générés.');
