import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const landingRoot = join(repoRoot, 'landing');
const outputRoot = join(repoRoot, 'render-mobile');
const sourceApk = join(repoRoot, 'release', 'tiny-outings-debug.apk');
const outputApk = join(outputRoot, 'downloads', 'tiny-outings-debug.apk');
const buildGradle = readFileSync(join(repoRoot, 'android', 'app', 'build.gradle'), 'utf8');
const versionName = buildGradle.match(/versionName\s+"([^"]+)"/)?.[1];
const versionCode = buildGradle.match(/versionCode\s+(\d+)/)?.[1];

if (!versionName || !versionCode) {
  throw new Error('Could not read Android versionName and versionCode.');
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(dirname(outputApk), { recursive: true });
mkdirSync(join(outputRoot, 'assets'), { recursive: true });

copyFileSync(sourceApk, outputApk);
copyFileSync(join(landingRoot, 'styles.css'), join(outputRoot, 'styles.css'));
copyFileSync(join(repoRoot, 'public', 'icons', 'icon.svg'), join(outputRoot, 'assets', 'icon.svg'));
copyFileSync(
  join(repoRoot, 'public', 'icons', 'icon-512.png'),
  join(outputRoot, 'assets', 'icon-512.png'),
);

const apkBytes = readFileSync(sourceApk);
const apkHash = createHash('sha256').update(apkBytes).digest('hex');
const { size } = statSync(outputApk);
const sizeInMb = `${(size / 1024 / 1024).toFixed(1)} MB`;
const updatedDate = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'long',
  timeZone: 'Europe/London',
}).format(new Date());
const apkUrl = `/downloads/tiny-outings-debug.apk?v=${versionName}-${versionCode}-${apkHash.slice(0, 10)}`;

const replacements = {
  '{{APK_URL}}': apkUrl,
  '{{APP_VERSION}}': versionName,
  '{{APK_SIZE}}': sizeInMb,
  '{{UPDATED_DATE}}': updatedDate,
  '{{VERSION_CODE}}': versionCode,
  '{{APK_HASH}}': apkHash,
};

let landingHtml = readFileSync(join(landingRoot, 'index.html'), 'utf8');
for (const [placeholder, value] of Object.entries(replacements)) {
  landingHtml = landingHtml.replaceAll(placeholder, value);
}

if (/{{[A-Z_]+}}/.test(landingHtml)) {
  throw new Error('Landing page contains unresolved build placeholders.');
}

writeFileSync(join(outputRoot, 'index.html'), landingHtml);

console.log(
  `Prepared Tiny Outings ${versionName} (${versionCode}): ${sizeInMb}, SHA-256 ${apkHash}`,
);
