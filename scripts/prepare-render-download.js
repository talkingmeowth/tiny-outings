import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceApk = join(repoRoot, 'release', 'tiny-outings-debug.apk');
const outputApk = join(repoRoot, 'render-mobile', 'downloads', 'tiny-outings-debug.apk');

rmSync(join(repoRoot, 'render-mobile'), { recursive: true, force: true });
mkdirSync(dirname(outputApk), { recursive: true });
copyFileSync(sourceApk, outputApk);

const { size } = statSync(outputApk);
console.log(`Prepared Render mobile APK download: ${outputApk} (${size} bytes)`);
