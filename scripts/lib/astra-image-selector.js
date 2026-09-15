import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { lookup } from 'node:dns/promises';
import sharp from 'sharp';
import { SELECTOR_MODEL, SELECTOR_VERSION, selectionPrompt } from '../../supabase/functions/image-review-simple/policy.js';

export const sha = (v) => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
export function publicAddress(ip) {
  if (ip.includes(':')) return !/^(::|fe[89ab]|f[cd])/i.test(ip) && !ip.toLowerCase().includes('ffff:');
  const [a, b] = ip.split('.').map(Number);
  return a > 0 && a !== 10 && a !== 127 && a < 224 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127);
}
export async function downloadPhoto(url) {
  for (let redirects = 0; redirects < 5; redirects++) {
    const u = new URL(url);
    if (/maps\.googleapis\.com|maps\.google\.com|serpapi\.com|api\.openai\.com/i.test(u.hostname)) throw Error('Utility/API endpoint is not a photo candidate.');
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80', '443'].includes(u.port))) throw Error('Unsafe image address.');
    const addresses = await lookup(u.hostname, { all: true });
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) throw Error('Private image address.');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'TinyOutings-ImageReview/1.0', Accept: 'image/*' } });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) { url = new URL(response.headers.get('location'), url).href; await response.body?.cancel(); continue; }
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 12 * 1024 * 1024) { await response.body?.cancel(); throw Error('Image exceeds 12MB.'); }
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 12 * 1024 * 1024) throw Error('Image exceeds 12MB.'); chunks.push(chunk); }
    const raw = Buffer.concat(chunks); const metadata = await sharp(raw, { limitInputPixels: 40000000 }).metadata();
    if (!['jpeg', 'png', 'webp', 'avif'].includes(metadata.format)) throw Error('Not a supported photograph.');
    if (Math.min(metadata.width, metadata.height) < 300 || metadata.width * metadata.height < 180000) throw Error('Insufficient original resolution.');
    const bytes = await sharp(raw).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    return { bytes, pixel_sha256: sha(bytes), width: metadata.width, height: metadata.height };
  }
  throw Error('Too many redirects.');
}
// Preparation ONLY. The user explicitly requires assessment in the active Codex
// chat: no OpenAI API, codex exec, subprocess model, or unattended inference.
export async function prepareChatImages(activity, candidates, { directory, log = console.log } = {}) {
  const inputHash = sha({ activity, candidates, version: SELECTOR_VERSION, model: SELECTOR_MODEL });
  const dir = resolve(directory, inputHash); await mkdir(dir, { recursive: true });
  const available = []; const unavailable = [];
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < candidates.length) {
      const c = candidates[cursor++];
      try {
        const path = join(dir, `${c.candidate_id}.jpg`); let downloaded;
        try { const bytes = await readFile(path); const info = await sharp(bytes).metadata(); downloaded = { bytes, pixel_sha256: sha(bytes), width: info.width, height: info.height }; }
        catch { downloaded = await downloadPhoto(c.image_url); await writeFile(path, downloaded.bytes); }
        const { bytes: _bytes, ...facts } = downloaded;
        available.push({ ...c, ...facts, local_path: path });
      } catch (e) { unavailable.push({ candidate_id: c.candidate_id, reason: e.message }); }
    }
  }));
  available.sort((a, b) => a.candidate_id.localeCompare(b.candidate_id));
  log(`${activity.activity_name}: ${available.length}/${candidates.length} original photos readable; preparing chat review.`);
  const sheets = [];
  // Bounded pages, but NO top-k ranking: every readable cached candidate gets
  // a pixel assessment. Then all suitable page winners compete at full size.
  for (let start = 0; start < available.length; start += 20) {
    const page = available.slice(start, start + 20); const sheet = join(dir, `sheet-${start}.jpg`);
    const tiles = await Promise.all(page.map(async (c, i) => ({ input: await sharp(c.local_path).resize(340, 260, { fit: 'contain', background: '#fff' }).extend({ top: 30, bottom: 0, left: 0, right: 0, background: '#fff' })
      .composite([{ input: Buffer.from(`<svg width="340" height="30"><text x="10" y="22" font-size="20" font-family="sans-serif">${c.candidate_id}</text></svg>`), top: 0, left: 0 }]).jpeg().toBuffer(), left: (i % 4) * 340, top: Math.floor(i / 4) * 290 })));
    await sharp({ create: { width: 1360, height: Math.ceil(page.length / 4) * 290, channels: 3, background: '#fff' } }).composite(tiles).jpeg({ quality: 92 }).toFile(sheet);
    sheets.push({ path: sheet, candidate_ids: page.map((c) => c.candidate_id) });
  }
  const bundle = { status: 'awaiting_chat_review', input_hash: inputHash, selector_version: SELECTOR_VERSION, requested_model: SELECTOR_MODEL,
    prepared_at: new Date().toISOString(), activity, candidates, available, unavailable, sheets, llm_reviewed: false };
  await writeFile(join(dir, 'bundle.json'), JSON.stringify(bundle, null, 2));
  await writeFile(join(dir, 'instructions.txt'), selectionPrompt(activity, available.map(({ local_path: _, ...c }) => c)));
  return bundle;
}
