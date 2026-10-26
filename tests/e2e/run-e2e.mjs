// Test de bout en bout : lance la vraie application Electron et la pilote avec Playwright.
// Usage : npm run test:e2e   (sous Linux, un écran virtuel Xvfb est utilisé automatiquement)
// Prérequis : Playwright installé (npm i -D playwright), application compilée (npm run build).
// Captures d'écran enregistrées dans docs/captures/.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (process.platform === 'linux' && !process.env.DISPLAY) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1920x1080x24', process.execPath, fileURLToPath(import.meta.url)], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright');
const electronPath = createRequire(path.join(root, 'package.json'))('electron');

const shots = path.join(root, 'docs/captures');
fs.mkdirSync(shots, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mbi-e2e-'));
const results = [];
let failures = 0;

async function check(name, fn) {
  try {
    await fn();
    results.push(`  ✔ ${name}`);
  } catch (err) {
    failures += 1;
    results.push(`  ✘ ${name}\n      ${String(err?.message ?? err).split('\n')[0]}`);
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [root, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
    env: { ...process.env, MBI_USER_DATA_DIR: userData, NODE_ENV: 'production' },
    timeout: 60_000,
  });
  return app;
}

async function windowsInfo(app) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      id: w.id,
      title: w.getTitle(),
      url: w.webContents.getURL(),
      visible: w.isVisible(),
      onTop: w.isAlwaysOnTop(),
      bounds: w.getBounds(),
    })),
  );
}

async function pageFor(app, hashPart, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const page = app.windows().find((p) => p.url().includes(`#/${hashPart}`));
    if (page) {
      await page.waitForLoadState('domcontentloaded');
      return page;
    }
    await sleep(200);
  }
  throw new Error(`Fenêtre ${hashPart} introuvable`);
}

async function snapshot(page) {
  return page.evaluate(() => window.mbi.getSnapshot());
}

// ---------------------------------------------------------------------------- 1er lancement
let app = await launch();
const dash = await pageFor(app, 'dashboard');
await dash.waitForSelector('.page-head h1');
await sleep(1500);

await check('Premier lancement : tableau de bord + 4 widgets par défaut, en fenêtres natives séparées', async () => {
  const wins = await windowsInfo(app);
  const widgets = wins.filter((w) => w.url.includes('#/widget/')).map((w) => w.url.split('#/widget/')[1]);
  for (const t of ['today', 'priorities', 'notes', 'progress']) assert(widgets.includes(t), `widget ${t} absent (${widgets})`);
  assert(wins.some((w) => w.url.includes('#/dashboard') && w.visible), 'tableau de bord non visible');
});

await check('Interface en français', async () => {
  const text = await dash.textContent('.sidebar');
  assert(text.includes("Vue d'ensemble") && text.includes('Paramètres'), text);
});

await check('Saisie rapide en langage naturel depuis le tableau de bord', async () => {
  const input = dash.locator('.big-add input');
  await input.fill('Appeler Paul demain 14h #Travail !urgent');
  await dash.waitForSelector('.big-add .parse-preview .chip');
  await input.press('Enter');
  await dash.waitForFunction(() => document.querySelector('.sidebar')?.textContent?.includes('Travail'));
  const snap = await snapshot(dash);
  const t = snap.tasks.find((x) => x.title === 'Appeler Paul');
  assert(t, 'tâche non créée');
  assert(t.priority === 'urgent' && t.dueTime === '14:00' && t.projectId, JSON.stringify(t));
  assert(t.reminders.length === 1 && t.reminders[0].offsetMinutes === 15, 'rappel par défaut manquant');
});

const today = await dash.evaluate(() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
});

