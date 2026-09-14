# Design 19 — London, at Your Pace

Implemented on `codex/design-19`, based on `ced274f` in the `i-want-to-make-an-app-b2-release` checkout. The older `i-want-to-make-an-app` checkout and its uncommitted importer work were not modified.

## Scope

- Aubergine canvas, lavender brand/primary controls, butter-yellow selection states and sage save controls.
- Code-native parent/child logo, Big Ben, London Eye, bus, bridge and pram; no generated raster UI artwork or new runtime dependency.
- Design 19's first-use welcome and inclusive copy for babies through older children, parents/carers and parental leave.
- Existing first-use completion flag retained. Returning users are not forced through onboarding again.
- Plan, Swipe, Week, Where, Add, Profile and admin Review retain their existing data, navigation and action handlers. SVG icons supplement—not replace—the tab labels.
- Dark styling for forms, activity details, sharing/report sheets, profiles, admin queues and map chrome. Activity photos and map tiles retain their original colours.
- New web/PWA icon variants, metadata and a versioned app-shell cache. Old icon files remain available for rollback.
- Matching Android adaptive/legacy launcher icons and plum launch/system-bar colours. Old native icon assets remain untouched.

No image-selection/import pipeline, database schema, desktop review app or native authentication changes. The UI release is packaged as Android 2.90 (build 104) for the existing Render download page.

## Files and rollback

The existing `src/styles.css` is unchanged. The visual theme is isolated in `src/design19.css`, imported last by `src/main.jsx`; SVG components and welcome content live in `src/Design19.jsx`.

To fully revert, reverse this design's changes to `src/App.jsx`, `src/main.jsx`, `index.html`, `public/manifest.webmanifest`, `public/service-worker.js`, `android/app/src/main/AndroidManifest.xml` and `android/app/src/main/res/values/styles.xml`, then remove the now-unused Design19 components/theme/icon exports. Do not restore the entire working tree or touch unrelated changes. Once committed as an isolated design commit, `git revert <design-19-commit>` is the complete rollback path. Removing only the stylesheet import is useful for comparison but is not a complete rollback of the new welcome markup.

## Repeatable checks

```sh
npm test
npm run build
npx eslint src/Design19.jsx src/App.jsx src/main.jsx
node scripts/build-design19-icons.mjs
npm run dev -- --host 127.0.0.1 --port 5189
node scripts/design19-smoke.mjs
```

The browser check requires Playwright and installed Chrome. Set `PLAYWRIGHT_MODULE` to a bundled Playwright ESM entry if it is not installed in the checkout. `DESIGN19_TEST_URL` accepts localhost only. `DESIGN19_TEST_OUTPUT` controls the output folder (default `output/design19-qa`). No new package is installed by the script.

The test uses isolated browser contexts and local fixtures. All external HTTP requests are intercepted and WebSockets are closed; it never publishes a listing or writes to the live database. It exercises guest entry, the one-time welcome, save/skip, detail/back, all six tabs, a mocked admin session with seven tabs and the draft queue, at mobile and tablet widths. It also checks runtime errors, horizontal overflow and text contrast on the sampled screens. Photos, map tiles and disabled controls are excluded from the text-contrast check. This is a regression smoke test, not a certification of native Google authentication, live maps or a real Android device.

Screenshots and `results.json` are generated locally in `output/design19-qa` (git-ignored).

Validated: 212 existing tests passing; production Vite build and changed JSX lint clean; 16 browser smoke checks with no runtime errors, overflow or sampled contrast failures. Android resources compile with `android/gradlew.bat :app:processDebugResources`.
