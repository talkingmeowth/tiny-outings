const blockedAssetTerms = /(favicon|icon|logo|wordmark|brand|badge|avatar|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|sprite)/i;
const weakImageTerms = /(thumb(?:nail)?|small|tiny|low[-_ ]?res|cropped|avatar|profile|header|banner)/i;
const stopWords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'london', 'of', 'on', 'the', 'to', 'uk', 'with']);
const cafeSceneTerms = /(cafe|coffee|bakery|interior|inside|seating|tables?|chairs?|terrace|exterior|shopfront|counter)/i;
const parkSceneTerms = /(park|playground|garden|field|green|slide|swings?|climbing|outdoor|play area)/i;
const generalSceneTerms = /(interior|exterior|inside|outside|venue|room|studio|class|activity|children|famil|play|seating|view)/i;
const socialDomains = /(instagram|facebook|pinterest|tiktok)\./i;
const directoryDomains = /(tripadvisor|wheree|yelp|foursquare|restaurantguru|wanderlog|corner\.inc)/i;
const authorityDomains = /(\.gov\.uk$|\.org\.uk$|visitlondon|goparks\.london|wikipedia|wikimedia|geograph)/i;

export const TAGGED_IMAGE_MODEL_NAME = 'Tiny Outings tagged-choice ranker';
export const TAGGED_IMAGE_MODEL_VERSION = 'tagged-ranker-v1';

export const FEATURE_NAMES = [
  'bias',
  'inverse_position',
  'top_1',
  'top_3',
  'top_6',
  'dimensions_known',
  'log_pixels',
  'minimum_side',
  'card_aspect',
  'landscape',
  'title_name_overlap',
  'title_location_overlap',
  'scene_terms',
  'cafe_scene_terms',
  'park_scene_terms',
  'official_source',
  'social_source',
  'directory_source',
  'authority_source',
  'domain_preference',
  'category_domain_preference',
  'image_url_quality',
  'descriptive_title',
];

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-Math.min(value, 40)));
  const exp = Math.exp(Math.max(value, -40));
  return exp / (1 + exp);
}

