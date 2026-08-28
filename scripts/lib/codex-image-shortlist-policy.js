import { createHash } from 'node:crypto';
import { allowsWikimediaImages, isWikimediaSource } from '../../src/wikimediaImagePolicy.js';

const stopTerms = new Set([
  'activity', 'activities', 'and', 'baby', 'babies', 'child', 'children', 'class', 'classes',
  'cafe', 'center', 'centre', 'club', 'coffee', 'family', 'for', 'from', 'garden', 'gardens',
  'ground', 'kids', 'london', 'park', 'play', 'playground', 'pool', 'session', 'studio', 'the', 'with',
]);
const hardRejectTerms = /\b(?:avatar|badge|banner|brandmark|calendar|diagram|emoji|favicon|flyer|icon|illustration|infographic|logo|map|menu|poster|screenshot|social media graphic|stock vector|template|thumbnail|ticket|timetable|vector|wordmark)\b/i;
const stockTerms = /\b(?:alamy|dreamstime|freepik|getty|istock|pinterest|shutterstock|stock photo|tripadvisor collage)\b/i;
const cafeDetailTerms = /\b(?:breakfast|burger|cake|cocktail|coffee cup|dessert|dish|drink|food|latte|meal|menu|pastry|plate|sandwich)\b/i;
const peopleDominatedTerms = /\b(?:award|celebrity|director|founder|headshot|influencer|interview|portrait|selfie|staff photo)\b/i;

