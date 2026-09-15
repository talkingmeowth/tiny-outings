export function jpegDimensions(bytes) {
  if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216) throw Error('Upload a JPEG photograph.');
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset++] !== 255) throw Error('Invalid JPEG.');
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    const length = (bytes[offset] << 8) + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) throw Error('Invalid JPEG segment.');
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const height = (bytes[offset + 3] << 8) + bytes[offset + 4];
      const width = (bytes[offset + 5] << 8) + bytes[offset + 6];
      if (Math.min(width, height) < 300 || width * height < 180000 || width * height > 40000000) throw Error('Please use a larger, clear photo (at least 300px on each side).');
      return { width, height };
    }
    offset += length;
  }
  throw Error('Cannot read JPEG dimensions.');
}
