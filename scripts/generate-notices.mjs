import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const notices = ['同路 · 毕业旅行 / Third-party runtime dependency notices', 'Generated from package-lock.json. See individual licenses below.'];
for (const [folder, info] of Object.entries(lock.packages)) {
  if (!folder || info.dev || info.optional) continue;
  const pkg = JSON.parse(await readFile(path.join(folder, 'package.json'), 'utf8'));
  const entries = await readdir(folder);
  const license = entries.find(file => /^licen[sc]e(?:\.|$)/i.test(file));
  if (!license) throw new Error('License text missing for ' + pkg.name);
  notices.push('\n=== ' + pkg.name + '@' + pkg.version + ' (' + (info.license ?? pkg.license ?? 'see text') + ') ===\n' + await readFile(path.join(folder, license), 'utf8'));
}
await writeFile('public/THIRD_PARTY_NOTICES.txt', notices.join('\n'));
console.log('Runtime notices generated.');
