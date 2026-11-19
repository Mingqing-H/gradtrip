import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
const source = 'docs/assets/generated-backgrounds/graduation-group.png';
const directory = 'src/assets/backgrounds';
await mkdir(directory, { recursive: true });
for (const [width, budget] of [[960, 60 * 1024], [480, 18 * 1024]]) {
  const output = `${directory}/graduation-group-${width}.webp`;
  for (let quality = 76; quality >= 40; quality -= 6) {
    await sharp(source).resize(width, width * 9 / 16, { fit: 'cover' })
      .webp({ quality, effort: 6 }).toFile(output);
    if ((await stat(output)).size <= budget) break;
  }
  const bytes = (await stat(output)).size;
  if (bytes > budget) throw new Error('Background budget exceeded: ' + output);
  console.log(output, bytes);
}
