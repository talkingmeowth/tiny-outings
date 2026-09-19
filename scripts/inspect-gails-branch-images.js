// Read-only inspection of each listing's existing official GAIL's branch page.
// Usage: node scripts/inspect-gails-branch-images.js <hex-encoded JSON rows>
// Never calls Google Places or SerpAPI and never writes to the database.
const rows = JSON.parse(Buffer.from(process.argv[2], 'hex').toString('utf8'));
const unescapeHtml = (text) => (text || '').replaceAll('&amp;', '&').replaceAll('&#39;', "'");
const attr = (tag, key) => unescapeHtml(tag.match(new RegExp(`\\b${key}=["']([^"']*)["']`, 'i'))?.[1]);
const normalize = (text) => (text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const queue = [...rows];
const results = [];

async function worker() {
  while (queue.length) {
    const row = queue.shift();
    const result = { activity_id: row.activity_id, name: row.activity_name, page: row.website };
    try {
      const alternateSlugs = {
        "GAIL's Bakery Archway": 'archway',
        "GAIL's Bakery Canary Wharf Crossrail": 'crossrail-place',
        "GAIL's Bakery Fulham Broadway": 'fulham-broadway',
        "GAIL's Bakery Herne Hill": 'herne-hill',
        "GAIL's Bakery Paddington": 'paddington',
        "GAIL's Bakery Primrose Hill": 'primrose-hill',
        "GAIL's Bakery Tooting Broadway": 'tooting-broadway',
      };
      if (alternateSlugs[row.activity_name]) {
        row.website = `https://gails.com/pages/${alternateSlugs[row.activity_name]}`;
        result.page = row.website;
      }
      if (!/^https:\/\/gails\.com\/pages\/[a-z0-9-]+\/?$/i.test(row.website || '')) {
        throw new Error('No official branch page');
      }
      const response = await fetch(row.website, { signal: AbortSignal.timeout(18000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const slug = new URL(row.website).pathname.split('/').filter(Boolean).pop();
      const key = normalize(slug);
      const images = [...html.matchAll(/<img\b[^>]*>/gi)].map(([tag]) => {
        const src = attr(tag, 'src');
        const alt = attr(tag, 'alt');
        const absolute = src?.startsWith('//') ? `https:${src}` : src;
        const filename = absolute?.split('/').pop()?.split('?')[0] || '';
        let score = 0;
        if (normalize(alt) === key) score += 100;
        if (normalize(filename).startsWith(key)) score += 90;
        if (normalize(filename).includes(key)) score += 50;
        if (normalize(alt).includes(key)) score += 40;
        if (/\/cdn\/shop\/files\//.test(absolute || '')) score += 10;
        if (/logo|icon|newsletter/i.test(filename)) score -= 100;
        if (/Bakery_Page_Default_Photo/i.test(filename)) score -= 30;
        return { url: absolute, alt, width: attr(tag, 'width'), height: attr(tag, 'height'), score };
      }).filter((image) => image.url?.startsWith('https://gails.com/cdn/shop/files/'));
      result.candidates = images.sort((a, b) => b.score - a.score).slice(0, 3);
    } catch (error) {
      result.error = String(error?.message || error);
    }
    results.push(result);
  }
}

Promise.all(Array.from({ length: 8 }, () => worker())).then(() => {
  process.stdout.write(JSON.stringify(results.sort((a, b) => a.name.localeCompare(b.name))));
});