await check('Création depuis le widget « Aujourd’hui » (fenêtre widget)', async () => {
  const w = await pageFor(app, 'widget/today');
  await w.waitForSelector('.widget-footer input');
  await w.fill('.widget-footer input', 'Acheter du pain');
  await w.press('.widget-footer input', 'Enter');
  await w.waitForSelector('.task-item:has-text("Acheter du pain")');
  const t = (await snapshot(w)).tasks.find((x) => x.title === 'Acheter du pain');
  assert(t?.dueDate === today, `date ${t?.dueDate} ≠ ${today}`);
});

await check('Les autres fenêtres sont mises à jour en temps réel', async () => {
  await dash.click('.nav-item:has-text("Tâches")');
  await dash.waitForSelector('.list-card .task-item:has-text("Acheter du pain")');
});

await check('Éditeur : validation (titre obligatoire) en français', async () => {
  await dash.click('.titlebar .btn-primary');
  await dash.waitForSelector('.modal');
  await dash.click('.modal-footer .btn-primary');
  await dash.waitForSelector('.modal .field-error');
  const err = await dash.textContent('.modal .field-error');
  assert(err.includes('Le titre est obligatoire'), err);
});

await check('Éditeur : création complète (description, date, heure, priorité, statut, rappel)', async () => {
  await dash.fill('.modal .editor-title', 'Préparer la réunion budget');
  await dash.fill('.modal textarea', 'Slides + chiffres T3');
  await dash.click('.modal .chip:has-text("Demain")');
  await dash.fill('.modal input[type="time"]', '09:30');
  await dash.click('.modal .segmented button:has-text("Élevée")');
  await dash.click('.modal .segmented button:has-text("En cours")');
  await dash.selectOption('.modal .reminder-list select', '60');
  await dash.click('.modal-footer .btn-primary');
  await dash.waitForSelector('.modal', { state: 'detached' });
  const t = (await snapshot(dash)).tasks.find((x) => x.title === 'Préparer la réunion budget');
  assert(t && t.priority === 'high' && t.status === 'in_progress' && t.dueTime === '09:30' && t.description === 'Slides + chiffres T3', JSON.stringify(t));
  assert(t.reminders.some((r) => r.offsetMinutes === 60), 'rappel 1 h absent');
});

await check('Recherche et filtres', async () => {
  await dash.fill('.global-search input', 'reunion');
  await dash.waitForFunction(() => document.querySelectorAll('.list-card .task-item').length === 1);
  await dash.fill('.global-search input', '');
});

await check('Terminer une tâche depuis le widget (case à cocher animée)', async () => {
  const w = await pageFor(app, 'widget/today');
  await w.click('.task-item:has-text("Acheter du pain") .check');
  await dash.waitForFunction(async () => {
    const s = await window.mbi.getSnapshot();
    return s.tasks.find((t) => t.title === 'Acheter du pain')?.status === 'done';
  });
});

await check('Notes rapides : enregistrement automatique depuis le widget', async () => {
  const w = await pageFor(app, 'widget/notes');
  await w.click('.empty, .note-area');
  await w.waitForSelector('.note-area');
  await w.fill('.note-area', 'Idées :\n- appeler le plombier\n- réserver le resto');
  await sleep(900);
  const notes = (await snapshot(w)).notes;
  assert(notes.length === 1 && notes[0].content.includes('plombier'), JSON.stringify(notes));
});

await check('Affichage / masquage individuel des widgets', async () => {
  await dash.evaluate(() => window.mbi.widgets.setVisible('upcoming', true));
  await dash.evaluate(() => window.mbi.widgets.setVisible('tasks', true));
  await dash.evaluate(() => window.mbi.widgets.setVisible('projects', true));
  await dash.evaluate(() => window.mbi.widgets.setVisible('reminders', true));
  await pageFor(app, 'widget/upcoming');
  await pageFor(app, 'widget/reminders');
  await dash.evaluate(() => window.mbi.widgets.setVisible('reminders', false));
  await sleep(600);
  const wins = await windowsInfo(app);
  assert(!wins.some((w) => w.url.includes('#/widget/reminders')), 'widget rappels toujours ouvert');
  assert(wins.some((w) => w.url.includes('#/widget/upcoming')), 'widget à venir absent');
});

