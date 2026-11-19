import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
const source = 'docs/assets/generated-v3';
const illustrationDir = 'src/assets/illustrations';
const destinationDir = 'src/assets/destinations';
await mkdir(illustrationDir, { recursive: true });
const illustrations = [
  ['travel-kit', 480, 560], ['travel-kit-mobile', 240, 280],
  ['day-train', 360, 270], ['day-beach', 360, 270], ['day-suitcase', 360, 270], ['ledger-notebook', 280, 280], ['brand-mountains', 80, 60],
];
for (const [name, width, height] of illustrations) {
  const input = name === 'travel-kit-mobile' ? 'travel-kit' : name;
  const target = path.join(illustrationDir, name + '.webp');
  await sharp(path.join(source, input + '.png')).trim({ threshold: 10 }).resize({ width, height, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(target);
  if ((await stat(target)).size > 150 * 1024) throw new Error('Image budget exceeded: ' + target);
  console.log(target, (await stat(target)).size);
}
await sharp(path.join(source, 'brand-mountains.png')).trim({ threshold: 10 }).resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile('public/favicon.png');
for (const city of ['suzhou', 'qingdao', 'xiamen', 'chengdu', 'xian', 'dali']) {
  for (const width of [480, 960]) {
    const target = path.join(destinationDir, city + '-' + width + '.webp');
    for (let quality = width === 960 ? 76 : 82; quality >= 40; quality -= 6) {
      await sharp(path.join(source, city + '.png')).resize(width, width * 9 / 16, { fit: 'cover', position: 'centre' }).webp({ quality, effort: 6 }).toFile(target);
      if ((await stat(target)).size <= 140 * 1024) break;
    }
    if ((await stat(target)).size > 150 * 1024) throw new Error('Image budget exceeded: ' + target);
    console.log(target, (await stat(target)).size);
  }
}
