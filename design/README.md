# Orbit — UI design study

A mobile-first browser interface for Satellite Tracker, **not the native app**. The Track map now uses genuine public orbital elements and the existing local SGP4 engine. Sky view, pass times, reminder controls and the four-entry catalog remain explicitly labeled previews. The Buenos Aires observer is a sample location; GPS and OS notifications are not connected. No provider credentials, external fonts or map tiles are used.

The interface is in neutral Spanish at the user's request, including accessible names, empty/error states, status messages and document language. Numeric displays use decimal commas; cardinal west is `O`. Orbit, official satellite names, NORAD identifiers, internal group keys and route hashes retain their names. Technical documentation and code identifiers remain English.

## Connected map

- `live-map.ts` reuses `src/orbit.ts`, `src/geometry.ts` and `src/data-service.ts`; no independent orbital algorithm or cache format was introduced.
- The active, visible map recalculates position, altitude, velocity and coverage every **2 seconds** using the browser clock. Browsers may throttle inactive tabs; the controller pauses when hidden and recalculates on resume. Ground-track samples are refreshed once per minute locally and split at the antimeridian.
- A selected object requests CelesTrak JSON OMM data. ISS can fall back to the existing Where the ISS at? TLE adapter. Each of the four fixed datasets has a service instance retaining the existing two-hour quota and a shared `localStorage` cache with a 24-hour TTL. Tick updates do not fetch. Source redirects and HTTP failures are not automatically retried. See the [CelesTrak GP format](https://celestrak.org/NORAD/documentation/gp-data-formats.php) and [usage policy](https://celestrak.org/usage-policy.php).
- Loading or a failed initial fetch hides all sample coordinates and geometry; changing selection cancels the previous request and ignores late completions. No old satellite is relabeled as the new one.
- The source dialog separates provider, element epoch/age, download time/age and cache state. Stale data are warned about, not described as current measurements. Real elements still yield a **calculated** position, not direct telemetry.
- The map base remains schematic. Position coordinates follow an equirectangular projection; coastlines are not survey-accurate. Footprint is the existing spherical, 0° minimum-elevation approximation; outlines wrap without filling across the dateline.
- The loopback server transpiles only an explicit allowlist of existing TypeScript modules using the already-installed TypeScript package, and serves the installed satellite.js ESM locally. No new package, runtime install, generated bundle or native-domain change was needed.

## Visual direction

An observatory field instrument: deep forest surfaces, pale mineral text, restrained chart lines and a single lime accent. Large editorial headings contrast with small monospaced measurement labels. The map and polar plot carry the visual identity rather than decorative stock imagery.

All iconography and schematic geography are self-contained SVG. The map is deliberately simplified and is not a geographic or navigational authority. Avenir Next/Trebuchet and Cascadia Code/Consolas use local font fallbacks, so no remote font request is needed. Native font selection remains a handoff decision.

## Tokens

| Role | Value |
|---|---|
| Canvas / surface / raised | `#101816` / `#19231e` / `#202c24` |
| Primary / secondary text | `#eef0e5` / `#a4b0a2` |
| Accent / on-accent | `#d1f5a2` / `#1b2817` |
| Dividers / warning | `#344238` / `#f3c08d` |
| Spacing | 4, 8, 12, 16, 20, 24, 32, 48 px |
| Shape | 20 px panels; 8–12 px controls; circular instrument marks |
| Typography | Fluid 32–61 px page headings; 16 px body; compact chart annotations |
| Motion | 160 ms control feedback; 260 ms page reveal; disabled for reduced motion |

## Screens and responsive behavior

| Screen | Primary action | Phone | Wider layouts |
|---|---|---|---|
| Seguimiento | Choose a satellite, inspect orbit | Map → satellite telemetry → next pass | Map and telemetry side by side |
| Cielo | Understand where to look | North-up polar plot → guidance | Plot beside guidance |
| Pases | Select a preview reminder | Pass list → lead-time selector | List beside reminder settings |
| Catálogo | Search name/NORAD, filter group | One-column results | Two or three columns |

Baseline starts at 320 px. At 600 px, results use two columns and headings share a row. At 900 px, bottom navigation becomes a side rail and paired panels sit side by side. At 1200 px, the shell gains breathing room and catalog results use three columns. Containers remain fluid and capped; large screens do not stretch line lengths indefinitely.

Navigation uses one shared DOM, hash links, back/forward history and an explicit current-page state. Phone navigation accounts for the bottom safe area. Modal details use the native HTML dialog focus trap and Escape behavior. Native implementation should translate these patterns into Expo Router, safe-area insets and React Native flex layouts rather than copying CSS.

## Components and states

- Navigation: current, hover, visible keyboard focus; 44 px or larger controls.
- Map: real calculated ground-track and footprint switches for any selected object with valid elements. The map follows the selected marker; loading/error states hide geometry.
- Telemetry: calculated selected-object summary, units, source and age details; unknown values are dashes, never sample positions.
- Catalog: combined name/NORAD and category filtering; empty results with reset; selectable ready, loading, offline/stale and source-error examples.
- Pass reminder: reversible memory-only selection, 5/10/15-minute lead time, screen-reader status feedback. No OS permission or actual scheduling.
- Observer dialog: transparent sample location, with no device location access. Source dialog: actual provider/epoch/download/cache metadata for the map.
- Motion: reduced-motion preference removes transitions, page reveals and loading shimmer.

## Preview and verification

Run `node design/serve.cjs` from the application directory and open `http://127.0.0.1:4177/`. The server binds only to loopback and serves an explicit allowlist of preview assets. ES modules require HTTP rather than double-clicking a `file://` URL. No install or build is required for the design itself.

Model tests: `node --test design/preview.test.mjs` from the application directory. Map integration tests: `node node_modules/tsx/dist/cli.mjs --test tests/live-map.test.ts`. Five initial map assertions were observed failing against no-op stubs before implementation; the completed map suite has six passing tests.

Browser verification: stop the preview server first, then run `node design/verify-preview.cjs`; it starts and closes its own loopback server. Use an existing Playwright installation via `PLAYWRIGHT_MODULE`, and optionally an installed Chromium executable via `BROWSER_EXECUTABLE`. This does not add a production dependency. Captures are saved under `output/playwright/`.

The browser check intercepts provider requests with synthetic test elements; it makes no real provider call. It covers four pages at 320, 390, 768, 1024, 1440 and 1920 px; 200% text at 320 px; actual local marker movement without additional fetches; navigation; search/filter/reset; satellite selection; map layers; reminder selection; modal Escape/focus restoration; catalog loading/error/offline states; reduced motion; and no JavaScript page errors. Visual composition still requires inspecting the captures. This is not native-device acceptance or a full accessibility audit.

Observed map-integration checks: **76 domain/integration tests + 4 preview tests**, TypeScript, 24 viewport/page checks and four enlarged-text checks pass. One explicit `node design/check-live-provider.cjs` smoke check returned CelesTrak HTTP 200, displayed an element age of 20.5 hours, and observed an advancing ISS marker at 2026-10-29T07:39:51Z with no page errors. This is live transport/integration proof, not independent position-accuracy validation. Do not run that script as an automatic polling test; it performs real public API calls.

## Native handoff

1. Port the shell, tokens and reusable controls into Expo while preserving this visual hierarchy.
2. Port the connected browser map adapter into native presentation components. Polar coordinates and pass windows in the other screens still need integration; remove their demo claims only when connected.
3. Replace the four-entry preview catalog with the actual catalog flow. Retain the map's distinctions between epoch age, fetch age and stale fallback.
4. Connect explicit GPS/heading and reminder permissions. Retain manual observer entry and unsupported-device states.
5. Verify on Android/iOS with font scaling, safe areas, screen readers and real permission flows. A browser screenshot does not prove those behaviors.

No native source, dependencies or previously verified domain logic were changed by this map connection. No commits or remote publication are part of this browser delivery.

Risk: item 4 — selected-request cancellation, visibility and interval ownership. Independent verification is required in addition to the change's own checks. Existing persistent cache format and shared helpers are reused unchanged.
