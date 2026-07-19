/* global process */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputPath = join(root, 'supabase', 'seed', 'activity_organiser_website_search_updates.generated.sql');
const auditPath = join(root, 'data', 'activity_organiser_website_search_audit.generated.json');
const minimumConfidence = Number(process.env.ORGANISER_WEBSITE_MIN_CONFIDENCE || 80);
const limit = Number(process.env.ORGANISER_WEBSITE_LIMIT || 0);

function readEnv() {
  return Object.fromEntries(readFileSync(join(root, '.env.local'), 'utf8').replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line && !line.trim().startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^['"]|['"]$/g, '')];
    }));
}

function sql(value) {
  return value === null || value === undefined ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
}

function normaliseUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseJson(text) {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function loadActivities(env) {
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/rest/v1/activities?select=activity_id,activity_name,address,borough,category,website,source_url&organiser_website=is.null&public_listing_status=eq.published&order=activity_name.asc&limit=1000&offset=${offset}`,
      { headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}` } },
    );
    if (!response.ok) throw new Error(`Could not read activities: ${response.status}`);
    const page = await response.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

async function findOrganiserWebsite(activity, apiKey) {
  const prompt = [
    'Find the official organiser or provider website for this UK family activity.',
    `Activity: ${activity.activity_name}`,
    `Venue/address: ${activity.address}`,
    `Borough: ${activity.borough || 'London'}`,
    `Category: ${activity.category}`,
    'Use web search. Do not return Happity, Eventbrite, Fever, Google Maps, or a directory listing unless no other result exists.',
    'Return JSON only: {"official_website":"https://... or null","confidence":0-100,"evidence_url":"https://... or null"}.',
  ].join('\n');
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0 },
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const body = await response.json();
  const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
  const result = parseJson(text) || {};
  const citations = body.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const citedUrl = citations.find((chunk) => chunk.web?.uri)?.web?.uri || null;
  return {
    website: normaliseUrl(result.official_website),
    confidence: Number(result.confidence) || 0,
    evidenceUrl: normaliseUrl(result.evidence_url) || normaliseUrl(citedUrl),
    rawText: text,
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function main() {
  const env = readEnv();
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is missing from .env.local');
  const activities = await loadActivities(env);
  const targets = limit > 0 ? activities.slice(0, limit) : activities;
  console.log(`Searching ${targets.length} activities at a ${minimumConfidence}% confidence threshold.`);

  const results = await mapWithConcurrency(targets, 2, async (activity, index) => {
    try {
      const match = await findOrganiserWebsite(activity, env.GEMINI_API_KEY);
      const accepted = match.website && match.confidence >= minimumConfidence;
      console.log(`${index + 1}/${targets.length} ${accepted ? 'match' : 'skip'} ${activity.activity_name}`);
      return { activity, ...match, accepted };
    } catch (error) {
      console.warn(`${index + 1}/${targets.length} error ${activity.activity_name}: ${error.message.slice(0, 140)}`);
      return { activity, website: null, confidence: 0, evidenceUrl: null, error: error.message, accepted: false };
    }
  });

  const accepted = results.filter((result) => result.accepted);
  const sqlText = accepted.length
    ? `-- Generated by scripts/enrich-organiser-websites.js\nwith updates (activity_id, organiser_website, confidence, evidence_url) as (\n  values\n    ${accepted.map((result) => `(${sql(result.activity.activity_id)}::uuid, ${sql(result.website)}::text, ${result.confidence}::numeric, ${sql(result.evidenceUrl)}::text)`).join(',\n    ')}\n)\nupdate public.activities as activity\nset\n  organiser_website = updates.organiser_website,\n  organiser_website_confidence = updates.confidence,\n  organiser_website_evidence_url = updates.evidence_url,\n  updated_at = now()\nfrom updates\nwhere activity.activity_id = updates.activity_id;\n`
    : '-- No organiser website matches met the threshold.\n';
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sqlText);
  writeFileSync(auditPath, JSON.stringify({ minimumConfidence, searched: results.length, accepted: accepted.length, results }, null, 2) + '\n');
  console.log(`Accepted ${accepted.length}/${results.length}; wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
