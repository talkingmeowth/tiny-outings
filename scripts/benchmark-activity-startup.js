// Read-only timing of the same public directory using serial and parallel loads.
import { readFileSync } from 'node:fs';
import process from 'node:process';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { ACTIVITY_SELECT_COLUMNS } from '../src/activityColumns.js';
import { ACTIVITY_PAGE_SIZE, loadActivityPages } from '../src/activityLoader.js';

const env = Object.fromEntries(readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  .replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => /^\s*[A-Z_]+=/.test(line))
  .map((line) => {
    const at = line.indexOf('=');
    return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')];
  }));
const endpoint = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!endpoint || !key) throw new Error('Missing public Supabase build configuration.');

async function measure(mode) {
  let requests = 0;
  let bytes = 0;
  const loadPage = async (from, to, includeCount) => {
    requests += 1;
    const url = new URL('/rest/v1/activities', endpoint);
    Object.entries({
      select: ACTIVITY_SELECT_COLUMNS, public_listing_status: 'eq.published',
      archive: 'eq.false', order: 'start_time.asc,activity_id.asc',
      offset: from, limit: to - from + 1,
    }).forEach(([name, value]) => url.searchParams.set(name, value));
    const response = await fetch(url, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, ...(includeCount ? { Prefer: 'count=exact' } : {}) },
      signal: AbortSignal.timeout(30000),
    });
    const text = await response.text();
    bytes += Buffer.byteLength(text);
    if (!response.ok) throw new Error(`Public directory returned HTTP ${response.status}`);
    const count = response.headers.get('content-range')?.split('/')[1];
    return { data: JSON.parse(text), count: /^\d+$/.test(count || '') ? Number(count) : null };
  };
  const start = performance.now();
  let rows;
  if (mode === 'serial') {
    rows = [];
    for (let from = 0; ; from += ACTIVITY_PAGE_SIZE) {
      const page = await loadPage(from, from + ACTIVITY_PAGE_SIZE - 1, false);
      rows.push(...page.data);
      if (page.data.length < ACTIVITY_PAGE_SIZE) break;
    }
  } else rows = await loadActivityPages(loadPage);
  const milliseconds = Math.round(performance.now() - start);
  console.log(JSON.stringify({ mode, milliseconds, records: rows.length, requests, bytes }));
  return { rows, milliseconds };
}

const serial = await measure('serial');
const parallel = await measure('parallel');
assert.deepEqual(parallel.rows.map((a) => a.activity_id), serial.rows.map((a) => a.activity_id));
console.log(JSON.stringify({ sameRecordsAndOrder: true, improvementPercent: Math.round(100 * (1 - parallel.milliseconds / serial.milliseconds)) }));
