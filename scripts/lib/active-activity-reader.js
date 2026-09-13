/* global process */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function firstJsonObject(value) {
  const text = String(value || '');
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  return null;
}

function safeColumns(columns) {
  if (!columns.length || columns.some((column) => !/^[a-z_][a-z0-9_]*$/i.test(column))) {
    throw new Error('Activity column list contains an unsafe identifier.');
  }
  return columns;
}

function linkedDatabaseRows(root, columns) {
  if (!existsSync(join(root, 'supabase', '.temp', 'project-ref'))) return null;
  const query = `select ${safeColumns(columns).join(', ')} from public.activities where archive = false and public_listing_status in ('published', 'draft') order by activity_id;`;
  const temporaryDirectory = mkdtempSync(join(tmpdir(), 'tiny-outings-query-'));
  const queryFile = join(temporaryDirectory, 'active-activities.sql');
  try {
    writeFileSync(queryFile, query);
    const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npx';
    const argumentsList = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npx.cmd supabase db query --linked --output-format json --file ${queryFile}`]
      : ['supabase', 'db', 'query', '--linked', '--output-format', 'json', '--file', queryFile];
    const result = spawnSync(command, argumentsList, {
      cwd: root, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024,
    });
    if (result.status !== 0) return null;
    return firstJsonObject(result.stdout)?.rows || null;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

async function restRows({ supabaseUrl, supabaseKey, columns }) {
  if (!supabaseUrl || !supabaseKey) throw new Error('Missing Supabase URL or API key.');
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const params = new URLSearchParams({
      select: safeColumns(columns).join(','),
      archive: 'eq.false',
      public_listing_status: 'in.(published,draft)',
      order: 'activity_id.asc',
      limit: '1000',
      offset: String(offset),
    });
    const response = await fetch(`${supabaseUrl}/rest/v1/activities?${params}`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!response.ok) throw new Error(`Could not load activities: ${response.status} ${await response.text()}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

export async function loadActiveActivities({ root, supabaseUrl, supabaseAnonKey, supabaseServiceRoleKey, columns }) {
  if (supabaseServiceRoleKey) {
    return restRows({ supabaseUrl, supabaseKey: supabaseServiceRoleKey, columns });
  }
  const linkedRows = linkedDatabaseRows(root, columns);
  if (linkedRows) return linkedRows;
  console.warn('Linked database/service key unavailable; public REST fallback may omit draft activities because of RLS.');
  return restRows({ supabaseUrl, supabaseKey: supabaseAnonKey, columns });
}
