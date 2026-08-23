export const CAFE_IMAGE_CONTENT_LABELS = [
  'a clear exterior of a cafe, restaurant, bakery, or play cafe',
  'a clear interior of a cafe, restaurant, bakery, or play cafe',
  'a close-up of food, drink, cake, pastry, or a menu',
  'a company logo, graphic, flyer, poster, or social media image',
  'an unrelated place or generic stock image',
];

const [exteriorLabel, interiorLabel, foodLabel, graphicLabel, unrelatedLabel] = CAFE_IMAGE_CONTENT_LABELS;

function scoreFor(results, label) {
  return Number(results.find((result) => result.label === label)?.score || 0);
}

// CLIP examines the image pixels against these prompts. We only automatically
// replace cards when the food or graphic interpretation clearly beats a venue.
export function assessCafeImageContent(results) {
  const exterior = scoreFor(results, exteriorLabel);
  const interior = scoreFor(results, interiorLabel);
  const food = scoreFor(results, foodLabel);
  const graphic = scoreFor(results, graphicLabel);
  const unrelated = scoreFor(results, unrelatedLabel);
  const venue = Math.max(exterior, interior);
  const unsuitable = Math.max(food, graphic);
  const scores = { exterior, interior, food, graphic, unrelated };

  if (venue >= 0.45 && venue >= unsuitable + 0.08) {
    return { outcome: 'retain', reason: exterior >= interior ? 'Clear venue exterior.' : 'Clear venue interior.', scores };
  }
  if (unsuitable >= 0.42 && unsuitable >= venue + 0.08) {
    return {
      outcome: 'refresh',
      reason: food >= graphic ? 'Food or menu image.' : 'Logo, graphic, flyer, or social image.',
      scores,
    };
  }
  return { outcome: 'review', reason: 'Visual classifier result is not decisive.', scores };
}

export function cafeImageContentSummary(rows) {
  return rows.reduce((summary, row) => {
    summary[row.assessment.outcome] = (summary[row.assessment.outcome] || 0) + 1;
    return summary;
  }, { retain: 0, review: 0, refresh: 0, failed: 0 });
}
