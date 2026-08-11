const appDownloadPageUrl = 'https://tiny-outings-cpjh.onrender.com/';

function normalizedUserName(value) {
  return String(value || '').trim().toLowerCase();
}

export function profileQrUrl(userName) {
  const user = normalizedUserName(userName);
  return user ? `tinyoutings://follow/${encodeURIComponent(user)}` : appDownloadPageUrl;
}

export function profileShareData(profile) {
  const userName = normalizedUserName(profile?.user_name);
  const displayName = String(profile?.display_name || userName || 'Tiny Outings parent').trim();
  const followUrl = profileQrUrl(userName);

  return {
    title: `Follow ${displayName} on Tiny Outings`,
    // Keep the exact QR payload in text too, because some share targets omit the URL field.
    text: `Follow @${userName} on Tiny Outings: ${followUrl}`,
    url: followUrl,
    dialogTitle: 'Share your follow code',
  };
}
