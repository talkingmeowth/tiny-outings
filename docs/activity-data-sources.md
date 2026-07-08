# Activity Data Sources

Initial scope: Waltham Forest, London.

## Source Strategy

- Council activity details come from London Borough of Waltham Forest event pages.
- Latitude and longitude values are postcode centroids from Postcodes.io, suitable for MVP radius filtering but not exact venue entrances.
- Google ratings, review counts, and photo references are intentionally left blank until a Google Places enrichment step is added.
- `source_url` is unique in the database so seed imports can be safely re-run.

## Waltham Forest Sources Used

- https://www.walthamforest.gov.uk/events
- https://www.walthamforest.gov.uk/events/stay-and-play-barclay-primary-school-leyton
- https://www.walthamforest.gov.uk/events/play-and-learn-under-2s-best-start-family-hub-walthamstow
- https://www.walthamforest.gov.uk/events/stay-and-play-chingford-library-thursday
- https://www.walthamforest.gov.uk/events/grow-wild-explorer-first-session
- https://www.walthamforest.gov.uk/events/flourish-post-natal-support-group-best-start-family-hub-chingford
- https://www.walthamforest.gov.uk/events/sensory-play-and-learn-best-start-family-hub-leytonstone
- https://www.walthamforest.gov.uk/events/stay-and-play-lea-bridge-library-monday
- https://www.walthamforest.gov.uk/events/henry-infant-feeding-group-drop-walthamstow-library
- https://www.walthamforest.gov.uk/events/stay-and-play-walthamstow-library-afternoon-session
- https://www.walthamforest.gov.uk/events/stay-and-play-walthamstow-library-morning-session
- https://www.walthamforest.gov.uk/events/stay-and-play-leytonstone-library-wednesday
- https://www.walthamforest.gov.uk/events/stay-and-play-lea-bridge-library-wednesday
- https://www.walthamforest.gov.uk/events/stay-and-play-wood-street-library
- https://www.walthamforest.gov.uk/events/stay-and-play-chingford-library-tuesday

## Postcode Centroids Used

- E10 6EJ: 51.575756, -0.000933
- E17 5PX: 51.597912, -0.040839
- E4 7EN: 51.631635, 0.002215
- E17 5JW: 51.593406, -0.022032
- E4 6EY: 51.625359, 0.009538
- E11 4LF: 51.558130, 0.006474
- E10 7HU: 51.570502, -0.024151
- E17 7JN: 51.584478, -0.021034
- E11 1HG: 51.568230, 0.008982
- E17 3GN: 51.587133, -0.004202

## Next Enrichment Pass

- Pull exact place coordinates, photos, ratings, and review counts from Google Places.
- Add venue-level deduplication so several weekly activities can share the same venue record later.
- Expand the seed set across Hackney, Islington, and Newham.
- Add a moderation workflow for user-submitted activity links.
