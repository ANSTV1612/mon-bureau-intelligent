// Compile le processus principal et le script preload d'Electron avec esbuild.
// Usage : node scripts/build-main.mjs [--watch]
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
  // electron est fourni par le runtime ; koffi contient un module natif (.node) chargé à l'exécution.
  external: ['electron', 'koffi'],
  define: { 'process.env.NODE_ENV': JSON.stringify(watch ? 'development' : 'production') },
};

const targets = [
  { ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.cjs' },
  { ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.cjs' },
];

if (watch) {
  for (const options of targets) {
    const ctx = await context(options);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((options) => build(options)));
}
