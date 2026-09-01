const blockedAssetTerms = /(favicon|icon|logo|wordmark|brand|badge|avatar|social[-_ ]?(?:icon|link|media)|facebook|fbcdn|scontent|cdninstagram|instagram|twitter|twimg|tiktok|linkedin|pinterest|youtube|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|sprite)/i;
const weakImageTerms = /(thumb(?:nail)?|small|tiny|low[-_ ]?res|cropped|avatar|profile|header|banner)/i;
const stopWords = new Set(['a', 'an', 'and', 'at', 'by', 'for', 'from', 'in', 'london', 'of', 'on', 'the', 'to', 'uk', 'with']);
const cafeSceneTerms = /(cafe|coffee|bakery|interior|inside|seating|tables?|chairs?|terrace|exterior|shopfront|counter)/i;
const parkSceneTerms = /(park|playground|garden|field|green|slide|swings?|climbing|outdoor|play area)/i;
const generalSceneTerms = /(interior|exterior|inside|outside|venue|room|studio|class|activity|children|famil|play|seating|view)/i;
const socialDomains = /(instagram|facebook|pinterest|tiktok)\./i;
const directoryDomains = /(tripadvisor|wheree|yelp|foursquare|restaurantguru|wanderlog|corner\.inc)/i;
const authorityDomains = /(\.gov\.uk$|\.org\.uk$|visitlondon|goparks\.london|wikipedia|wikimedia|geograph)/i;

export const TAGGED_IMAGE_MODEL_NAME = 'Tiny Outings learned cross-source image ranker';
export const TAGGED_IMAGE_MODEL_VERSION = 'cross-source-ranker-v2';

export const AUTOMATIC_IMAGE_SOURCE_FIELDS = [
  'audit_image_url',
  'scraped_image_url',
  'organiser_website_downloaded_image',
  'website_downloaded_image',
  'wikimedia_image_url',
  'website_image_url',
  'listing_image_url',
];

const sourceFeatureNames = [
  'source_google_images',
  'source_website_candidate',
  'source_audit_replacement',
  'source_scraped_audit_pass',
  'source_organiser_download',
  'source_website_download',
  'source_wikimedia',
  'source_website_url',
  'source_listing_url',
];

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
  'source_kind_preference',
  'importer_source_preference',
  'category_source_preference',
  'visual_approved',
  'visual_rejected',
  'audit_approved',
  'image_url_quality',
  'descriptive_title',
  ...sourceFeatureNames,
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

