# Activity Data Sources

Initial scope: Waltham Forest, Hackney, and Newham, London.

## Source Strategy

- Council activity details come from London Borough of Waltham Forest event pages.
- Additional family venue details come from official venue, council, park, and family-information pages.
- Latitude and longitude values are approximate venue coordinates, suitable for MVP radius filtering but not exact entrances.
- Google ratings, review counts, and photo references are intentionally left blank until the Google Places enrichment function is run with a `GOOGLE_MAPS_API_KEY`.
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
- https://www.ittakesavillageplaycafe.com/
- https://www.ittakesavillageplaycafe.com/faqs
- https://www.ledelicee17.co.uk/about-us
- https://www.walthamforest.gov.uk/families-young-people-and-children/parenting-and-family-support/best-start-family-hubs-directory/homemade-community-cafe
- https://www.walthamforest.gov.uk/libraries-arts-parks-and-leisure/parks-and-open-spaces/lloyd-park
- https://www.wildlondon.org.uk/nature-reserves/walthamstow-wetlands
- https://www.wmgallery.org.uk/
- https://www.wmgallery.org.uk/learn/families/
- https://www.walthamforest.gov.uk/events/william-morris-gallery-family-day-park-morriss-magical-menagerie
- https://highamspark.london/highams-park/the-highams-park/

## Hackney Sources Used

- https://www.dreami.uk/
- https://hackneycityfarm.co.uk/visit/
- https://www.hackney.gov.uk/libraries-parks-and-leisure/parks-and-green-spaces/parks-list/clissold-park-and-house
- https://news.hackney.gov.uk/news/clissold-park-splash-pad-returns-this-month
- https://hackney-museum.hackney.gov.uk/visit/
- https://education.hackney.gov.uk/content/museums
- https://museumofthehome.org.uk/plan-your-visit/
- https://www.woodberrydowncfhub.hackney.gov.uk/
- https://education.hackney.gov.uk/school/woodberry-down-children-and-family-hub
- https://www.hackney.gov.uk/libraries-parks-and-leisure/parks-and-green-spaces/playgrounds

## Newham Sources Used

- https://discover.org.uk/
- https://discover.org.uk/your-visit/
- https://www.queenelizabetholympicpark.co.uk/explore-park/parklands-and-playgrounds/playgrounds
- https://www.queenelizabetholympicpark.co.uk/explore-park/parklands-and-playgrounds/tumbling-bay-playground
- https://www.queenelizabetholympicpark.co.uk/eat-drink/timber-lodge-cafe-your-parkside-dining-destination
- https://www.cityoflondon.gov.uk/things-to-do/green-spaces/west-ham-park/visit-west-ham-park
- https://families.newham.gov.uk/kb5/newham/directory/familyhub.page?familyhubchannel=5-1
- https://families.newham.gov.uk/kb5/newham/directory/service.page?familychannel=1-1&id=9Hk1rjt-v9E
- https://www.royaldocks.london/whats-on/summer-family-fun-at-kids-summer-splash

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
- Expand the seed set across Islington.
- Add a moderation workflow for user-submitted activity links.
