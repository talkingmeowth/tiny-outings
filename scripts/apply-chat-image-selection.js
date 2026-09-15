import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { imageDbQuery, sqlString } from './lib/image-chat-db.js';
import { validateChatDecision } from './lib/chat-image-decision.js';
const root = resolve(import.meta.dirname, '..');
const arg = (k) => { const i=process.argv.indexOf(k); return i<0 ? null : process.argv[i+1]; };
if (!arg('--bundle') || !arg('--decision')) throw Error('Use --bundle PATH --decision PATH [--apply].');
const bundle = JSON.parse(await readFile(resolve(root,arg('--bundle'))));
const decision = JSON.parse(await readFile(resolve(root,arg('--decision'))));
const receipt = await validateChatDecision(bundle, decision);
if (process.argv.includes('--apply')) {
  if (!bundle.expected_updated_at) throw Error('Evaluation bundles cannot change live images.');
  // Original pixels already downloaded and inspected; no image/model API calls.
  // Reuse an existing stable Storage URL when available. External URLs retain
  // their exact reviewed provenance and are still exposed in manual review.
  const c = receipt.selected; const page = c?.source_page_url || c?.metadata?.find((m)=>m.source_page_url||m.link)?.source_page_url || c?.image_url || null;
  const { local_path: _path, ...logged } = receipt;
  const result = imageDbQuery(root, `select public.apply_chat_image_selection(${sqlString(bundle.activity.activity_id)}::uuid,${sqlString(bundle.expected_updated_at)}::timestamptz,${sqlString(bundle.input_hash)},${sqlString(JSON.stringify(logged))}::jsonb,${sqlString(c?.image_url||null)},${sqlString(c?.image_url||null)},${sqlString(page)},${receipt.confidence??'null'}) as outcome;`);
  console.log(JSON.stringify(result));
} else console.log(`Validated chat review; no live changes. ${receipt.selected ? 'Photo selected.' : 'Category art selected.'}`);
await writeFile(resolve(root, arg('--decision') + '.validated.json'), JSON.stringify(receipt,null,2));
