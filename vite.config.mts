import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

// Politique de sécurité du contenu, ajoutée uniquement au build de production
// (le serveur de développement a besoin de scripts en ligne pour le rechargement à chaud).
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'mbi-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// Interface (renderer) : une seule page HTML, la vue est choisie via le hash de l'URL
// (#/dashboard, #/widget/today, #/quick-add, #/reminders).
export default defineConfig({
  root: resolve(root, 'src/renderer'),
  base: './',
  plugins: [react(), cspPlugin()],
  server: { port: 5173, strictPort: true },
  build: {
    outDir: resolve(root, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
