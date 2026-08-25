import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const root = join(fileURLToPath(new URL('..', import.meta.url)));
const testRoots = ['src', 'scripts', 'desktop-review/src'];

function findTests(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findTests(path);
    return entry.isFile() && entry.name.endsWith('.test.js') ? [path] : [];
  });
}

const testFiles = testRoots.flatMap((directory) => findTests(join(root, directory))).sort();
if (!testFiles.length) throw new Error('No Node test files were found.');

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
  cwd: root,
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
