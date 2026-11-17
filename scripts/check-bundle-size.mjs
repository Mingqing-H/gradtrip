import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';
const manifest = JSON.parse(await readFile('dist/.vite/manifest.json', 'utf8'));
const needed = new Set();
function visit(key) {
  const item = manifest[key]; if (!item || needed.has(item.file)) return;
  needed.add(item.file); (item.css ?? []).forEach(file => needed.add(file)); (item.imports ?? []).forEach(visit);
}
Object.entries(manifest).filter(([, value]) => value.isEntry).forEach(([key]) => visit(key));
let js = 0; let css = 0;
for (const file of needed) {
  const size = gzipSync(await readFile(path.join('dist', file))).length;
  if (file.endsWith('.js')) js += size; else if (file.endsWith('.css')) css += size;
}
console.log(`Entry JS gzip ${(js / 1024).toFixed(2)} KiB / 200; CSS gzip ${(css / 1024).toFixed(2)} KiB / 40`);
if (js > 200 * 1024 || css > 40 * 1024) process.exitCode = 1;
async function inspect(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) await inspect(file);
    else if (/\.(webp|avif|png|jpe?g)$/i.test(file) && (await stat(file)).size > 150 * 1024) {
      console.error(`Image exceeds 150 KiB: ${file}`); process.exitCode = 1;
    }
  }
}
await inspect('dist');
