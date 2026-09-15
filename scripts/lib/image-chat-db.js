import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { firstJsonObject } from './active-activity-reader.js';
export const sqlString = (v) => v === null || v === undefined ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
export function imageDbQuery(root, sql) {
  const directory = resolve(root, 'output/image-chat-db'); mkdirSync(directory, { recursive: true });
  const path = resolve(directory, `${randomUUID()}.sql`); writeFileSync(path, sql);
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-Command', `npx.cmd supabase db query --linked --output json --file '${path.replaceAll("'", "''")}'`], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true })
    : spawnSync('npx', ['supabase', 'db', 'query', '--linked', '--output', 'json', '--file', path], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw Error(result.stderr || 'Linked database query failed.');
  return firstJsonObject(result.stdout)?.rows || [];
}
