const blockedAssetTerms = /(favicon|icon|logo|wordmark|brand|badge|avatar|tracking|pixel|spinner|placeholder|cookie|consent|newsletter|payment|checkout|app-store|google-play)/i;

export function hasBlockedAssetTerms(...values) {
  return blockedAssetTerms.test(values.filter(Boolean).join(' '));
}