function secureUrl(value) {
  return clean(value).replace(/^http:\/\//i, 'https://');
}

function sourceKindForField(field) {
  return ({
    audit_image_url: 'audit_replacement',
    scraped_image_url: 'scraped_audit_pass',
    organiser_website_downloaded_image: 'organiser_website_download',
    website_downloaded_image: 'website_download',
    wikimedia_image_url: 'wikimedia',
    website_image_url: 'website_image_url',
    listing_image_url: 'listing_image_url',
  })[field] || 'stored_source';
}

function sourcePageForField(activity, field, imageUrl) {
  if (field === 'audit_image_url') return clean(activity?.audit_image_source_url) || imageUrl;
  if (field === 'scraped_image_url') return clean(activity?.image_source_url) || imageUrl;
  if (field === 'organiser_website_downloaded_image') return clean(activity?.organiser_website || activity?.website) || imageUrl;
  if (field === 'website_downloaded_image') return clean(activity?.website || activity?.source_url) || imageUrl;
  if (field === 'wikimedia_image_url') return imageUrl;
  return clean(activity?.image_source_url || activity?.website || activity?.source_url) || imageUrl;
}

function exactAuditApproval(activity, field, imageUrl) {
  if (field === 'audit_image_url') return clean(activity?.audit_image_status) === 'replaced';
  return field === 'scraped_image_url'
    && clean(activity?.audit_image_status) === 'pass'
    && clean(activity?.audit_image_original_source_field) === field
    && secureUrl(activity?.audit_image_original_url) === secureUrl(imageUrl);
}

function exactAuditRejection(activity, field, imageUrl) {
  return ['needs_replacement', 'no_replacement'].includes(clean(activity?.audit_image_status))
    && clean(activity?.audit_image_original_source_field) === field
    && secureUrl(activity?.audit_image_original_url) === secureUrl(imageUrl);
}

function storedFieldIsEligible(activity, field, imageUrl) {
  if (!validHttpUrl(imageUrl)) return false;
  if (field === 'audit_image_url' && !exactAuditApproval(activity, field, imageUrl)) return false;
  if (field === 'scraped_image_url' && !exactAuditApproval(activity, field, imageUrl)) return false;
  if (field === 'wikimedia_image_url' && !allowsWikimedia(activity)) return false;
  if (!allowsWikimedia(activity) && isWikimedia({ image_url: imageUrl, source_page_url: sourcePageForField(activity, field, imageUrl) })) return false;
  return !exactAuditRejection(activity, field, imageUrl);
}

function storedFieldVisualEvidence(activity, field, imageUrl) {
  if (exactAuditApproval(activity, field, imageUrl)) {
    return { visual_status: 'approved', visual_reason: `The exact ${field} image passed the image audit.`, audit_approved: true };
  }
  if (['organiser_website_downloaded_image', 'website_downloaded_image'].includes(field)
    && clean(activity?.website_image_vision_status) === 'selected') {
    return { visual_status: 'approved', visual_reason: clean(activity?.website_image_vision_reason) || 'Selected by the website-image vision review.' };
  }
  if (exactAuditRejection(activity, field, imageUrl)) {
    return { visual_status: 'rejected', visual_reason: 'The exact image was rejected by the image audit.' };
  }
  return { visual_status: 'unreviewed', visual_reason: null };
}

function arrayCandidateVisualEvidence(activity, candidateSource, index) {
  if (candidateSource === 'google_images'
    && clean(activity?.serpapi_image_vision_status) === 'selected'
    && Number(activity?.serpapi_image_vision_candidate_index) === index) {
    return { visual_status: 'approved', visual_reason: clean(activity?.serpapi_image_vision_reason) || 'Selected by the Google Images vision review.' };
  }
  if (candidateSource === 'official_website_candidate'
    && clean(activity?.website_image_vision_status) === 'selected'
    && Number(activity?.website_image_vision_candidate_index) === index) {
    return { visual_status: 'approved', visual_reason: clean(activity?.website_image_vision_reason) || 'Selected by the website-image vision review.' };
  }
  return { visual_status: 'unreviewed', visual_reason: null };
}

export function normalizeStoredCandidate(value, index = 0, defaults = {}) {
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
    candidate_set_index: value.candidate_set_index != null && Number.isInteger(Number(value.candidate_set_index)) ? Number(value.candidate_set_index) : index,
    source_position: (value.source_position ?? value.position) != null && Number.isInteger(Number(value.source_position ?? value.position))
      ? Number(value.source_position ?? value.position) : null,
    candidate_source: clean(value.candidate_source || value.source_kind || defaults.candidateSource) || 'google_images',
    source_field: clean(value.source_field || defaults.sourceField) || null,
    visual_status: clean(value.visual_status || defaults.visualStatus) || 'unreviewed',
    visual_reason: clean(value.visual_reason || defaults.visualReason) || null,
    visual_confidence: Number.isFinite(Number(value.visual_confidence ?? defaults.visualConfidence))
      ? Number(value.visual_confidence ?? defaults.visualConfidence) : null,
    audit_approved: value.audit_approved === true || defaults.auditApproved === true,
  };
}

export function storedCandidateSet(activity, maximumCandidates = 20) {
  const codexCandidates = Array.isArray(activity?.codex_image_candidates) ? activity.codex_image_candidates : [];
  const legacyCandidates = Array.isArray(activity?.serpapi_image_candidates) ? activity.serpapi_image_candidates : [];
  const websiteCandidates = Array.isArray(activity?.website_image_candidates) ? activity.website_image_candidates : [];
  const source = codexCandidates.length ? codexCandidates : legacyCandidates.length ? legacyCandidates : websiteCandidates;
  const candidateSource = source === websiteCandidates ? 'official_website_candidate' : 'google_images';
  return source.slice(0, maximumCandidates)
    .map((candidate, index) => {
      const visual = arrayCandidateVisualEvidence(activity, candidateSource, index);
      return normalizeStoredCandidate(candidate, index, {
        candidateSource,
        visualStatus: visual.visual_status,
        visualReason: visual.visual_reason,
      });
    })
    .filter(Boolean);
}

