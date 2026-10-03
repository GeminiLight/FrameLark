# Real-photo quality set

Prepared 2026-09-30 from the official scikit-image 0.26.0 wheel, fully decoded before conversion. Rights are described in the [official dataset documentation](https://scikit-image.org/docs/stable/api/skimage.data.html). `manifest.json` records checksum, dimensions, source, parent, condition and pending visual-review status.

| Independent photo | Subject / condition | Attribution |
| --- | --- | --- |
| portrait | Light-skin portrait; hair, face, dark collar and bright clothing | NASA / Eileen Collins, public domain |
| night | Dusk sky, dark towers, small point lights | SpaceX, public domain |
| contrast | Grayscale subject against brighter surroundings | Lav Varshney, CC0 |
| still-life | Warm wood, bright porcelain, metal reflections | Rachel Michetti / Pikolo Espresso Bar, CC0 |
| pet | Eyes, fur, fine whiskers, soft background | Stefan van der Walt, CC0 |
| deep-field | Small astronomical lights against deep darkness | NASA / Hubble, public domain |

The other five cases derive from these: a 2:3 portrait crop, a wide dusk crop, reduced encoded brightness, increased encoded brightness, and seeded Gaussian channel noise (sigma 12). They are not additional independent photos, real exposure brackets, sensor-noise measurements, or camera RAW. No independently verified architecture, mixed-lighting portrait, varied skin-tone population or noisy sensor RAW is currently represented. The prior alpine product example remains in the earlier calibration set; it is not counted as an independently authenticated real photograph here.

## Repeatable checks

- Keep all prior tests. Check fixture checksums and complete pixel data before testing.
- `npm test`: 33 fixture/recipe output hashes, previous face-hue/endpoint/halo/noise checks, crop protection and review-contract checks. A matching hash establishes regression consistency, not universal photographic quality.
- `npm run quality`: save original/current statistics, endpoint changes, changed baselines and PPM images under `artifacts/quality`.
- `npm run quality:vision`: use the running app's configured visual service and actual PNGs. Save model provenance, recommendations and potential failures. Strong parameters are review flags, not automatic proof of error. Model region checks and approximate manually marked protected regions cannot establish perfect object detection. Missing connection means visual review was **not run**.
- Human review: inspect face/eyes/whiskers at 100%, highlight transitions, noise and texture, bright or dark halos, crop cut points, and the recommendation's cited evidence. Record observations in `artifacts/quality/review-log.json`; do not mark unrun semantic checks as passed.
- New baseline: only after inspecting changed image outputs and documenting the judgement, run `node scripts/photo-quality.mjs --update-baseline` explicitly. Routine tests never modify the baseline.

Recreate source copies using `python scripts/prepare-quality-set.py --wheel /path/to/scikit-image.whl` with the official wheel and Pillow. This is a preparation dependency; application/runtime tests use no external packages.
