// Vérifie les fichiers produits par `npm run dist:win` :
// présence et taille des .exe, en-têtes PE (Windows x64), contenu de l'application empaquetée,
// binaire natif Koffi pour Windows, icônes, puis affiche les sommes SHA-256.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const release = path.join(root, 'release');
let failed = 0;

function ok(label) {
  console.log(`  ✔ ${label}`);
}
function ko(label) {
  failed += 1;
  console.log(`  ✘ ${label}`);
}
function check(cond, label) {
  if (cond) ok(label);
  else ko(label);
}

/** Lit l'en-tête PE : signature, architecture, sous-système. */
function peInfo(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4096);
  fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  if (head.toString('ascii', 0, 2) !== 'MZ') return null;
  const peOffset = head.readUInt32LE(0x3c);
  if (head.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null;
  const machine = head.readUInt16LE(peOffset + 4);
  const optional = peOffset + 24;
  const magic = head.readUInt16LE(optional);
  const subsystem = head.readUInt16LE(optional + 68);
  return { machine, magic, subsystem };
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} Mo`;

console.log(`\nVérification des livrables Windows — version ${version}\n`);

const setup = path.join(release, `MonBureauIntelligent-Setup-${version}.exe`);
const portable = path.join(release, `MonBureauIntelligent-Portable-${version}.exe`);
const unpacked = path.join(release, 'win-unpacked');
const appExe = path.join(unpacked, 'MonBureauIntelligent.exe');

for (const [label, file] of [
  ['Installeur', setup],
  ['Portable', portable],
  ['Exécutable principal (win-unpacked)', appExe],
]) {
  if (!fs.existsSync(file)) {
    ko(`${label} absent : ${path.relative(root, file)}`);
    continue;
  }
  const size = fs.statSync(file).size;
  const pe = peInfo(file);
  check(!!pe, `${label} : exécutable Windows valide (${mb(size)})`);
  if (pe && file === appExe) {
    check(pe.machine === 0x8664 && pe.magic === 0x20b, `${label} : architecture x64 (PE32+)`);
    check(pe.subsystem === 2, `${label} : application graphique Windows (pas de console)`);
  }
  if (pe && file !== appExe) {
    const content = fs.readFileSync(file);
    check(content.includes(Buffer.from('Nullsoft')), `${label} : programme d'installation NSIS`);
  }
}

const resources = path.join(unpacked, 'resources');
check(fs.existsSync(path.join(resources, 'app.asar')), 'Archive de l’application (app.asar)');
check(
  fs.existsSync(path.join(resources, 'app.asar.unpacked/node_modules/koffi/build/koffi/win32_x64/koffi.node')),
  'Module natif Koffi Windows x64 extrait (intégration bureau Win32)',
);
for (const f of ['icon.ico', 'tray.ico', 'icon.png']) check(fs.existsSync(path.join(resources, 'assets', f)), `Icône ${f}`);

try {
  const asar = require('@electron/asar');
  const files = asar.listPackage(path.join(resources, 'app.asar'), {}).map((f) => f.replace(/\\/g, '/'));
  for (const f of ['/dist/main/index.cjs', '/dist/preload/index.cjs', '/dist/renderer/index.html', '/package.json']) {
    check(files.includes(f), `Contenu de l'archive : ${f}`);
  }
  check(!files.some((f) => f.includes('/node_modules/react')), 'React intégré au bundle (aucun module superflu)');
  check(!files.some((f) => f.includes('/koffi/build/koffi/linux_')), 'Binaires Koffi des autres plateformes exclus');
} catch (err) {
  ko(`Lecture de app.asar impossible : ${err.message}`);
}

if (fs.existsSync(setup) && fs.existsSync(portable)) {
  console.log('\nSommes de contrôle SHA-256 :');
  for (const f of [setup, portable]) console.log(`  ${sha256(f)}  ${path.basename(f)}`);
}

console.log(failed ? `\n${failed} vérification(s) en échec.\n` : '\nToutes les vérifications sont passées.\n');
process.exit(failed ? 1 : 0);