function storedFieldCandidate(activity, field) {
  const imageUrl = secureUrl(activity?.[field]);
  if (!storedFieldIsEligible(activity, field, imageUrl)) return null;
  const sourcePageUrl = sourcePageForField(activity, field, imageUrl);
  const visual = storedFieldVisualEvidence(activity, field, imageUrl);
  return normalizeStoredCandidate({
    image_url: imageUrl,
    thumbnail_url: imageUrl,
    source_page_url: sourcePageUrl,
    source_domain: candidateDomain(sourcePageUrl) || candidateDomain(imageUrl),
    title: field.replaceAll('_', ' '),
    relevance_reason: `Existing listing image from ${field}.`,
    candidate_source: sourceKindForField(field),
    source_field: field,
    source_position: null,
    ...visual,
  }, 0, {
    candidateSource: sourceKindForField(field),
    sourceField: field,
    visualStatus: visual.visual_status,
    visualReason: visual.visual_reason,
    auditApproved: visual.audit_approved,
  });
}

function mergeCandidate(existing, candidate) {
  const preferred = candidate.source_field && !existing.source_field ? candidate : existing;
  const other = preferred === existing ? candidate : existing;
  const approved = [preferred, other].find((row) => row.visual_status === 'approved');
  return {
    ...other,
    ...preferred,
    width: preferred.width || other.width || null,
    height: preferred.height || other.height || null,
    thumbnail_url: preferred.thumbnail_url || other.thumbnail_url || null,
    source_page_url: preferred.source_page_url || other.source_page_url || null,
    source_domain: preferred.source_domain || other.source_domain || null,
    visual_status: approved ? 'approved' : (preferred.visual_status === 'rejected' && other.visual_status === 'rejected' ? 'rejected' : 'unreviewed'),
    visual_reason: approved?.visual_reason || preferred.visual_reason || other.visual_reason || null,
    visual_confidence: approved?.visual_confidence || preferred.visual_confidence || other.visual_confidence || null,
    audit_approved: preferred.audit_approved || other.audit_approved || false,
  };
}

export function crossSourceCandidateSet(activity, maximumCandidates = 100) {
  const direct = AUTOMATIC_IMAGE_SOURCE_FIELDS.map((field) => storedFieldCandidate(activity, field)).filter(Boolean);
  const googleSource = Array.isArray(activity?.codex_image_candidates) && activity.codex_image_candidates.length
    ? activity.codex_image_candidates
    : Array.isArray(activity?.serpapi_image_candidates) ? activity.serpapi_image_candidates : [];
  const google = googleSource.map((candidate, index) => {
    const visual = arrayCandidateVisualEvidence(activity, 'google_images', index);
    return normalizeStoredCandidate(candidate, index, {
      candidateSource: 'google_images',
      visualStatus: visual.visual_status,
      visualReason: visual.visual_reason,
    });
  }).filter(Boolean);
  const website = (Array.isArray(activity?.website_image_candidates) ? activity.website_image_candidates : [])
    .map((candidate, index) => {
      const visual = arrayCandidateVisualEvidence(activity, 'official_website_candidate', index);
      return normalizeStoredCandidate(candidate, index, {
        candidateSource: 'official_website_candidate',
        visualStatus: visual.visual_status,
        visualReason: visual.visual_reason,
      });
    }).filter(Boolean);
  const deduplicated = new Map();
  for (const candidate of [...direct, ...google, ...website]) {
    const key = secureUrl(candidate.image_url);
    if (!key) continue;
    deduplicated.set(key, deduplicated.has(key) ? mergeCandidate(deduplicated.get(key), candidate) : candidate);
  }
  return [...deduplicated.values()].slice(0, maximumCandidates)
    .map((candidate, index) => ({ ...candidate, candidate_set_index: index }));
}