function validHttpUrl(value) {
  try {
    const url = new URL(clean(value));
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function candidateDomain(value) {
  try {
    return new URL(clean(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function rootDomain(value) {
  const host = candidateDomain(value) || clean(value).toLowerCase().replace(/^www\./, '');
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  if (['co', 'org', 'gov', 'ac'].includes(parts.at(-2))) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

function normalizedCategory(value) {
  return clean(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function allowsWikimedia(activity) {
  return ['parks and outdoor play', 'museums and culture', 'family activities'].includes(normalizedCategory(activity?.category));
}

function isWikimedia(candidate) {
  return [candidate.image_url, candidate.thumbnail_url, candidate.source_page_url, candidate.source_domain]
    .some((value) => /(wikimedia|wikipedia)/i.test(clean(value)));
}

export function normalizeStoredCandidate(value, index = 0) {
  if (!value || typeof value !== 'object') return null;
  const imageUrl = clean(value.image_url || value.original);
  if (!validHttpUrl(imageUrl)) return null;
  const thumbnailUrl = clean(value.thumbnail_url || value.thumbnail);
  const sourcePageUrl = clean(value.source_page_url || value.link);
  const width = Number(value.width ?? value.original_width);
  const height = Number(value.height ?? value.original_height);
  return {
    image_url: imageUrl,
    thumbnail_url: validHttpUrl(thumbnailUrl) ? thumbnailUrl : null,
    source_page_url: validHttpUrl(sourcePageUrl) ? sourcePageUrl : null,
    source_domain: clean(value.source_domain || value.source) || candidateDomain(sourcePageUrl) || candidateDomain(imageUrl),
    title: clean(value.title) || null,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
    relevance_reason: clean(value.relevance_reason) || `Google Images result ${Number(value.position) || index + 1}`,
  };
}

export function storedCandidateSet(activity) {
  const codexCandidates = Array.isArray(activity?.codex_image_candidates) ? activity.codex_image_candidates : [];
  const legacyCandidates = Array.isArray(activity?.serpapi_image_candidates) ? activity.serpapi_image_candidates : [];
  const source = codexCandidates.length ? codexCandidates : legacyCandidates;
  return source.slice(0, 20).map(normalizeStoredCandidate).filter(Boolean);
}

function candidateEligible(activity, candidate) {
  const combined = [candidate.image_url, candidate.thumbnail_url, candidate.source_page_url, candidate.title].filter(Boolean).join(' ');
  if (blockedAssetTerms.test(combined)) return false;
  if (!allowsWikimedia(activity) && isWikimedia(candidate)) return false;
  if (candidate.width && candidate.height) {
    if (Math.min(candidate.width, candidate.height) < 300) return false;
    if (candidate.width * candidate.height < 180000) return false;
  }
  return true;
}

function tokens(value) {
  return new Set(clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((token) => token.length > 1 && !stopWords.has(token)));
}

function overlap(left, right) {
  if (!left.size || !right.size) return 0;
  let matches = 0;
  for (const token of left) if (right.has(token)) matches += 1;
  return matches / Math.max(1, Math.min(left.size, right.size));
}

function domainStat(stats, key) {
  const row = stats.get(key);
  if (!row) return 0;
  const empirical = (row.selected + 1.5) / (row.exposed + 30);
  const baseline = (stats.selectedTotal + 1.5) / (stats.exposedTotal + 30);
  return clamp(Math.log(empirical / baseline) / 2, -1, 1);
}

function officialDomains(activity) {
  return new Set([activity?.website, activity?.organiser_website, activity?.source_url]
    .map(rootDomain).filter(Boolean));
}

function featureObject(activity, candidate, index, stats) {
  const width = Number(candidate.width) || 0;
  const height = Number(candidate.height) || 0;
  const pixels = width * height;
  const aspect = width && height ? width / height : 0;
  const title = clean(candidate.title);
  const imageUrl = clean(candidate.image_url);
  const sourceDomain = rootDomain(candidate.source_page_url || candidate.source_domain || imageUrl);
  const category = normalizedCategory(activity?.category);
  const nameTokens = tokens(activity?.activity_name);
  const locationTokens = tokens([activity?.address, activity?.borough, activity?.postcode].filter(Boolean).join(' '));
  const titleTokens = tokens(title);
  const official = officialDomains(activity);
  return {
    bias: 1,
    inverse_position: 1 / (index + 1),
    top_1: index === 0 ? 1 : 0,
    top_3: index < 3 ? 1 : 0,
    top_6: index < 6 ? 1 : 0,
    dimensions_known: pixels ? 1 : 0,
    log_pixels: pixels ? clamp((Math.log(pixels) - Math.log(180000)) / 5, 0, 1) : 0,
    minimum_side: width && height ? clamp(Math.min(width, height) / 1600, 0, 1) : 0,
    card_aspect: aspect ? Math.exp(-Math.abs(Math.log(aspect / 1.45))) : 0,
    landscape: aspect >= 1.05 ? 1 : 0,
    title_name_overlap: overlap(titleTokens, nameTokens),
    title_location_overlap: overlap(titleTokens, locationTokens),
    scene_terms: generalSceneTerms.test(title) ? 1 : 0,
    cafe_scene_terms: /(?:cafe|food|play cafe)/.test(category) && cafeSceneTerms.test(title) ? 1 : 0,
    park_scene_terms: /(?:park|outdoor)/.test(category) && parkSceneTerms.test(title) ? 1 : 0,
    official_source: official.has(sourceDomain) ? 1 : 0,
    social_source: socialDomains.test(sourceDomain) ? 1 : 0,
    directory_source: directoryDomains.test(sourceDomain) ? 1 : 0,
    authority_source: authorityDomains.test(sourceDomain) ? 1 : 0,
    domain_preference: domainStat(stats.domain, sourceDomain),
    category_domain_preference: domainStat(stats.categoryDomain, `${category}|${sourceDomain}`),
    image_url_quality: weakImageTerms.test(imageUrl) ? -1 : 1,
    descriptive_title: clamp(titleTokens.size / 9, 0, 1),
  };
}

function featureVector(object) {
  return FEATURE_NAMES.map((name) => Number(object[name]) || 0);
}

function dot(left, right) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index] * right[index];
  return total;
}

function deterministicBucket(value) {
  let hash = 2166136261;
  for (const char of clean(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 5;
}

export function taggedChoiceGroups(rows) {
  const groups = [];
  for (const row of rows || []) {
    const activity = row.activity || row;
    const candidates = storedCandidateSet(activity);
    const selectedUrl = clean(row.original_image_url || row.selected_image_url || row.reviewed_image_original_url);
    const selectedIndex = candidates.findIndex((candidate) => candidate.image_url === selectedUrl);
    if (candidates.length < 2 || selectedIndex < 0) continue;
    groups.push({ activity, candidates, selectedIndex, reviewId: row.manual_review_id || activity.activity_id });
  }
  return groups;
}

function preferenceStats(groups) {
  function createStats() {
    const stats = new Map();
    stats.exposedTotal = 0;
    stats.selectedTotal = 0;
    return stats;
  }
  const domain = createStats();
  const categoryDomain = createStats();
  for (const group of groups) {
    const category = normalizedCategory(group.activity.category);
    group.candidates.forEach((candidate, index) => {
      const host = rootDomain(candidate.source_page_url || candidate.source_domain || candidate.image_url);
      for (const [map, key] of [[domain, host], [categoryDomain, `${category}|${host}`]]) {
        if (!key) continue;
        const current = map.get(key) || { exposed: 0, selected: 0 };
        current.exposed += 1;
        if (index === group.selectedIndex) current.selected += 1;
        map.set(key, current);
        map.exposedTotal += 1;
        if (index === group.selectedIndex) map.selectedTotal += 1;
      }
    });
  }
  return { domain, categoryDomain };
}

function trainWeights(groups, stats, epochs = 260) {
  const pairs = [];
  for (const group of groups) {
    const selected = featureVector(featureObject(group.activity, group.candidates[group.selectedIndex], group.selectedIndex, stats));
    group.candidates.forEach((candidate, index) => {
      if (index === group.selectedIndex || !candidateEligible(group.activity, candidate)) return;
      const negative = featureVector(featureObject(group.activity, candidate, index, stats));
      pairs.push(selected.map((value, featureIndex) => value - negative[featureIndex]));
    });
  }
  const weights = Array(FEATURE_NAMES.length).fill(0);
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const learningRate = 0.045 / (1 + epoch / 80);
    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
      const pair = pairs[(pairIndex * 37 + epoch * 17) % pairs.length];
      const error = 1 - sigmoid(dot(weights, pair));
      for (let featureIndex = 0; featureIndex < weights.length; featureIndex += 1) {
        weights[featureIndex] += learningRate * ((error * pair[featureIndex]) - (0.0008 * weights[featureIndex]));
      }
    }
  }
  return weights;
}

function ranked(group, weights, stats) {
  return group.candidates.map((candidate, index) => ({
    candidate,
    index,
    eligible: candidateEligible(group.activity, candidate),
    features: featureObject(group.activity, candidate, index, stats),
  })).filter((row) => row.eligible)
    .map((row) => ({ ...row, score: dot(weights, featureVector(row.features)) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
}

function evaluate(groups, weights, stats) {
  if (!groups.length) return { evaluated_choices: 0, top_1_accuracy: null, top_3_recall: null, mean_reciprocal_rank: null };
  let top1 = 0;
  let top3 = 0;
  let reciprocalRank = 0;
  for (const group of groups) {
    const ranking = ranked(group, weights, stats);
    const position = ranking.findIndex((row) => row.index === group.selectedIndex);
    if (position === 0) top1 += 1;
    if (position >= 0 && position < 3) top3 += 1;
    if (position >= 0) reciprocalRank += 1 / (position + 1);
  }
  return {
    evaluated_choices: groups.length,
    top_1_accuracy: Number((top1 / groups.length).toFixed(4)),
    top_3_recall: Number((top3 / groups.length).toFixed(4)),
    mean_reciprocal_rank: Number((reciprocalRank / groups.length).toFixed(4)),
  };
}

export function trainTaggedImageRanker(rows) {
  const groups = taggedChoiceGroups(rows);
  if (groups.length < 20) throw new Error(`At least 20 matched manual reviews are required; found ${groups.length}.`);
  const validationGroups = groups.filter((group) => deterministicBucket(group.activity.activity_id) === 0);
  const trainingGroups = groups.filter((group) => deterministicBucket(group.activity.activity_id) !== 0);
  const validationStats = preferenceStats(trainingGroups);
  const validationWeights = trainWeights(trainingGroups, validationStats);
  const metrics = evaluate(validationGroups, validationWeights, validationStats);
  const stats = preferenceStats(groups);
  const weights = trainWeights(groups, stats);
  return {
    name: TAGGED_IMAGE_MODEL_NAME,
    version: TAGGED_IMAGE_MODEL_VERSION,
    trainingReviewCount: groups.length,
    weights,
    stats,
    metrics: {
      ...metrics,
      training_choices: trainingGroups.length,
      total_matched_choices: groups.length,
      feature_count: FEATURE_NAMES.length,
    },
  };
}

function recommendationReason(activity, choice, model) {
  const evidence = [];
  if (choice.features.official_source) evidence.push('official listing source');
  if (choice.features.title_name_overlap >= 0.4) evidence.push('strong name match');
  if (choice.features.title_location_overlap >= 0.4) evidence.push('location match');
  if (choice.features.cafe_scene_terms) evidence.push('cafe interior/seating context');
  if (choice.features.park_scene_terms) evidence.push('clear outdoor/play context');
  if (choice.features.log_pixels >= 0.55) evidence.push('high reported resolution');
  if (choice.features.card_aspect >= 0.8) evidence.push('useful card framing');
  if (!evidence.length) evidence.push(`result-position and source patterns from ${model.trainingReviewCount} manual choices`);
  return `Learned from ${model.trainingReviewCount} manual selections; ${evidence.slice(0, 3).join(', ')}.`;
}

export function rankStoredCandidates(activity, model) {
  const candidates = storedCandidateSet(activity);
  if (!candidates.length) return null;
  const excludedImageUrls = new Set((activity.automated_failed_image_urls || []).map(clean));
  const ranking = ranked({ activity, candidates }, model.weights, model.stats)
    .filter((row) => !excludedImageUrls.has(clean(row.candidate.image_url)));
  if (!ranking.length) return null;
  const choice = ranking[0];
  const runnerUp = ranking[1];
  const gap = runnerUp ? choice.score - runnerUp.score : 2;
  const validationAccuracy = Number(model.metrics.top_1_accuracy) || 0.5;
  const confidence = clamp(0.34 + (0.36 * sigmoid(gap)) + (0.26 * validationAccuracy), 0.5, 0.97);
  const significantFeatures = Object.fromEntries(Object.entries(choice.features)
    .filter(([, value]) => Math.abs(Number(value)) >= 0.4));
  return {
    candidateIndex: choice.index,
    candidate: choice.candidate,
    normalizedCandidates: candidates,
    confidence: Number(confidence.toFixed(4)),
    reason: `${excludedImageUrls.size ? `Excluded ${excludedImageUrls.size} candidate${excludedImageUrls.size === 1 ? '' : 's'} that failed download validation. ` : ''}${recommendationReason(activity, choice, model)}`,
    featureSnapshot: {
      score: Number(choice.score.toFixed(5)),
      runner_up_score: runnerUp ? Number(runnerUp.score.toFixed(5)) : null,
      score_gap: Number(gap.toFixed(5)),
      eligible_candidate_count: ranking.length,
      significant_features: significantFeatures,
    },
  };
}
