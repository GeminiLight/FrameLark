# Controlled-edit pipeline performance

This change builds on the controlled-edit implementation in PR #1. It does not change edit semantics or the protected-region pipeline identity.

## Boundaries and invariants

- `createRenderSession` owns one immutable project snapshot, one verified decoded source, and operation-local final-frame/reference caches. `inspect` shares that session across its two full previews and annotation crops. Regions are still extracted from the complete final RGBA frame, never rendered independently with different grain, vignette or neighborhood-filter geometry. Sessions are short-lived, not global pixel caches.
- Protection preparation owns rendering, no-text rendering, encoding, snapshot creation and dependency decoding. The HTTP server runs preparation in its existing serial worker. A short project transaction compares revision, current version and the complete project hash, validates reference metadata, rechecks the prepared source/reference file hashes, and atomically saves the version. Stale preparations delete only their unreferenced snapshots under the project lock. A duplicate commit cannot delete live references.
- The worker queue is limited to eight active/queued jobs. Already-running CPU work is not preempted by aborting a browser fetch. Queued disconnected requests are skipped; excess requests receive a retryable `RENDER_BUSY` error. This avoids parallel 16 MP render jobs multiplying memory use.
- Protected compositing projects conservative feather bounds once per mask and precomputes rotation/determinants. The inner loop does no per-pixel array/point allocation. It preserves the original arithmetic order, max weight for same-reference masks, exact RGBA endpoint copies, and linear-light premultiplied-alpha feathering. The exact mask remains authoritative inside the padded ROI.
- Browser preview requests reuse a completed higher-resolution image or share pending work only when every revision/selection/version/view identity field matches. New identities invalidate prior work. Project polling schedules its next read after settlement and can recover when no initial project exists. Acceptance still requires the independent revision/selection preview gate.

## Reproduce

Use Node.js 24 and install dependencies with `npm run setup`. Run each revision separately on the same host:

```sh
PERF_REPO="$PWD" PERF_DATA="$(mktemp -d)" PERF_LABEL="$(git rev-parse HEAD)" \
  node scripts/benchmark-pipeline.mjs
```

The command prints its data directory and writes `results.json`. It creates only synthetic images in that directory. Use the same directory once for HTTP protection responsiveness (the operation adds a second protection):

```sh
PERF_REPO="$PWD" PERF_DATA="/the/printed/data/directory" \
  node scripts/benchmark-protection-http.mjs
```

To measure an older checkout with this harness, set `PERF_REPO` to that checkout. Do not rerun against an already initialized benchmark project; start a fresh directory. Timing tests are informational, not CI pass/fail thresholds. Public CI runs deterministic correctness tests.

## Same-host measurements

Baseline: `621cf4979d236cf291d130ae527496728a4a666e`. Linux x64, Node.js v24.19.0. Both versions used the same synthetic fixture, dependency installation and host. Times below are observed wall-clock durations, not hardware-independent guarantees.

| Workload | Before | After |
| --- | ---: | ---: |
| Inspect, no notes, 2400 × 1600 detailed protected source | 2.018 s | 1.857 s |
| Inspect, four notes, same source | 8.338 s | 1.886 s |
| Protected detail preview, 1400 × 933, three runs | 1.552–1.628 s | 1.463–1.556 s |
| Full protected detail render, 2400 × 1600, two runs | 4.558–4.571 s | 4.105–4.305 s |
| Pure composite, one small region, 15.992 MP, two runs | 1.623–1.666 s | 0.048–0.050 s |
| Pure composite, four distinct small-reference regions, 15.992 MP | 6.533 s | 0.118 s |
| Second protection, HTTP request total | 3.661 s | 2.820 s |
| HTTP protection, maximum event-loop delay (10 ms monitor resolution) | 1.416 s | 0.014 s |

The large compositor improvement applies to small protected regions. Large feather bounds or full-frame masks reduce the ROI benefit. Rendering, encoding and image decoding still cost time. Unprotected preview and initial protection are not materially optimized: the first protection measured 0.189 s before / 0.238 s after, including extra transactional integrity checks. The final benchmark RSS sample was about 521 MiB before / 545 MiB after; operation-local reuse trades some retained frames for less repeated work. These are process RSS samples, not portable peak-memory limits.

## Validation and limits

`npm test` includes the existing protected-render, selection, lettering, migration and UI tests plus new session, stale-commit, duplicate-commit cleanup, source/reference tampering and randomized compositor-oracle checks. The optimized compositor matches the baseline bytes across 80 deterministic combinations of rotation, crop, feather, rectangle/radial masks, reference groups and alpha (including zero alpha).

Local photographic replay separately compares output hashes with previously inspected Tower, portrait and horizon outputs, including the capped 16 MP Tower export. Private photos and their pixels are not included in this repository or benchmark harness.

Real-browser visual/interaction QA was unavailable because localhost browser access was denied in the execution environment. Node UI-state/request tests and real HTTP serving checks passed; they do not replace visual browser QA. No tunnel or deployment was used to bypass that restriction.