function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function candidateHost(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function meaningfulTerms(value) {
  return [...new Set(normalise(value).split(' ').filter((term) => term.length >= 3 && !stopTerms.has(term)))];
}

function overlap(terms, text) {
  return terms.filter((term) => text.includes(term));
}

function sameOrSubdomain(candidate, expected) {
  return candidate === expected || candidate.endsWith(`.${expected}`);
}

function categoryProfile(activity) {
  const value = normalise(`${activity.category || ''} ${activity.activity_name || ''}`);
  if (/cafe|coffee|bakery|restaurant|food/.test(value)) {
    return {
      key: 'cafe',
      preferred: /\b(?:cafe|coffee shop|counter|entrance|exterior|frontage|inside|interior|seating|storefront|terrace|venue)\b/i,
      penalised: cafeDetailTerms,
    };
  }
  if (/park|garden|wood|outdoor|playground|nature|reserve/.test(value)) {
    return {
      key: 'outdoor',
      preferred: /\b(?:field|garden|green|nature|outdoor|park|path|play area|playground|reserve|trail|woodland)\b/i,
      penalised: /\b(?:bar|cafe interior|food|hotel|restaurant)\b/i,
    };
  }
  if (/swim|pool/.test(value)) {
    return {
      key: 'swim',
      preferred: /\b(?:baby swim|lesson|pool|swim|swimming|water)\b/i,
      penalised: /\b(?:logo|poster|portrait)\b/i,
    };
  }
  if (/bookshop|book store|bookstore/.test(value)) {
    return {
      key: 'bookshop',
      preferred: /\b(?:bookshop|bookshelves|entrance|exterior|interior|reading|storefront)\b/i,
      penalised: /\b(?:book cover|logo|poster)\b/i,
    };
  }
  return {
    key: 'activity',
    preferred: /\b(?:activity|class|children|families|group|inside|interior|session|studio|venue)\b/i,
    penalised: /\b(?:logo|poster|portrait)\b/i,
  };
}

function dimensionScore(candidate) {
  const width = Number(candidate.original_width || 0);
  const height = Number(candidate.original_height || 0);
  if (!width || !height) return { score: 0, reject: null };
  const shortest = Math.min(width, height);
  const ratio = width / height;
  if (shortest < 180) return { score: -100, reject: 'very_small_dimensions' };
  if (ratio < 0.35 || ratio > 3.2) return { score: -100, reject: 'extreme_aspect_ratio' };
  let score = shortest >= 900 ? 18 : shortest >= 600 ? 13 : shortest >= 400 ? 8 : 2;
  if (ratio >= 1.15 && ratio <= 2.1) score += 8;
  else if (ratio >= 0.8 && ratio <= 2.5) score += 3;
  else score -= 5;
  return { score, reject: null };
}

export function scoreCandidateMetadata(activity, candidate, index = 0) {
  const title = normalise(candidate.title);
  const metadata = normalise([candidate.title, candidate.source, candidate.link, candidate.original].filter(Boolean).join(' '));
  const name = normalise(activity.activity_name);
  const nameTerms = meaningfulTerms(activity.activity_name);
  const locationTerms = meaningfulTerms([
    activity.serpapi_image_search_ward,
    activity.borough,
    activity.postcode,
    activity.address,
  ].filter(Boolean).join(' '));
  const matchedNameTerms = overlap(nameTerms, metadata);
  const matchedLocationTerms = overlap(locationTerms, metadata);
  const exactName = name.length >= 5 && metadata.includes(name);
  const officialHosts = [activity.website, activity.organiser_website].map(candidateHost).filter(Boolean);
  const candidateHosts = [candidate.original, candidate.link].map(candidateHost).filter(Boolean);
  const official = candidateHosts.some((host) => officialHosts.some((expected) => sameOrSubdomain(host, expected)));
  const officialWebsiteCandidate = ['website', 'organiser'].includes(candidate.source_kind) && official;
  const profile = categoryProfile(activity);
  const dimensions = dimensionScore(candidate);
  const nameCoverage = matchedNameTerms.length / Math.max(1, nameTerms.length);
  const hasIdentityEvidence = exactName
    || nameCoverage >= 0.5
    || officialWebsiteCandidate
    || (official && matchedNameTerms.length > 0)
    || (matchedNameTerms.length > 0 && matchedLocationTerms.length > 0);
  const reasons = [];
  const rejectReasons = [];

  if (!candidate.original || !/^https?:\/\//i.test(candidate.original)) rejectReasons.push('invalid_original_url');
  if (!allowsWikimediaImages(activity) && [candidate.original, candidate.thumbnail, candidate.link, candidate.source].some(isWikimediaSource)) {
    rejectReasons.push('wikimedia_category_not_allowed');
  }
  if (hardRejectTerms.test(metadata)) rejectReasons.push('graphic_or_document_metadata');
  if (dimensions.reject) rejectReasons.push(dimensions.reject);
  if (nameTerms.length >= 2 && !hasIdentityEvidence) rejectReasons.push('insufficient_identity_evidence');

  let score = dimensions.score;
  const position = Number(candidate.position || index + 1);
  score += Math.max(0, 14 - Math.max(0, position - 1));
  if (exactName) { score += 34; reasons.push('exact activity name'); }
  else if (matchedNameTerms.length) {
    score += Math.round(26 * matchedNameTerms.length / Math.max(1, nameTerms.length));
    reasons.push(`${matchedNameTerms.length} activity-name terms`);
  } else if (nameTerms.length >= 2) {
    score -= 28;
    reasons.push('no activity-name evidence');
  }
  if (matchedLocationTerms.length) {
    score += Math.min(12, matchedLocationTerms.length * 4);
    reasons.push('location evidence');
  }
  if (official) { score += 32; reasons.push('official domain'); }
  if (profile.preferred.test(metadata)) { score += 13; reasons.push(`${profile.key} scene metadata`); }
  if (profile.penalised.test(metadata)) { score -= 18; reasons.push('less representative subject metadata'); }
  if (stockTerms.test(metadata)) { score -= 28; reasons.push('generic stock/directory source'); }
  if (peopleDominatedTerms.test(metadata)) { score -= 18; reasons.push('person-dominated metadata'); }
  if (profile.key === 'cafe' && cafeDetailTerms.test(title) && !/interior|exterior|inside|seating|storefront|venue/i.test(title)) {
    score -= 22;
    reasons.push('food/drink detail rather than venue');
  }

  return {
    index,
    score,
    rejected: rejectReasons.length > 0,
    reject_reasons: rejectReasons,
    reasons,
    profile: profile.key,
    exact_name: exactName,
    official,
    matched_name_terms: matchedNameTerms,
    matched_location_terms: matchedLocationTerms,
    source_domain: candidateHost(candidate.link) || candidateHost(candidate.original),
  };
}

export function imageCacheKey(activityId, candidateIndex, url) {
  return `${activityId}/${candidateIndex}-${createHash('sha1').update(String(url)).digest('hex').slice(0, 12)}.jpg`;
}

export function assessDownloadedImageQuality({ width, height, entropy, sharpness }) {
  const shortest = Math.min(Number(width || 0), Number(height || 0));
  const ratio = Number(width || 1) / Math.max(1, Number(height || 1));
  const rejectReasons = [];
  const reasons = [];
  let score = 0;
  if (shortest < 400) rejectReasons.push('downloaded_dimensions_too_small');
  else if (shortest >= 1000) { score += 18; reasons.push('high resolution'); }
  else if (shortest >= 640) { score += 12; reasons.push('good resolution'); }
  else score += 5;
  if (ratio < 0.5 || ratio > 2.8) rejectReasons.push('downloaded_extreme_aspect_ratio');
  else if (ratio >= 1.15 && ratio <= 2.1) score += 7;
  if (Number(entropy || 0) < 1.45) rejectReasons.push('likely_logo_or_blank_graphic');
  else if (entropy < 2.1) { score -= 10; reasons.push('low visual entropy'); }
  else if (entropy >= 3.5 && entropy <= 7.8) { score += 6; reasons.push('photographic detail'); }
  if (Number(sharpness || 0) > 0 && sharpness < 0.7) rejectReasons.push('downloaded_image_too_soft');
  else if (sharpness >= 2) { score += 5; reasons.push('good sharpness'); }
  return { score, rejected: rejectReasons.length > 0, reject_reasons: rejectReasons, reasons };
}

export function hammingDistance(left, right) {
  if (!left || !right || left.length !== right.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const value = Number.parseInt(left[index], 16) ^ Number.parseInt(right[index], 16);
    distance += value.toString(2).replaceAll('0', '').length;
  }
  return distance;
}

export function chooseShortlist(assessments, maximum = 5, minimum = 3) {
  const available = assessments.filter((entry) => !entry.rejected && !entry.download_failed)
    .sort((left, right) => right.total_score - left.total_score || left.index - right.index);
  const competitiveScoreFloor = available.length ? available[0].total_score - 18 : Number.NEGATIVE_INFINITY;
  const selected = [];
  for (const entry of available) {
    if (selected.length >= minimum && entry.total_score < competitiveScoreFloor) break;
    const duplicate = selected.some((kept) => hammingDistance(kept.perceptual_hash, entry.perceptual_hash) <= 5);
    if (duplicate) {
      entry.rejected = true;
      entry.reject_reasons.push('near_duplicate');
      continue;
    }
    selected.push(entry);
    if (selected.length >= maximum) break;
  }
  if (selected.length < minimum) {
    const fallbacks = assessments
      .filter((entry) => !entry.download_failed && !selected.includes(entry)
        && !entry.reject_reasons.includes('invalid_original_url')
        && !entry.reject_reasons.includes('very_small_dimensions')
        && !entry.reject_reasons.includes('extreme_aspect_ratio')
        && !entry.reject_reasons.includes('graphic_or_document_metadata')
        && !entry.reject_reasons.includes('wikimedia_category_not_allowed')
        && !entry.reject_reasons.includes('downloaded_dimensions_too_small')
        && !entry.reject_reasons.includes('downloaded_extreme_aspect_ratio')
        && !entry.reject_reasons.includes('downloaded_image_too_soft')
        && !entry.reject_reasons.includes('likely_logo_or_blank_graphic'))
      .sort((left, right) => right.total_score - left.total_score || left.index - right.index);
    for (const entry of fallbacks) {
      if (selected.some((kept) => hammingDistance(kept.perceptual_hash, entry.perceptual_hash) <= 5)) continue;
      selected.push(entry);
      if (selected.length >= Math.min(minimum, assessments.length)) break;
    }
  }
  return selected;
}
