function normalise(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function host(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function hasSpecificSourcePath(value) {
  try {
    const path = new URL(String(value)).pathname.replace(/\/+$/, '');
    return path.length > 1 && !/^\/(?:index(?:\.[a-z]+)?|home(?:\.[a-z]+)?)$/i.test(path);
  } catch {
    return false;
  }
}

function compact(value) {
  return normalise(value).replaceAll(' ', '');
}

const ignoredTerms = new Set([
  'activity', 'activities', 'baby', 'babies', 'child', 'children', 'class', 'classes',
  'club', 'event', 'events', 'family', 'families', 'for', 'from', 'group', 'kids',
  'london', 'play', 'session', 'the', 'this', 'toddlers', 'toddler', 'with', 'workshop',
]);

function activityTerms(activity) {
  return [...new Set(normalise(activity.activity_name).split(' ')
    .filter((term) => term.length >= 4 && !ignoredTerms.has(term)))];
}

function score(results, label) {
  return Number(results.find((result) => result.label === label)?.score || 0);
}

function profileForCategory(category) {
  const value = normalise(category);
  if (/play cafe|cafe|coffee|food|bakery|restaurant/.test(value)) {
    return {
      key: 'cafe',
      labels: [
        'a clear interior photo of this cafe or play cafe',
        'a clear exterior photo of this cafe or play cafe',
        'a clear photo of food or drink from this cafe',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this cafe or play cafe',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1, 2],
      rejected: [3, 4, 5],
    };
  }
  if (/museum|culture/.test(value)) {
    return {
      key: 'museum',
      labels: [
        'a clear exterior photo of this museum, gallery, or cultural venue',
        'a clear interior photo of this museum, gallery, or cultural venue',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this museum or cultural venue',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1],
      rejected: [2, 3, 4],
    };
  }
  if (/bookshop|book store|bookstore/.test(value)) {
    return {
      key: 'bookshop',
      labels: [
        'a clear exterior photo of this bookshop',
        'a clear interior photo of this bookshop or reading space',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this bookshop',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1],
      rejected: [2, 3, 4],
    };
  }
  if (/park|outdoor/.test(value)) {
    return {
      key: 'park',
      labels: [
        'a clear photo of this park, playground, or outdoor play space',
        'children or families taking part in this outdoor activity',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this park or outdoor activity',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1],
      rejected: [2, 3, 4],
    };
  }
  if (/swim/.test(value)) {
    return {
      key: 'swim',
      labels: [
        'a clear photo of this swimming pool or baby swimming class',
        'children or families taking part in this swimming activity',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this swimming activity',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1],
      rejected: [2, 3, 4],
    };
  }
  if (/movement|wellbeing/.test(value)) {
    return {
      key: 'movement',
      labels: [
        'people taking part in this child-friendly class or activity',
        'a clear photo of this activity venue or studio',
        'a company logo, graphic, flyer, poster, or social media image',
        'a photo unrelated to this child-friendly activity',
        'a low quality, pixelated, or heavily cropped image',
      ],
      preferred: [0, 1],
      rejected: [2, 3, 4],
    };
  }
  return {
    key: 'general',
    labels: [
      'children or families taking part in this child-friendly activity',
      'a clear photo of this child-friendly venue or activity space',
      'a company logo, graphic, flyer, poster, or social media image',
      'a photo unrelated to this child-friendly activity',
      'a low quality, pixelated, or heavily cropped image',
    ],
    preferred: [0, 1],
    rejected: [2, 3, 4],
  };
}

export function sourceConfidence(activity) {
  const source = String(activity.image_source_url || '');
  const text = normalise(source);
  const terms = activityTerms(activity);
  const matchedTerms = terms.filter((term) => text.includes(term));
  const sourceHost = host(source);
  const officialHosts = [activity.website, activity.organiser_website].map(host).filter(Boolean);
  const official = Boolean(sourceHost && officialHosts.some((value) => sourceHost === value || sourceHost.endsWith(`.${value}`)));
  const brand = compact(activity.activity_name);
  const compactHost = compact(sourceHost);
  const brandedOfficialHost = Boolean(official && brand.length >= 4 && compactHost.includes(brand));
  const specificSourcePath = hasSpecificSourcePath(source);
  const highConfidence = official && (matchedTerms.length >= 2
    || (brandedOfficialHost && specificSourcePath && matchedTerms.length >= 1));
  return { highConfidence, official, brandedOfficialHost, specificSourcePath, matchedTerms, terms };
}

function visualAssessment(activity, results) {
  const profile = profileForCategory(activity.category);
  const preferredScores = profile.preferred.map((index) => score(results, profile.labels[index]));
  const bestPreferredIndex = preferredScores.reduce((best, value, index) => (
    value > preferredScores[best] ? index : best
  ), 0);
  const preferredLabelIndex = profile.preferred[bestPreferredIndex];
  const accepted = preferredScores[bestPreferredIndex];
  const rejected = Math.max(...profile.rejected.map((index) => score(results, profile.labels[index])));
  const highConfidence = accepted >= 0.46 && accepted >= rejected + 0.14;
  return {
    profile,
    accepted,
    rejected,
    preferred_label_index: preferredLabelIndex,
    preferred_label: profile.labels[preferredLabelIndex],
    preference_rank: profile.preferred.length - bestPreferredIndex,
    highConfidence,
  };
}

export function labelsForSerpApiImageAudit(activity) {
  return profileForCategory(activity.category).labels;
}

export function assessSerpApiImageConfidence(activity, results) {
  const visual = visualAssessment(activity, results);
  const source = sourceConfidence(activity);
  if (!source.highConfidence) {
    return {
      outcome: 'remove',
      reason: 'Image provenance does not contain enough distinctive activity evidence.',
      source,
      accepted_score: visual.accepted,
      rejected_score: visual.rejected,
    };
  }
  if (!visual.highConfidence) {
    return {
      outcome: 'remove',
      reason: 'Image pixels do not clearly match the activity category or venue.',
      source,
      accepted_score: visual.accepted,
      rejected_score: visual.rejected,
    };
  }
  return {
    outcome: 'retain',
    reason: `Strong provenance and visual category match: ${visual.preferred_label}.`,
    source,
    accepted_score: visual.accepted,
    rejected_score: visual.rejected,
  };
}

function candidateText(candidate) {
  return normalise([candidate.original, candidate.thumbnail, candidate.title, candidate.source, candidate.link].filter(Boolean).join(' '));
}

function candidateProvenance(activity, candidate) {
  const text = candidateText(candidate);
  const terms = activityTerms(activity);
  const matchedTerms = terms.filter((term) => text.includes(term));
  const title = normalise(activity.activity_name);
  const exactTitle = title.length >= 5 && text.includes(title);
  const officialHosts = [activity.website, activity.organiser_website].map(host).filter(Boolean);
  const candidateHosts = [candidate.original, candidate.link, candidate.source].map(host).filter(Boolean);
  const official = candidateHosts.some((candidateHost) => officialHosts.some((officialHost) => (
    candidateHost === officialHost || candidateHost.endsWith(`.${officialHost}`)
  )));
  // Strong title evidence is accepted only when there are at least two
  // distinctive terms. One-word names such as "Momentum" need an official host.
  const titleEvidence = exactTitle && terms.length >= 2 && matchedTerms.length >= 2;
  return {
    highConfidence: official || titleEvidence,
    official,
    exactTitle,
    matchedTerms,
    terms,
  };
}

function resolutionScore(candidate) {
  const width = Number(candidate.original_width || 0);
  const height = Number(candidate.original_height || 0);
  const shortest = Math.min(width, height);
  if (!shortest) return 0;
  if (shortest >= 800) return 20;
  if (shortest >= 500) return 12;
  if (shortest >= 300) return 4;
  return -30;
}

export function assessSerpApiCandidate(activity, candidate, results) {
  const visual = visualAssessment(activity, results);
  const provenance = candidateProvenance(activity, candidate);
  const confidence = Number(((visual.accepted + (provenance.official ? 0.2 : 0.08)) / 1.2).toFixed(4));
  if (!provenance.highConfidence) {
    return { outcome: 'remove', reason: 'Candidate lacks official-source or distinctive-title evidence.', provenance, visual, confidence };
  }
  if (!visual.highConfidence) {
    return { outcome: 'remove', reason: 'Candidate is a logo, unrelated, low quality, or not clearly representative.', provenance, visual, confidence };
  }
  return {
    outcome: 'retain',
    reason: `High-confidence ${visual.preferred_label}.`,
    provenance,
    visual,
    confidence,
  };
}

export function chooseBestSerpApiCandidate(activity, candidates, candidateResults) {
  const assessed = candidates.map((candidate, index) => ({
    candidate,
    index,
    assessment: assessSerpApiCandidate(activity, candidate, candidateResults[index] || []),
  }));
  const retained = assessed.filter((entry) => entry.assessment.outcome === 'retain');
  retained.sort((left, right) => {
    const leftScore = left.assessment.visual.preference_rank * 1000
      + left.assessment.confidence * 100
      + (left.assessment.provenance.official ? 30 : 0)
      + resolutionScore(left.candidate)
      - Number(left.candidate.position || left.index + 1);
    const rightScore = right.assessment.visual.preference_rank * 1000
      + right.assessment.confidence * 100
      + (right.assessment.provenance.official ? 30 : 0)
      + resolutionScore(right.candidate)
      - Number(right.candidate.position || right.index + 1);
    return rightScore - leftScore;
  });
  return { selection: retained[0] || null, assessed };
}

export function serpApiImageAuditSummary(rows) {
  return rows.reduce((summary, row) => {
    summary[row.assessment.outcome] = (summary[row.assessment.outcome] || 0) + 1;
    return summary;
  }, { retain: 0, remove: 0, failed: 0 });
}
