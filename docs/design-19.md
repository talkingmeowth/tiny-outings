# Design 19 — London, at Your Pace

Implemented on `codex/design-19`, based on `ced274f` in the `i-want-to-make-an-app-b2-release` checkout. The older `i-want-to-make-an-app` checkout and its uncommitted importer work were not modified.

## Scope

- Device-following light and dark modes: a soft lilac light canvas or aubergine dark canvas, with lavender, butter-yellow and sage accents. Changes to the system preference apply without resetting the current screen.
- Code-native parent/child logo, Big Ben, London Eye, bus, bridge and pram; no generated raster UI artwork or new runtime dependency.
- Design 19's first-use welcome and inclusive copy for babies through older children, parents/carers and parental leave.
- The new welcome uses `welcome-design19-v1`, independently of the legacy tour flag. Existing installations see it once after updating; subsequent launches skip it. Profile's **Show welcome screen** replays it without deleting preferences or saved plans.
- Plan, Swipe, Week, Where, Add, Profile and admin Review retain their existing data, navigation and action handlers. SVG icons supplement—not replace—the tab labels.
- Both themes cover forms, activity details, sharing/report sheets, profiles, admin queues and map chrome. Activity photos and map tiles retain their original colours.
- New web/PWA icon variants, metadata and a versioned app-shell cache. Old icon files remain available for rollback.
- Matching Android adaptive/legacy launcher icons and day/night launch/system-bar colours. MainActivity refreshes native chrome on uiMode changes without resetting navigation. The launcher icon retains a consistent dark background.

No image-selection/import pipeline, database schema, desktop review app or native authentication changes. The corrected UI release is packaged as Android 2.91 (build 105) for the existing Render download page.

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

The browser check requires Playwright and installed Chrome. Set `PLAYWRIGHT_MODULE` to a bundled Playwright ESM entry if it is not installed in the checkout. `DESIGN19_TEST_URL` accepts localhost only. Run with `DESIGN19_TEST_SCHEME=light` and again with `DESIGN19_TEST_SCHEME=dark`. `DESIGN19_TEST_OUTPUT` controls the output folder (default `output/design19-qa/<scheme>`). No new package is installed by the script.

The test uses isolated browser contexts and local fixtures. All external HTTP requests are intercepted and WebSockets are closed; it never publishes a listing or writes to the live database. It exercises guest entry, the one-time welcome, save/skip, detail/back, all six tabs, a mocked admin session with seven tabs and the draft queue, at mobile and tablet widths. It also checks runtime errors, horizontal overflow and text contrast on the sampled screens. Photos, map tiles and disabled controls are excluded from the text-contrast check. This is a regression smoke test, not a certification of native Google authentication, live maps or a real Android device.

Screenshots and `results.json` are generated locally in `output/design19-qa` (git-ignored).

Validated: 212 existing tests passing; production Vite build and changed JSX lint clean; 20 browser smoke checks per theme (40 total), including live theme changes, legacy-user welcome migration, persistence and replay, with no runtime errors, overflow or sampled contrast failures. Android APK builds with `npm run android:apk`.

## 2.92 age-default correction

Android 2.92 (build 106) starts each new app session at **Any age**, instead of restoring a previously saved narrow age filter. Age choices still work for the current browsing session; saved plans and other preferences are untouched. The change is isolated to the filter initializer and does not alter either theme. Regression checks cover a fresh launch, choosing Baby, and relaunching with Baby persisted. The suite now has 213 Node tests and 22 browser checks per theme.
