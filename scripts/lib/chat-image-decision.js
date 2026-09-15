import { readFile } from 'node:fs/promises';
import { sha } from './astra-image-selector.js';
import { validateDecision, PHOTO_THRESHOLD } from '../../supabase/functions/image-review-simple/policy.js';
export async function validateChatDecision(bundle, decision) {
  if (decision.assessment_channel !== 'codex_chat' || decision.input_hash !== bundle.input_hash || !decision.reviewed_at || !Number.isFinite(Date.parse(decision.reviewed_at))) throw Error('Current chat receipt and matching input hash required.');
  if (!bundle.available.length) throw Error('No readable images: cannot record a completed LLM vision review.');
  validateDecision(decision, bundle.available);
  // Evidence must bind to the actual supplied pixels, not just reusable URLs.
  for (const c of bundle.available) if (sha(await readFile(c.local_path)) !== c.pixel_sha256) throw Error('Candidate pixels changed; review again.');
  const selected = bundle.available.find((c) => c.candidate_id === decision.selected_candidate_id) || null;
  if (selected && decision.full_size_verified_sha256 !== selected.pixel_sha256) throw Error('Selected full-size photo must be inspected in chat.');
  const assessment = decision.assessments.find((a) => a.candidate_id === selected?.candidate_id);
  if (selected && (assessment.confidence < PHOTO_THRESHOLD || assessment.identity_conflict)) throw Error('Photo failed identity/confidence checks.');
  return { ...decision, llm_reviewed: true, status: 'complete', selected, confidence: assessment?.confidence ?? null,
    selector_version: bundle.selector_version, available_count: bundle.available.length, unavailable_count: bundle.unavailable.length };
}
