// Après `astro build` : préfixe les liens absolus ("/agenda", "/assets/...") par le sous-dossier
// du site quand il est servi depuis un chemin (ex. parlementjpv.github.io/parlementjpv/).
// Sans BASE_PATH (domaine propre ou repo *.github.io), ne fait rien.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const base = (process.env.BASE_PATH || '').replace(/\/$/, '');
if (!base || base === '/') process.exit(0);

const re = /\b(href|src|action)="\/(?!\/)/g;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p);
    else if (/\.(html|js)$/.test(e.name)) {
      const s = await readFile(p, 'utf8');
      const out = s.replace(re, (m, attr) => `${attr}="${base}/`).replaceAll(`"${base}${base}/`, `"${base}/`);
      if (out !== s) await writeFile(p, out);
    }
  }
}
await walk('dist');
console.log(`Liens préfixés par ${base}`);
