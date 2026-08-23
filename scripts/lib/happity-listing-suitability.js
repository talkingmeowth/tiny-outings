function activityText(listing = {}) {
  return [listing.activityName, listing.activity_name, listing.name, listing.description]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// These terms describe the listing itself. Venue and address fields are
// deliberately excluded so a mainstream toddler group held at a church stays
// in the directory.
const religiousActivityText = /\b(christian|bible|biblical|faith[ -]based|prayer|pray|worship|messy church|church service|sunday school|islamic|muslim|quran|koran|hinduism|sikhism|jewish studies|judaism|torah|buddhist|buddhism|spiritual(?:ity)?)\b/i;

const languageActivityText = /\b(bilingual|multilingual|language (?:class|club|course|learning|lesson|lessons|session|playgroup)|(?:learn|learning|teach|teaching) (?:english|french|spanish|italian|greek|arabic|bengali|mandarin|cantonese|german|portuguese|polish|urdu|hindi|punjabi|turkish|russian|japanese|korean)|(?:english|french|spanish|italian|greek|arabic|bengali|mandarin|cantonese|german|portuguese|polish|urdu|hindi|punjabi|turkish|russian|japanese|korean)[ -]+(?:english|french|spanish|italian|greek|arabic|bengali|mandarin|cantonese|german|portuguese|polish|urdu|hindi|punjabi|turkish|russian|japanese|korean) (?:playgroup|class|club|session)|(?:english|french|spanish|italian|greek|arabic|bengali|mandarin|cantonese|german|portuguese|polish|urdu|hindi|punjabi|turkish|russian|japanese|korean) (?:playgroup|class|club|lesson|session|for (?:babies|children|kids|toddlers)))\b/i;

export function happityListingExclusionReasons(listing) {
  const text = activityText(listing);
  const reasons = [];
  if (religiousActivityText.test(text)) reasons.push('Explicitly religious Happity activity');
  if (languageActivityText.test(text)) reasons.push('Language-focused Happity activity');
  return reasons;
}

export function isExcludedHappityListing(listing) {
  return happityListingExclusionReasons(listing).length > 0;
}
