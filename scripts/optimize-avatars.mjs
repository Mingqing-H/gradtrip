import sharp from 'sharp';
import { mkdir, stat } from 'node:fs/promises';
import path from 'node:path';

const source = 'docs/assets/generated-avatars';
const output = 'src/assets/avatars/squad-portraits.webp';
const size = 128;
const portraits = await Promise.all(Array.from({ length: 6 }, async (_, index) => ({
  input: await sharp(path.join(source, `avatar-${String(index + 1).padStart(2, '0')}.png`))
    .resize(size, size, { fit: 'cover' }).png().toBuffer(),
  left: index * size,
  top: 0,
})));
await mkdir(path.dirname(output), { recursive: true });
await sharp({ create: { width: size * 6, height: size, channels: 3, background: '#FFFFFF' } })
  .composite(portraits).webp({ quality: 84, effort: 6 }).toFile(output);
const bytes = (await stat(output)).size;
if (bytes > 30 * 1024) throw new Error('Avatar atlas exceeds 30 KiB: ' + bytes);
console.log(`${output}: ${size * 6}x${size}, ${bytes} bytes`);
