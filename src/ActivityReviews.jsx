import { useEffect, useRef, useState } from 'react';
import { reviewAuthor, sortReviews } from './activityReviewData';

export function RatingStars({ rating }) {
  return <span className="community-stars" role="img" aria-label={`${Number(rating.toFixed(1))} out of 5 stars`}>
    <span aria-hidden="true">☆☆☆☆☆</span>
    <span className="community-stars-fill" style={{ width: `${Math.max(0, Math.min(5, rating)) * 20}%` }} aria-hidden="true">★★★★★</span>
  </span>;
}

export function ReviewRatingLink({ state, onOpen }) {
  if (state.loading) return <p className="community-loading" role="status">Loading parent reviews…</p>;
  if (state.error) return <button className="community-rating-link" type="button" onClick={onOpen}>Reviews unavailable · Try again</button>;
  return <button className="community-rating-link" type="button" onClick={onOpen}>
    {state.summary.count ? <><RatingStars rating={state.summary.average} /><strong>{state.summary.average.toFixed(1)}</strong><span>{state.summary.count} {state.summary.count === 1 ? 'review' : 'reviews'} ›</span></> : <span>No reviews yet · Be the first ›</span>}
  </button>;
}

export function CommunityReviews({ activity, state, full, onOpen, onWrite, writing, onCancelWrite, onReport, userId, children }) {
  const [order, setOrder] = useState('recent');
  const [visible, setVisible] = useState(20);
  const heading = useRef(null);
  useEffect(() => {
    if (full) { heading.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  }, [full]);
  const ownReview = state.rows.find((review) => review.user_id === userId);
  const sorted = sortReviews(state.rows, order);
  const preview = sorted.find((review) => review.review_text?.trim());
  return <section className={`community-reviews ${full ? 'is-full' : 'is-preview'}`} aria-label="Parents and carers reviews">
    {full && <p className="community-context">{activity.activity_name}{activity.borough ? ` · ${activity.borough}` : ''}</p>}
    <h2 ref={heading} tabIndex={-1}>Parents &amp; carers say</h2>
    {state.loading ? <p role="status">Loading reviews…</p> : state.error ? <div role="alert"><p>{state.error}</p><button type="button" onClick={state.retry}>Try again</button></div> : <>
      {full && <div className="community-summary">
        {state.summary.count > 0 && <><strong className="community-average">{state.summary.average.toFixed(1)}</strong><div><RatingStars rating={state.summary.average} /><small>{state.summary.count} {state.summary.count === 1 ? 'review' : 'reviews'}</small></div></>}
        <button className="community-write" type="button" onClick={() => onWrite(ownReview)}>{ownReview ? 'Edit your review' : 'Write a review'}</button>
      </div>}
      {!state.summary.count && <p>No reviews yet. Been here? Share what it was like.</p>}
      {!full && <>
        {preview ? <blockquote>{preview.review_text}</blockquote> : state.summary.count > 0 && <p>{state.summary.count} {state.summary.count === 1 ? 'parent or carer has' : 'parents and carers have'} rated this outing.</p>}
        <button className="community-see-all" type="button" onClick={onOpen}>{state.summary.count ? `See all ${state.summary.count} ${state.summary.count === 1 ? 'review' : 'reviews'} →` : 'Write the first review →'}</button>
      </>}
      {full && !writing && state.summary.count > 0 && <>
        <label className="community-sort"><span className="sr-only">Sort reviews</span><select value={order} onChange={(event) => { setOrder(event.target.value); setVisible(20); }}><option value="recent">Most recent</option><option value="highest">Highest rated</option><option value="lowest">Lowest rated</option></select></label>
        <div className="community-review-list">{sorted.slice(0, visible).map((review) => {
          const name = reviewAuthor(review);
          const date = new Date(review.created_at);
          return <article className="community-review" key={review.review_id}>
            <span className="community-avatar" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
            <div className="community-review-body"><strong>{name}{review.user_id === userId ? ' · You' : ''}</strong>
              {!Number.isNaN(date.valueOf()) && <time dateTime={date.toISOString()}>{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</time>}
              <RatingStars rating={Number(review.rating)} />
              {review.review_text?.trim() ? <p>{review.review_text}</p> : <p className="community-rating-only">Rating only</p>}
              <button className="community-report" type="button" aria-label={`Report review by ${name}`} onClick={() => onReport(review)}>Report</button>
            </div>
          </article>;
        })}</div>
        {sorted.length > visible && <button type="button" onClick={() => setVisible((n) => n + 20)}>Show more reviews</button>}
      </>}
    </>}
    {full && writing && <div className="community-editor"><button type="button" onClick={onCancelWrite}>Back to reviews</button>{children}</div>}
  </section>;
}