function candidateEligible(activity, candidate) {
  const combined = [candidate.image_url, candidate.thumbnail_url, candidate.source_page_url, candidate.title].filter(Boolean).join(' ');
  if (blockedAssetTerms.test(combined)) return false;
  if (candidate.visual_status === 'rejected') return false;
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

function sourceFeatureObject(sourceKind) {
  const featureBySource = {
    google_images: 'source_google_images',
    official_website_candidate: 'source_website_candidate',
    audit_replacement: 'source_audit_replacement',
    scraped_audit_pass: 'source_scraped_audit_pass',
    organiser_website_download: 'source_organiser_download',
    website_download: 'source_website_download',
    wikimedia: 'source_wikimedia',
    website_image_url: 'source_website_url',
    listing_image_url: 'source_listing_url',
  };
  return Object.fromEntries(sourceFeatureNames.map((name) => [name, featureBySource[sourceKind] === name ? 1 : 0]));
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
  const importer = clean(activity?.source_name).toLowerCase() || 'unknown';
  const sourceKind = clean(candidate.candidate_source) || 'google_images';
  const sourcePosition = candidate.source_position != null && Number.isInteger(Number(candidate.source_position))
    ? Number(candidate.source_position) : null;
  const nameTokens = tokens(activity?.activity_name);
  const locationTokens = tokens([activity?.address, activity?.borough, activity?.postcode].filter(Boolean).join(' '));
  const titleTokens = tokens(title);
  const official = officialDomains(activity);
  return {
    bias: 1,
    inverse_position: sourcePosition == null ? 0 : 1 / (sourcePosition + 1),
    top_1: sourcePosition === 0 ? 1 : 0,
    top_3: sourcePosition != null && sourcePosition < 3 ? 1 : 0,
    top_6: sourcePosition != null && sourcePosition < 6 ? 1 : 0,
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
    source_kind_preference: domainStat(stats.sourceKind, sourceKind),
    importer_source_preference: domainStat(stats.importerSource, `${importer}|${sourceKind}`),
    category_source_preference: domainStat(stats.categorySource, `${category}|${sourceKind}`),
    visual_approved: candidate.visual_status === 'approved' ? 1 : 0,
    visual_rejected: candidate.visual_status === 'rejected' ? 1 : 0,
    audit_approved: candidate.audit_approved ? 1 : 0,
    image_url_quality: weakImageTerms.test(imageUrl) ? -1 : 1,
    descriptive_title: clamp(titleTokens.size / 9, 0, 1),
    ...sourceFeatureObject(sourceKind),
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
    const candidates = crossSourceCandidateSet(activity);
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
  const sourceKind = createStats();
  const importerSource = createStats();
  const categorySource = createStats();
  for (const group of groups) {
    const category = normalizedCategory(group.activity.category);
    const importer = clean(group.activity.source_name).toLowerCase() || 'unknown';
    group.candidates.forEach((candidate, index) => {
      const host = rootDomain(candidate.source_page_url || candidate.source_domain || candidate.image_url);
      const candidateSource = clean(candidate.candidate_source) || 'google_images';
      for (const [map, key] of [
        [domain, host],
        [categoryDomain, `${category}|${host}`],
        [sourceKind, candidateSource],
        [importerSource, `${importer}|${candidateSource}`],
        [categorySource, `${category}|${candidateSource}`],
      ]) {
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
  return { domain, categoryDomain, sourceKind, importerSource, categorySource };
}

function trainingFingerprint(groups) {
  let hash = 2166136261;
  const values = groups.map((group) => `${group.reviewId}|${group.candidates[group.selectedIndex]?.image_url || ''}`).sort();
  for (const value of values.join('\n')) {
    hash ^= value.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
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
    version: `${TAGGED_IMAGE_MODEL_VERSION}-${trainingFingerprint(groups)}`,
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
  if (choice.candidate.visual_status === 'approved') evidence.push('visual assessment passed');
  if (choice.candidate.audit_approved) evidence.push('exact image audit passed');
  if (choice.features.official_source) evidence.push('official listing source');
  if (choice.features.title_name_overlap >= 0.4) evidence.push('strong name match');
  if (choice.features.title_location_overlap >= 0.4) evidence.push('location match');
  if (choice.features.cafe_scene_terms) evidence.push('cafe interior/seating context');
  if (choice.features.park_scene_terms) evidence.push('clear outdoor/play context');
  if (choice.features.log_pixels >= 0.55) evidence.push('high reported resolution');
  if (choice.features.card_aspect >= 0.8) evidence.push('useful card framing');
  if (choice.candidate.candidate_source) evidence.push(`best learned ${choice.candidate.candidate_source.replaceAll('_', ' ')} source`);
  if (!evidence.length) evidence.push(`result-position and source patterns from ${model.trainingReviewCount} manual choices`);
  const visualReason = clean(choice.candidate.visual_reason);
  return `Learned from ${model.trainingReviewCount} manual selections; ${evidence.slice(0, 4).join(', ')}.${visualReason ? ` Visual review: ${visualReason}` : ''}`;
}

function visualAssessmentFor(visualAssessments, imageUrl) {
  if (!visualAssessments) return null;
  if (visualAssessments instanceof Map) return visualAssessments.get(secureUrl(imageUrl)) || null;
  return visualAssessments[secureUrl(imageUrl)] || null;
}

function candidatesWithVisualAssessments(candidates, visualAssessments) {
  return candidates.map((candidate) => {
    const assessment = visualAssessmentFor(visualAssessments, candidate.image_url);
    return assessment ? { ...candidate, ...assessment } : candidate;
  });
}

function recommendationFromCandidates(activity, model, candidates, {
  requireVisualApproval = false,
  visualAssessments = null,
} = {}) {
  const assessedCandidates = candidatesWithVisualAssessments(candidates, visualAssessments);
  if (!assessedCandidates.length) return null;
  const excludedImageUrls = new Set((activity.automated_failed_image_urls || []).map(clean));
  const ranking = ranked({ activity, candidates: assessedCandidates }, model.weights, model.stats)
    .filter((row) => !excludedImageUrls.has(clean(row.candidate.image_url)))
    .filter((row) => !requireVisualApproval || row.candidate.visual_status === 'approved');
  if (!ranking.length) return null;
  const choice = ranking[0];
  const runnerUp = ranking[1];
  const gap = runnerUp ? choice.score - runnerUp.score : 2;
  const validationAccuracy = Number(model.metrics.top_1_accuracy) || 0.5;
  const learnedConfidence = clamp(0.34 + (0.36 * sigmoid(gap)) + (0.26 * validationAccuracy), 0.5, 0.97);
  const visualConfidence = choice.candidate.visual_confidence == null ? null : Number(choice.candidate.visual_confidence);
  const hasVisualConfidence = visualConfidence != null && Number.isFinite(visualConfidence);
  const confidence = hasVisualConfidence
    ? clamp((learnedConfidence * 0.45) + (visualConfidence * 0.55), 0.5, 0.97)
    : requireVisualApproval ? Math.min(learnedConfidence, 0.69) : learnedConfidence;
  const significantFeatures = Object.fromEntries(Object.entries(choice.features)
    .filter(([, value]) => Math.abs(Number(value)) >= 0.4));
  return {
    candidateIndex: Number.isInteger(choice.candidate.candidate_set_index) ? choice.candidate.candidate_set_index : choice.index,
    candidate: choice.candidate,
    normalizedCandidates: assessedCandidates,
    confidence: Number(confidence.toFixed(4)),
    reason: `${excludedImageUrls.size ? `Excluded ${excludedImageUrls.size} candidate${excludedImageUrls.size === 1 ? '' : 's'} that failed download validation. ` : ''}${recommendationReason(activity, choice, model)}`,
    featureSnapshot: {
      score: Number(choice.score.toFixed(5)),
      runner_up_score: runnerUp ? Number(runnerUp.score.toFixed(5)) : null,
      score_gap: Number(gap.toFixed(5)),
      eligible_candidate_count: ranking.length,
      selected_source: choice.candidate.candidate_source || null,
      selected_source_field: choice.candidate.source_field || null,
      visual_status: choice.candidate.visual_status || 'unreviewed',
      visual_confidence: hasVisualConfidence ? visualConfidence : null,
      significant_features: significantFeatures,
    },
  };
}

export function rankStoredCandidates(activity, model, { maximumCandidates = 20 } = {}) {
  const candidates = storedCandidateSet(activity, maximumCandidates);
  return recommendationFromCandidates(activity, model, candidates);
}

export function crossSourceCandidateRanking(activity, model, { maximumCandidates = 100 } = {}) {
  const candidates = crossSourceCandidateSet(activity, maximumCandidates);
  const excludedImageUrls = new Set((activity.automated_failed_image_urls || []).map(clean));
  return ranked({ activity, candidates }, model.weights, model.stats)
    .filter((row) => !excludedImageUrls.has(clean(row.candidate.image_url)))
    .map((row) => ({
      candidate: row.candidate,
      candidateIndex: row.candidate.candidate_set_index,
      score: Number(row.score.toFixed(5)),
      features: row.features,
    }));
}

export function rankCrossSourceCandidates(activity, model, {
  maximumCandidates = 100,
  requireVisualApproval = true,
  visualAssessments = null,
} = {}) {
  const candidates = crossSourceCandidateSet(activity, maximumCandidates);
  return recommendationFromCandidates(activity, model, candidates, { requireVisualApproval, visualAssessments });
}
