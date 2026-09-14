export const REVIEW_COLUMNS = 'review_id,user_id,rating,review_text,created_at,updated_at,author:user_table(display_name,user_name)';

export async function loadActivityReviews(client, activityId, signal) {
  if (!client) throw new Error('Reviews are unavailable. Please try again later.');
  const reviews = [];
  const pageSize = 200;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await client.from('activity_reviews')
      .select(REVIEW_COLUMNS).eq('activity_id', activityId)
      .order('created_at', { ascending: false }).order('review_id')
      .range(start, start + pageSize - 1).abortSignal(signal);
    if (error) throw error;
    reviews.push(...(data || []));
    if (!data || data.length < pageSize) return reviews;
  }
}

export function reviewSummary(reviews) {
  const ratings = reviews.map((review) => Number(review.rating))
    .filter((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5);
  return { count: ratings.length, average: ratings.length ? ratings.reduce((sum, n) => sum + n, 0) / ratings.length : null };
}

export function reviewAuthor(review) {
  const author = Array.isArray(review.author) ? review.author[0] : review.author;
  return author?.display_name?.trim() || author?.user_name?.trim() || 'Parent or carer';
}

export function sortReviews(reviews, order) {
  return [...reviews].sort((a, b) => {
    const ratingOrder = order === 'highest' ? b.rating - a.rating : order === 'lowest' ? a.rating - b.rating : 0;
    return ratingOrder || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || String(a.review_id).localeCompare(String(b.review_id));
  });
}
