// Reproducible raster exports of the code-native logo. Existing icons stay intact for rollback.
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const source = new URL('../public/icons/design19.svg', import.meta.url);
for (const size of [180, 192, 512]) {
  await sharp(fileURLToPath(source)).resize(size, size)
    .png().toFile(fileURLToPath(new URL(`../public/icons/design19-${size}.png`, import.meta.url)));
}
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const directory = new URL(`../android/app/src/main/res/mipmap-${density}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  await sharp(fileURLToPath(source)).resize(size, size).png().toFile(fileURLToPath(new URL('design19_launcher.png', directory)));
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white" /></svg>`);
  await sharp(fileURLToPath(source)).resize(size, size).composite([{ input: mask, blend: 'dest-in' }]).png()
    .toFile(fileURLToPath(new URL('design19_launcher_round.png', directory)));
}
