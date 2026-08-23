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

  // A single word on an official home page is not enough on its own. It can
  // identify the company while still pointing at an unrelated campaign image.
  // A matching name on a third-party page is still too easy to confuse with
  // a similarly named venue. Only a listing or organiser domain can supply
  // the provenance needed for a card image to remain in the top image slot.
  const highConfidence = official && (matchedTerms.length >= 2
    || (brandedOfficialHost && specificSourcePath && matchedTerms.length >= 1));
  return { highConfidence, official, brandedOfficialHost, specificSourcePath, matchedTerms, terms };
}

function categoryProfile(category) {
  const value = normalise(category);
  if (/play cafe|cafe|coffee|food|bakery|restaurant/.test(value)) {
    return {
      labels: [
        'a clear interior or exterior photo of a cafe or restaurant',
        'a clear interior or exterior photo of a children play cafe',
        'a close-up of food or drink',
        'a photo of a wild animal or zoo animal',
        'a photo unrelated to a cafe or restaurant',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1, 2],
      rejected: [3, 4, 5],
    };
  }
  if (/museum|culture/.test(value)) {
    return {
      labels: [
        'a clear exterior or interior photo of a museum, gallery, or cultural venue',
        'a museum display or exhibition space',
        'a photo unrelated to a museum or cultural venue',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1],
      rejected: [2, 3],
    };
  }
  if (/bookshop|book store|bookstore/.test(value)) {
    return {
      labels: [
        'a clear exterior or interior photo of a bookshop',
        'bookshelves or a bookshop reading space',
        'a photo unrelated to a bookshop',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1],
      rejected: [2, 3],
    };
  }
  if (/park|outdoor/.test(value)) {
    return {
      labels: [
        'a clear photo of a park, playground, or outdoor play space',
        'children or families taking part in an outdoor activity',
        'a photo unrelated to a park or outdoor activity',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1],
      rejected: [2, 3],
    };
  }
  if (/swim/.test(value)) {
    return {
      labels: [
        'a clear photo of a swimming pool or baby swimming class',
        'children or families taking part in a swimming activity',
        'a photo unrelated to a swimming activity',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1],
      rejected: [2, 3],
    };
  }
  if (/movement|wellbeing/.test(value)) {
    return {
      labels: [
        'people taking part in a yoga, pilates, dance, or fitness class',
        'a clear interior photo of a fitness or movement studio',
        'a photo unrelated to a movement or wellbeing activity',
        'a company logo, graphic, flyer, poster, or social media image',
      ],
      accepted: [0, 1],
      rejected: [2, 3],
    };
  }
  return {
    labels: [
      'children or families taking part in a child-friendly activity',
      'a clear photo of a child-friendly venue or activity space',
      'a photo unrelated to a child-friendly activity',
      'a company logo, graphic, flyer, poster, or social media image',
    ],
    accepted: [0, 1],
    rejected: [2, 3],
  };
}

function score(results, label) {
  return Number(results.find((result) => result.label === label)?.score || 0);
}

export function labelsForSerpApiImageAudit(activity) {
  return categoryProfile(activity.category).labels;
}

export function assessSerpApiImageConfidence(activity, results) {
  const profile = categoryProfile(activity.category);
  const accepted = Math.max(...profile.accepted.map((index) => score(results, profile.labels[index])));
  const rejected = Math.max(...profile.rejected.map((index) => score(results, profile.labels[index])));
  const source = sourceConfidence(activity);
  const visualHighConfidence = accepted >= 0.42 && accepted >= rejected + 0.12;

  if (!source.highConfidence) {
    return {
      outcome: 'remove',
      reason: 'Image provenance does not contain enough distinctive activity evidence.',
      source,
      accepted_score: accepted,
      rejected_score: rejected,
    };
  }
  if (!visualHighConfidence) {
    return {
      outcome: 'remove',
      reason: 'Image pixels do not clearly match the activity category or venue.',
      source,
      accepted_score: accepted,
      rejected_score: rejected,
    };
  }
  return {
    outcome: 'retain',
    reason: 'Strong provenance and visual category match.',
    source,
    accepted_score: accepted,
    rejected_score: rejected,
  };
}

export function serpApiImageAuditSummary(rows) {
  return rows.reduce((summary, row) => {
    summary[row.assessment.outcome] = (summary[row.assessment.outcome] || 0) + 1;
    return summary;
  }, { retain: 0, remove: 0, failed: 0 });
}
