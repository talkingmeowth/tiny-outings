import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildTrainingBatch } from './lib/image-training-cases.js';

const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const input = option('--input', 'output/image-selection-v5');
const output = option('--output', 'output/image-training-2026-09');
const read = (name, fallback) => fs.existsSync(path.join(input, name)) ? JSON.parse(fs.readFileSync(path.join(input, name), 'utf8')) : fallback;
const snapshot = read('snapshot.json');
if (!snapshot) throw Error('Provide an existing cached snapshot. This command never calls SerpAPI.');
const batch = buildTrainingBatch(snapshot, read('benchmark.json', {}), read('rejections.json', []), { batchId: option('--batch', 'image-training-2026-09') });
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(batch, null, 2));
const quote = (v) => `'${String(v).replaceAll("'", "''")}'`;
const json = (v) => `${quote(JSON.stringify(v))}::jsonb`;
const ids = batch.cases.map((c) => quote(c.activity_id)).join(',');
const sql = ['begin;',
  // Abort the entire insert if a selected listing was removed/archived after snapshot capture.
  `do $$ begin if (select count(*) from public.activities where activity_id in (${ids}) and coalesce(archive,false) = false and public_listing_status in ('published','draft')) <> ${batch.cases.length} then raise exception 'Some sampled listings are no longer active. Refresh the snapshot.'; end if; end $$;`,
  `insert into public.image_training_batches(batch_id,title,description) values (${quote(batch.batch_id)},${quote(batch.title)},${quote(batch.description)}) on conflict do nothing;`,
  ...batch.cases.map((c) => `insert into public.image_training_cases(${Object.keys(c).join(',')}) values (${Object.values(c).map((v) => typeof v === 'object' ? json(v) : typeof v === 'number' ? v : quote(v)).join(',')}) on conflict do nothing;`),
  'commit;'].join('\n');
fs.writeFileSync(path.join(output, 'seed.sql'), sql);
// Management API requests have a small body limit. Each chunk is atomic and
// rerunnable; ON CONFLICT never overwrites a case or an existing human review.
const statements = sql.split('\n');
const inserts = statements.slice(3, -1);
const chunks = []; let current = []; let size = 0;
for (const statement of inserts) {
  if (size + Buffer.byteLength(statement) > 400000 && current.length) { chunks.push(current); current = []; size = 0; }
  current.push(statement); size += Buffer.byteLength(statement);
}
if (current.length) chunks.push(current);
const chunkFiles = chunks.map((chunk, i) => {
  const file = path.join(output, `seed.part-${String(i + 1).padStart(2, '0')}.sql`);
  fs.writeFileSync(file, ['begin;', statements[1], statements[2], ...chunk, 'commit;'].join('\n'));
  return file;
});
console.log(JSON.stringify({ batch: batch.batch_id, cases: batch.cases.length,
  splits: Object.fromEntries(['development', 'calibration', 'holdout'].map((s) => [s, batch.cases.filter((c) => c.dataset_split === s).length])),
  candidates: batch.cases.reduce((n, c) => n + c.candidates.length, 0),
  reasons: batch.cases.reduce((n, c) => ({ ...n, [c.selection_reason]: (n[c.selection_reason] || 0) + 1 }), {}),
  first_cases: batch.cases.slice(0, 10).map((c) => c.activity_snapshot.activity_name), chunks: chunkFiles.length, output }, null, 2));
if (args.includes('--apply')) {
  // Static executable/arguments; file paths are never interpolated into a shell command.
  const cli = path.resolve('node_modules/supabase/bin/supabase.exe');
  if (!fs.existsSync(cli)) throw Error('Apply the generated SQL with: npx supabase db query --linked --file <seed.sql>');
  for (const file of chunkFiles) console.log(execFileSync(cli, ['db', 'query', '--linked', '--file', path.resolve(file)], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
}
