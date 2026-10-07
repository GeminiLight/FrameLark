# Versioned installation and platform runtime

Baseline: main `d8a330a`. Installation keeps eager preparation of Sharp/Canvas and all visual examples. RAW retains its separate existing setup command. Pixel algorithms and pinned dependency versions do not change.

## Outcomes

- The default installer downloads a published GitHub Release, not a Git checkout. Bootstrap scripts, both plugin ZIPs and a checksum/size manifest are release assets.
- A Node-built-ins-only installer works from a file or stdin without Git or an existing checkout. It verifies the selected archive, extracts only bounded regular files, retains a versioned local package and registers that directory as a Codex marketplace.
- Full installation prepares and verifies retouch dependencies before registration and again at the installed location. Photography Eye stays independent. Every example image remains included and verified.
- On supported native platforms, remove unused WASM and foreign-platform image packages only after both native adapters actually load. Preserve WASM when it is active, explicitly requested, or needed by another dependency. Never disable all optional dependencies.
- New source preparation failure leaves existing marketplace configuration untouched. Conflicting sources are preserved. Canonical FrameLark Git sources can migrate to the verified release source with rollback on registration failure. Never clean user photo projects or unrelated caches.

## Responsibilities

The portable runtime helper owns platform selection and conservative pruning. Skill setup owns dependency installation and a fresh-process readiness check. The standalone release installer owns HTTP limits, manifest/archive validation, local staging and marketplace registration. Release construction owns the allowlist and hashes; a tag-triggered workflow builds and publishes the resulting assets.

The release manifest binds repository, release tag, plugin versions, exact asset names, byte lengths and SHA-256. Install metadata is separate from plugin content. Archives cannot contain traversal, links, configurations, private runtime directories, unexpected skill roots or files outside the release allowlist. Limits: 16 MiB ZIP, 32 MiB expanded payload, 1000 entries. No third-party extraction package or shell script is required.

## Acceptance

1. Both variants preserve every tracked skill resource, including the complete visual-case catalog and its checksums; no website, test fixtures, Git history, runtime dependencies or local user data enter the archives.
2. Installer tests exercise a real archive and staged filesystem: success, repeat installation, checksum mismatch, missing release/assets, traversal/oversize/corrupt input, source conflict, eager setup failure and rollback.
3. File/stdin bootstrap succeeds without repository modules or Git. A failed full-runtime preparation never reports success. Installed identity, exact skill set and enabled state are verified.
4. Native/WASM selection tests discriminate platform and loaded adapter. Fresh native installation measures before/after size and checks PNG geometry/text and 16-bit TIFF output equivalence. Linux, macOS and Windows CI exercise actual native setup.
5. Existing regression, shared-engine, architecture and plugin distribution checks pass. Website/docs installation commands point at release assets; local build installation remains available for development.

Public release availability is reported separately from code/artifact readiness. Publishing a release never occurs merely because a build succeeded.

## Local evidence

- Full regression: 566/566 passed. Architecture, shared-engine and both plugin checks passed.
- Fresh macOS arm64 setup: 43.927 MiB native dependencies, down from 53.172 MiB. No package versions changed. PNG/text/geometry and 16-bit TIFF with ICC passed.
- A real Codex QA marketplace installed version 0.1.8 and reported installed/enabled. All 181 source files matched release hashes; all 11 visual-case PNGs remained present. Installed size was 53.181 MiB, without Git or WASM. The temporary QA plugin and marketplace were removed afterward.
- Release ZIPs were parsed and verified by the actual installer: full 8.506 MiB; Photography Eye 0.882 MiB. Runtime modules are not duplicated in the persistent release source cache.
- The website command and prefilled request now select Release assets. The initial validation preceded publication; v0.1.8 is now public. The main branch adds photo-series in v0.1.10, which needs its own verified release.

## Merge review follow-up (2026-10-07)

The release installer validates all three skills for v0.1.10 and newer, retaining the two-skill contract for older pinned releases. A local development marketplace nested inside the official checkout is preserved. Cached release content must match the entire file allowlist, including rejecting added files and links. Release builds validate installer bounds before promotion and replace the complete asset set so stale ZIPs cannot enter a later publication.
