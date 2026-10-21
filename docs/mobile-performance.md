# Mobile loading and icon CSS — 2026-10-16

The HTML entry now loads generated Font Awesome CSS with the 57 icon names
(55 codepoints) used in source. Shared Font Awesome rules, licenses, solid/regular
font subsets, animations, and reduced-motion behavior are preserved. See
[fontawesome-subset.md](fontawesome-subset.md) for regeneration instructions.

The baseline is commit `d974cc82f3f776f8810e24eef66c60065728db08`. Both artifacts
used `yarn build:github` with `VITE_PRERENDER_MOVIE_PAGES=true`. Sizes below are
bytes; gzip is measured with Node's default `gzipSync` settings.

| Resource                   | Before |  After |      Reduction |
| -------------------------- | -----: | -----: | -------------: |
| Main application CSS, raw  | 86,531 | 39,910 | 46,621 (53.9%) |
| Main application CSS, gzip | 26,022 | 11,681 | 14,341 (55.1%) |
| Home initial CSS, gzip     | 33,075 | 18,734 | 14,341 (43.4%) |
| Movie initial CSS, gzip    | 50,728 | 36,387 | 14,341 (28.3%) |

The full Font Awesome package remains a generation input. It is no longer linked
from the HTML. Dependency and font files are unchanged.

## Controlled comparison

Edge 155.0.4283.45, 390 × 844 viewport, DPR 1, mobile/touch, CPU slowdown ×4.
CDP network settings: 150 ms latency, download 200,000 bytes/s, upload 93,750 bytes/s.
Each route had three paired cold runs, alternating the order of the builds. Each
run used a fresh context with HTTP cache disabled and service workers blocked.
The same local gzip server supplied deterministic API data and posters; external
analytics, fonts, and player services were blocked. The local embedded regular
font was allowed through the fixture's CSP.

| Route                    | Median FCP before → after | Median LCP before → after | CLS before / after |
| ------------------------ | ------------------------- | ------------------------- | ------------------ |
| `/`                      | 1,248 → 944 ms            | 1,512 → 1,464 ms          | 0 / 0              |
| `/movie/301/the-matrix/` | 1,396 → 1,076 ms          | 3,092 → 2,856 ms          | 0.0341 / 0.0341    |

Home LCP ranges overlap: 1,400–1,628 ms before and 1,416–1,468 ms after. The
small LCP change is not evidence of a stable production improvement. Movie LCP
is the player's loading text (`p.spinner-text`), so it does not measure readiness
to play. The reliable gain is the smaller render-blocking stylesheet; these
three-run timing samples show its effect under controlled conditions.

To repeat with saved before/after artifacts, start the existing fixture:

```sh
node scripts/frontend-profile-server.js dist 4188 <baseline-directory>
```

Visit `/__profile/setup?build=before` or `/__profile/setup?build=after` on
`http://127.0.0.1:4188`, then navigate to the target route with a fresh context,
the settings above, and service workers bypassed. For a regular-font gallery,
allow local `data:` fonts in the fixture CSP; the regular subset is embedded in CSS.

Validation included 469 unit tests, lint, encoding and formatting checks, the
full SSG build, PWA offline/update checks, and deferred movie controls at 390 and
1,280 px. A gallery of all 57 solid names, the four used regular icons, and a
spinner had identical computed styles and pixels before/after, including
reduced-motion behavior.

## Production baseline and next work

A separate cold trace of `https://reyhoho.fun/` at the baseline commit used
Chrome DevTools Slow 4G, CPU ×4, the same viewport, disabled HTTP cache, and
blocked service workers. It measured home LCP at 2.71 s with essentially zero
CLS. The LCP element was a poster; Yandex image transfers were about 551 KB.
Cards displayed at 100 × 150 CSS px fetched 300 × 450 images at DPR 1. A next
step is to verify responsive poster sizing while retaining enough resolution
for higher-DPR screens.

The same trace attributed about 548 ms of main-thread time to Yandex Metrica
and 114 ms to Google Tag Manager. Their loading strategy is another measurable
target. On the movie route, LCP was 5.95 s for the loading text, and a later
0.0443 layout shift involved third-party player controls. Player layout and
actual readiness require separate measurements. Production timings cannot be
compared directly to the local fixture timings above.

Raw local measurements and gallery screenshots are in the ignored
`reports-browser/mobile-production-before.json` and
`reports-browser/mobile-css-comparison.json` reports.
