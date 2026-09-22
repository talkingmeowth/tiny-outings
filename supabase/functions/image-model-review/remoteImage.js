const mimeExtensions = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/avif', 'avif'],
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function sniffImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(4, 8)) === 'ftyp'
    && /avi[fx]|mif1/.test(String.fromCharCode(...bytes.slice(8, 12)))) return 'image/avif';
  return '';
}

export function publicImageUrl(value, options = {}) {
  if (typeof value !== 'string' || value.length > 2048) throw Error('Paste a direct HTTPS image URL.');
  let url;
  try { url = new URL(value.trim()); } catch { throw Error('Paste a valid HTTPS image URL.'); }
  const host = url.hostname.toLowerCase();
  if ((!options.allowHttp && url.protocol !== 'https:')
    || (options.allowHttp && !['https:', 'http:'].includes(url.protocol))
    || url.username || url.password || url.port
    || !host.includes('.') || host.startsWith('[') || /^[0-9.]+$/.test(host)
    || /(?:^|\.)(?:nip|sslip)\.io$/.test(host)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)
    || /(?:^|[./_-])(?:localhost|metadata|127\.0\.0\.1)(?:$|[./_-])/.test(host)) {
    throw Error('Use a public HTTPS image URL, not a local or private address.');
  }
  if (!options.allowAssetTerms && /(?:^|[-_/.])(?:logo|icon|favicon|sprite)(?:[-_/.]|$)/i.test(url.pathname)) {
    throw Error('Choose a photo rather than a logo or icon.');
  }
  url.hash = '';
  return url;
}

function read32(bytes, offset) {
  return (((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
}

export function imageDimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: read32(bytes, 16), height: read32(bytes, 20) };
  }
  if (mime === 'image/jpeg' && bytes.length >= 12 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset];
      if (marker === 0xda) break;
      if (frames.has(marker) && offset + 7 < bytes.length) {
        return { width: (bytes[offset + 6] << 8) + bytes[offset + 7], height: (bytes[offset + 4] << 8) + bytes[offset + 5] };
      }
      if (offset + 2 >= bytes.length) break;
      const length = (bytes[offset + 1] << 8) + bytes[offset + 2];
      if (length < 2) break;
      offset += length + 1;
    }
  }
  if (mime === 'image/webp' && bytes.length >= 30
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') {
    const subtype = String.fromCharCode(...bytes.slice(12, 16));
    if (subtype === 'VP8X') return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
    if (subtype === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) return { width: ((bytes[27] << 8) + bytes[26]) & 0x3fff, height: ((bytes[29] << 8) + bytes[28]) & 0x3fff };
    if (subtype === 'VP8L' && bytes[20] === 0x2f) {
      const packed = (bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)) >>> 0;
      return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
    }
  }
  if (mime === 'image/avif') {
    for (let i = 4; i + 16 < bytes.length; i += 1) {
      if (bytes[i] === 0x69 && bytes[i + 1] === 0x73 && bytes[i + 2] === 0x70 && bytes[i + 3] === 0x65) {
        return { width: read32(bytes, i + 8), height: read32(bytes, i + 12) };
      }
    }
  }
  return null;
}

export async function downloadSubmittedImage(rawUrl, fetcher = fetch, options = {}) {
  let url = publicImageUrl(rawUrl, options);
  const maxBytes = Number(options.maxBytes) || MAX_IMAGE_BYTES;
  const minimumSide = Number(options.minimumSide) || 300;
  const minimumPixels = Number(options.minimumPixels) || 180000;
  const minimumBytes = Number(options.minimumBytes) || 5 * 1024;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await fetcher(url.href, {
        redirect: 'manual', signal: controller.signal,
        headers: { Accept: 'image/avif,image/webp,image/png,image/jpeg' },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) throw Error('Image redirect was incomplete.');
        url = publicImageUrl(new URL(location, url).href, options);
        continue;
      }
      let mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      if (!response.ok) throw Error('The URL did not return a supported photo (JPEG, PNG, WebP or AVIF).');
      if (!mimeExtensions.has(mime) && !options.allowSniffedMime) throw Error('The URL did not return a supported photo (JPEG, PNG, WebP or AVIF).');
      if (Number(response.headers.get('content-length') || 0) > maxBytes) throw Error(`Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      if (!response.body) throw Error('The image response was empty.');
      const chunks = [];
      let size = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > maxBytes) throw Error(`Image exceeds ${Math.round(maxBytes / 1024 / 1024)} MB.`);
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      if (size < minimumBytes) throw Error('Image file is too small to use.');
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      if (!mimeExtensions.has(mime) && options.allowSniffedMime) mime = sniffImageMime(bytes);
      if (!mimeExtensions.has(mime)) throw Error('The URL did not return a supported photo (JPEG, PNG, WebP or AVIF).');
      const dimensions = imageDimensions(bytes, mime);
      if (!dimensions || Math.min(dimensions.width, dimensions.height) < minimumSide
        || dimensions.width * dimensions.height < minimumPixels || dimensions.width * dimensions.height > 40000000) {
        throw Error(`Use a clear photo of at least ${minimumSide}px on each side.`);
      }
      return { bytes, mime, extension: mimeExtensions.get(mime), ...dimensions, sourceUrl: url.href };
    }
    throw Error('Image redirected too many times.');
  } finally { clearTimeout(timeout); controller.abort(); }
}
