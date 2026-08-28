export const blockedWebsiteImageTerms = /(favicon|icon|logo|brandmark|wordmark|site-logo|badge|avatar|social[-_ ]?(?:icon|link|media)|facebook[.]com\/tr|facebook[.]net\/tr|twitter[0-9_-]*\.(?:png|jpe?g|webp)|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play|\/flags\/|site-flag|country-selector|language-selector|assets\/revamp\/pictures\/categories)/i;

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1] || null;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(String(value || '').replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function absoluteUrl(value, baseUrl) {
  if (!value) return null;
  try {
    const url = new URL(decodeHtml(value), baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (url.protocol === 'http:') url.protocol = 'https:';
    return url.toString();
  } catch {
    return null;
  }
}

function host(value) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function websiteCandidateScore(url, context = '', width = null, height = null) {
  const text = `${url} ${context}`.toLowerCase();
  let score = 0;
  if (/(front|exterior|facade|shopfront|storefront|outside|street|building)/.test(text)) score += 60;
  else if (/(interior|inside|dining|seating|venue|studio|class|play|people|baby|family|room|space)/.test(text)) score += 45;
  else if (/(food|coffee|kitchen)/.test(text)) score += 15;
  if (/(hero|feature|gallery)/.test(text)) score += 10;
  if (/(full|large|original|2048|1600|1200|1080|1024)/.test(text)) score += 12;
  if (/(thumbnail|thumb|150x150|200x200|300x300|banner|social-share|default)/.test(text)) score -= 18;
  if (/(graphic|illustration|cartoon|poster|flyer|template|stock)/.test(text)) score -= 20;
  if (blockedWebsiteImageTerms.test(text)) score -= 100;
  const shortest = Math.min(Number(width || 0), Number(height || 0));
  if (shortest > 0 && shortest < 320) score -= 100;
  else if (shortest >= 1000) score += 18;
  else if (shortest >= 640) score += 12;
  else if (shortest >= 400) score += 6;
  return score;
}

function structuredImages(value, output = []) {
  if (!value) return output;
  if (typeof value === 'string') {
    output.push({ url: value, context: 'structured image' });
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) structuredImages(entry, output);
    return output;
  }
  if (typeof value === 'object') {
    if (typeof value.url === 'string') output.push({ url: value.url, context: value.caption || value.name || 'structured image' });
    if (typeof value.contentUrl === 'string') output.push({ url: value.contentUrl, context: value.caption || value.name || 'structured image' });
  }
  return output;
}

function bestSrcsetImage(srcset) {
  if (!srcset) return null;
  return srcset.split(',').map((item) => {
    const parts = item.trim().split(/\s+/);
    return { url: parts[0], width: positiveInteger(parts[1]) };
  }).filter((entry) => entry.url).sort((left, right) => Number(right.width || 0) - Number(left.width || 0))[0] || null;
}

export function extractWebsiteImageCandidates(html, baseUrl, sourceKind = 'website') {
  const candidates = [];
  const add = (rawUrl, context = '', width = null, height = null) => {
    const original = absoluteUrl(rawUrl, baseUrl);
    if (!original || blockedWebsiteImageTerms.test(`${original} ${context}`)) return;
    candidates.push({
      original,
      thumbnail: null,
      title: String(context || '').replace(/\s+/g, ' ').trim() || null,
      source: host(baseUrl),
      link: baseUrl,
      position: null,
      original_width: positiveInteger(width),
      original_height: positiveInteger(height),
      source_kind: sourceKind,
      metadata_score: websiteCandidateScore(original, context, width, height),
    });
  };

  for (const tag of String(html || '').match(/<meta\s+[^>]*>/gi) || []) {
    const key = (attribute(tag, 'property') || attribute(tag, 'name') || '').toLowerCase();
    if (['og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'].includes(key)) {
      add(attribute(tag, 'content'), key);
    }
  }

  for (const script of String(html || '').match(/<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) || []) {
    try {
      const parsed = JSON.parse(script.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim());
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...(parsed?.['@graph'] || [])];
      for (const node of nodes) {
        for (const image of structuredImages(node?.image)) add(image.url, image.context);
      }
    } catch {
      // Invalid structured data is common; ordinary image tags are still collected.
    }
  }

  for (const tag of String(html || '').match(/<img\s+[^>]*>/gi) || []) {
    const srcset = bestSrcsetImage(attribute(tag, 'srcset') || attribute(tag, 'data-srcset'));
    const rawUrl = srcset?.url || attribute(tag, 'data-lazyload') || attribute(tag, 'data-src') || attribute(tag, 'data-original') || attribute(tag, 'src');
    const context = [attribute(tag, 'alt'), attribute(tag, 'title'), attribute(tag, 'class'), attribute(tag, 'id')].filter(Boolean).join(' ');
    // Ordinary width/height attributes describe the rendered layout surprisingly
    // often (for example 240x200 for a 1500x1000 AVIF). Only a srcset descriptor
    // is useful source metadata; byte-level dimensions are measured after fetch.
    add(rawUrl, context, srcset?.width || null, null);
  }

  for (const match of String(html || '').matchAll(/background(?:-image)?\s*:\s*url\(([^)]+)\)/gi)) {
    add(match[1].trim().replace(/^["']|["']$/g, ''), 'background image');
  }

  const seen = new Set();
  return candidates
    .sort((left, right) => right.metadata_score - left.metadata_score)
    .filter((candidate) => !seen.has(candidate.original) && Boolean(seen.add(candidate.original)))
    .map((candidate, index) => ({ ...candidate, position: index + 1 }));
}