await check('Option « Toujours au premier plan » par widget', async () => {
  await dash.evaluate(() => window.mbi.widgets.setAlwaysOnTop('priorities', true));
  await sleep(300);
  const w = (await windowsInfo(app)).find((x) => x.url.includes('#/widget/priorities'));
  assert(w.onTop, 'pas au premier plan');
});

await check('Déplacement d’un widget mémorisé (position/taille)', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#/widget/progress'));
    w.setBounds({ x: 420, y: 300, width: 330, height: 260 });
  });
  await sleep(1200);
  const s = (await snapshot(dash)).widgets.find((x) => x.type === 'progress');
  assert(s.x === 420 && s.y === 300 && s.width === 330, JSON.stringify(s));
});

await check('Aimantation d’un widget au bord de l’écran', async () => {
  const wa = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
  await app.evaluate(({ BrowserWindow }, x) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#/widget/notes'));
    const b = w.getBounds();
    w.setBounds({ ...b, x, y: 500 });
  }, wa.x + 11);
  await sleep(1200);
  const b = (await windowsInfo(app)).find((w) => w.url.includes('#/widget/notes')).bounds;
  assert(b.x === wa.x, `x=${b.x}, attendu ${wa.x}`);
});

const hasXdotool = process.platform === 'linux' && spawnSync('which', ['xdotool']).status === 0;
if (hasXdotool) {
  await check('Redimensionnement d’un widget à la souris (poignée en bas à droite)', async () => {
    const w = await pageFor(app, 'widget/upcoming');
    const before = (await windowsInfo(app)).find((x) => x.url.includes('#/widget/upcoming')).bounds;
    const sx = before.x + before.width - 8;
    const sy = before.y + before.height - 8;
    spawnSync('xdotool', ['mousemove', String(sx), String(sy)]);
    await w.evaluate(() => window.mbi.widgets.resizeStart('se'));
    spawnSync('xdotool', ['mousemove', String(sx + 70), String(sy + 50)]);
    await w.evaluate(() => window.mbi.widgets.resizeMove());
    await w.evaluate(() => window.mbi.widgets.resizeEnd());
    await sleep(500);
    const after = (await windowsInfo(app)).find((x) => x.url.includes('#/widget/upcoming')).bounds;
    assert(after.width === before.width + 70 && after.height === before.height + 50, `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const saved = (await snapshot(dash)).widgets.find((x) => x.type === 'upcoming');
    assert(saved.width === after.width && saved.height === after.height, 'taille non enregistrée');
  });
}

await check('Menus contextuels natifs (tâche, options du widget)', async () => {
  const w = await pageFor(app, 'widget/priorities');
  const id = (await snapshot(w)).tasks.find((t) => t.title === 'Appeler Paul').id;
  await w.evaluate((id) => window.mbi.tasks.contextMenu(id), id);
  await sleep(400);
  if (hasXdotool) spawnSync('xdotool', ['key', 'Escape']);
  await w.evaluate(() => window.mbi.widgets.menu());
  await sleep(400);
  if (hasXdotool) spawnSync('xdotool', ['key', 'Escape']);
  await sleep(200);
});

await check('Stress : ouvertures/fermetures rapides de widgets pendant des mises à jour', async () => {
  for (let i = 0; i < 25; i++) {
    await dash.evaluate(async (i) => {
      const p = [window.mbi.widgets.setVisible('reminders', i % 2 === 0), window.mbi.widgets.setVisible('projects', i % 2 === 1)];
      for (let k = 0; k < 4; k++) p.push(window.mbi.settings.update({ upcomingDays: 5 + (k % 2) * 2 }));
      await Promise.all(p);
    }, i);
    await sleep(15 + (i % 5) * 12);
  }
  await dash.evaluate(() => Promise.all([window.mbi.widgets.setVisible('projects', true), window.mbi.widgets.setVisible('reminders', false)]));
  await sleep(800);
  const log = fs.readFileSync(path.join(userData, 'journaux', 'main.log'), 'utf8');
  assert(!log.includes('[ERROR]'), log.split('\n').filter((l) => l.includes('[ERROR]'))[0]);
});

await check('Saisie rapide globale (fenêtre flottante)', async () => {
  await dash.evaluate(() => window.mbi.app.openQuickAdd());
  const qa = await pageFor(app, 'quick-add');
  await qa.waitForSelector('.qa-input');
  await sleep(300);
  await qa.fill('.qa-input', 'Payer le loyer le 5 #Maison !haute');
  await qa.press('.qa-input', 'Enter');
  await dash.waitForFunction(async () => (await window.mbi.getSnapshot()).tasks.some((t) => t.title === 'Payer le loyer'));
});

await check('Rappel : fenêtre de rappel affichée à l’échéance', async () => {
  const at = await dash.evaluate(() => {
    const d = new Date(Date.now() - 30_000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  });
  const r = await dash.evaluate((at) => window.mbi.tasks.create({ title: 'Sortir le linge', reminders: [{ type: 'absolute', at }] }), at);
  assert(r.ok, JSON.stringify(r));
  const popup = await pageFor(app, 'reminders', 10_000);
  await popup.waitForSelector('.rp-card:has-text("Sortir le linge")', { timeout: 10_000 });
});

await check('Paramètres : thème sombre appliqué à toutes les fenêtres', async () => {
  await dash.evaluate(() => window.mbi.settings.update({ theme: 'dark' }));
  const w = await pageFor(app, 'widget/today');
  await w.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await dash.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
});

await check('Paramètres : valeurs invalides refusées', async () => {
  const r = await dash.evaluate(() => window.mbi.settings.update({ accentColor: 'rouge' }));
  assert(!r.ok, 'couleur invalide acceptée');
});

// ---------------------------------------------------------------------------- Captures d'écran
async function shoot(hash, file, opts = {}) {
  const p = await pageFor(app, hash);
  await sleep(250);
  await p.screenshot({ path: path.join(shots, file), omitBackground: true, ...opts });
}
try {
  await dash.evaluate(() => window.mbi.settings.update({ theme: 'light' }));
  await dash.setViewportSize({ width: 1280, height: 800 }).catch(() => undefined);
  await app.evaluate(({ BrowserWindow }) => {
    const d = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('#/dashboard'));
    d.setBounds({ x: 40, y: 40, width: 1280, height: 800 });
  });
  await dash.click('.nav-item:has-text("Vue d\'ensemble")');
  await sleep(700);
  await shoot('dashboard', 'tableau-de-bord-clair.png');
  await dash.click('.nav-item:has-text("Tâches")');
  await sleep(400);
  await shoot('dashboard', 'taches-liste.png');
  await dash.click('.segmented button:has-text("Tableau")');
  await sleep(400);
  await shoot('dashboard', 'taches-tableau.png');
  await dash.click('.segmented button:has-text("Liste")');
  await dash.click('.nav-item:has-text("Widgets du bureau")');
  await sleep(400);
  await shoot('dashboard', 'gestion-widgets.png');
  await dash.click('.nav-item:has-text("Paramètres")');
  await sleep(400);
  await shoot('dashboard', 'parametres.png');
  await dash.click('.nav-item:has-text("Tâches")');
  await dash.click('.list-card .task-item:has-text("Préparer la réunion") .task-main');
  await dash.waitForSelector('.modal');
  await sleep(400);
  await shoot('dashboard', 'editeur-tache.png');
  await dash.keyboard.press('Escape');
  for (const t of ['today', 'priorities', 'upcoming', 'tasks', 'projects', 'notes', 'progress']) await shoot(`widget/${t}`, `widget-${t}-clair.png`);
  await dash.evaluate(() => window.mbi.widgets.setVisible('reminders', true));
  await shoot('widget/reminders', 'widget-reminders-clair.png');
  await shoot('reminders', 'fenetre-rappel.png');
  await dash.evaluate(() => window.mbi.settings.update({ theme: 'dark' }));
  await sleep(500);
  for (const t of ['today', 'priorities', 'upcoming', 'tasks', 'projects', 'notes', 'progress', 'reminders']) await shoot(`widget/${t}`, `widget-${t}-sombre.png`);
  await dash.click('.nav-item:has-text("Vue d\'ensemble")');
  await sleep(500);
  await shoot('dashboard', 'tableau-de-bord-sombre.png');
  await dash.evaluate(() => window.mbi.app.openQuickAdd());
  const qa = await pageFor(app, 'quick-add');
  await qa.fill('.qa-input', 'Envoyer le devis vendredi 10h #Clients !urgent');
  await sleep(300);
  await shoot('quick-add', 'saisie-rapide.png');
  await dash.evaluate(() => window.mbi.settings.update({ theme: 'system' }));
  // Positions des widgets pour la composition « bureau ».
  fs.writeFileSync(path.join(shots, 'positions.json'), JSON.stringify(await windowsInfo(app), null, 2));
  results.push('  ✔ Captures d’écran enregistrées dans docs/captures/');
} catch (err) {
  results.push(`  ! Captures incomplètes : ${err.message}`);
}

await app.close();

// ---------------------------------------------------------------------------- Redémarrage
app = await launch();
const dash2 = await pageFor(app, 'dashboard').catch(() => null);
const anyPage = dash2 ?? (await pageFor(app, 'widget/today'));
await sleep(1500);

await check('Après redémarrage : tâches, notes et paramètres conservés', async () => {
  const s = await snapshot(anyPage);
  const titles = s.tasks.map((t) => t.title);
  for (const t of ['Appeler Paul', 'Acheter du pain', 'Préparer la réunion budget', 'Payer le loyer']) assert(titles.includes(t), `${t} manquante`);
  assert(s.notes[0]?.content.includes('plombier'), 'note perdue');
  assert(s.projects.some((p) => p.name === 'Travail') && s.projects.some((p) => p.name === 'Maison'), 'projets perdus');
});

await check('Après redémarrage : position, taille, visibilité et premier plan des widgets restaurés', async () => {
  const wins = await windowsInfo(app);
  const progress = wins.find((w) => w.url.includes('#/widget/progress'));
  assert(progress && progress.bounds.x === 420 && progress.bounds.y === 300 && progress.bounds.width === 330, JSON.stringify(progress?.bounds));
  assert(wins.some((w) => w.url.includes('#/widget/upcoming')), 'widget « À venir » non restauré');
  const prio = wins.find((w) => w.url.includes('#/widget/priorities'));
  assert(prio?.onTop, 'premier plan non restauré');
});

await app.close();

const db = path.join(userData, 'donnees', 'mon-bureau.db');
await check('Base SQLite et sauvegarde quotidienne présentes sur le disque', async () => {
  assert(fs.existsSync(db), 'base absente');
  assert(fs.readdirSync(path.join(userData, 'donnees', 'sauvegardes')).length >= 1, 'aucune sauvegarde');
});

const logFile = path.join(userData, 'journaux', 'main.log');
await check('Aucune erreur dans le journal de l’application', async () => {
  const log = fs.readFileSync(logFile, 'utf8');
  const entries = log.split(/\n(?=\d{4}-\d{2}-\d{2}T)/);
  const errors = entries.filter((l) => l.includes('[ERROR]'));
  if (errors.length) console.error(errors.join('\n'));
  assert(errors.length === 0, errors.map((e) => e.split('\n')[0]).join(' | '));
});

console.log('\nTests de bout en bout — Mon Bureau Intelligent\n');
console.log(results.join('\n'));
console.log(`\n${results.filter((r) => r.includes('✔')).length} réussis, ${failures} échoué(s)\n`);
fs.rmSync(userData, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
