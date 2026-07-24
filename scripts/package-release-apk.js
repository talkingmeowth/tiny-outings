import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const debugApk = join(repoRoot, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const releaseApk = join(repoRoot, 'release', 'tiny-outings-debug.apk');

if (!existsSync(debugApk)) throw new Error('Android debug APK is missing. Run the Android build first.');
mkdirSync(dirname(releaseApk), { recursive: true });
copyFileSync(debugApk, releaseApk);
console.log(`Packaged release APK: ${releaseApk} (${statSync(releaseApk).size} bytes)`);
