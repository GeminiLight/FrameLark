# RAW pipeline v1

Baseline: specification started on main `e05a57c`, including #24/#25; final branch rebased onto main `7b4a397` with the subsequent website and Photography Eye plugin updates. The existing JPEG/PNG editing pipeline and saved recipes must remain reproducible.

## User outcome

- Import a supported camera RAW on the local studio or the independent Skill. Preserve the exact original file.
- On macOS prefer the actually available CIRAWFilter decoder; if unavailable or unable to decode that file, use LibRaw through rawpy. Other platforms use rawpy. Report the selected backend and its version; do not silently switch later when replaying saved edits.
- Edit using the existing independent step inspector. RAW opens the shared backend editor so browser Canvas never becomes the authoritative working image.
- Default export is daily sharing, JPEG/sRGB/2048px. Offer print JPEG, lossless PNG, and a full-resolution 16-bit TIFF master for RAW. Never obtain a supposed 16-bit master by padding an 8-bit preview.

## Contracts and ownership

`raw/contract.mjs` owns detection, limits and manifest validation; `raw/backends.mjs` owns platform selection and bounded subprocesses; the Swift/Python adapters only decode to a fixed interchange format. `raw/source.mjs` owns immutable master and proxy files; `raw/render.mjs` owns geometry sampling, bounded tiles, linear processing and output encoding. Project transactions continue to own revisions and accepted recipes. UI code never invokes a decoder or edits master files.

Interchange: little-endian Float32 RGBA, scene/linear sRGB, alpha in the existing engine's 0–255 convention. Adapters record their native source precision: rawpy's linear 16-bit RGB and Apple's floating-point output. This iteration does not promise wide-gamut camera-look matching, Kelvin controls or recovery of sensor-clipped detail.

Manifest v1 binds original checksum, backend/version, decoder/version, native dimensions, fixed as-shot development settings, working space, master/proxy checksums and sizes. Cached assets are immutable. Unknown or missing manifests, mismatched checksums and non-finite data fail without overwriting original files. JPEG/PNG source normalization remains unchanged.

## Preview and resource policy

- Decode once during import, outside the main/UI thread. Cache the high-precision master on disk and a bounded linear proxy (maximum 2048px) for editing.
- Preview processing consumes the cached linear proxy, then encodes sRGB only at display output. Changing step values, names, masks or order never re-decodes RAW.
- Keep final preview caching bounded and keyed by source/development identity, recipe rendering identity, output grid and display mode. Deduplicate identical work; debounce rapid inspector input, retain the last complete image, and discard late responses.
- Full-resolution export samples the master in bounded tiles with the summed neighborhood halo. Geometry, grain coordinates and masks use native image coordinates. No full-size Float32 processing buffers per step.
- Decode/import admission is one active task; cancellation and timeout terminate the child and clean only temporary derivatives. Limits are explicit: 512 MiB input, 96 MP/16384px source, 2048px proxy, bounded render buffers. Unsupported camera/compression gets a clear error; other photos remain usable.
- RAW files are local only. Ordinary cloud/raster import rules retain their current limits. RAW project exchange must not flatten the source into a browser JPEG.

## Precision and compatibility

Add an opt-in linear input/output path to the existing stack kernels; the existing byte path must retain its golden RGBA results. RAW exposure, tone, color, detail, finish and masks operate on Float32 before the final 8-bit/16-bit encoding. Legacy aggregate settings are converted to the equivalent tool families for RAW processing. Unsupported legacy resources must fail explicitly, never silently disappear.

The master TIFF uses 16-bit RGB, lossless compression and an sRGB ICC profile. Display proxies and share JPEG use the same output transform. Color profiles must describe actual data. Original and edited RAW references are bound to the fixed development manifest, not just an extension or camera name. Export and snapshot identities include the RAW source manifest.

## Acceptance tests

1. Platform selection, unavailable backend, unsupported camera and cancellation have real discriminating tests. Both adapters compile/run on macOS; rawpy decodes a generated public/synthetic DNG. No private photos used.
2. Original bytes survive import/edit/export unchanged; every manifest checksum and array dimension is validated.
3. Same-source repeated previews reuse derivatives; changed recipes invalidate only rendered previews. Benchmarks record cold import and repeated preview behavior without an invented universal latency promise.
4. Neighboring 16-bit input levels survive a neutral 16-bit TIFF export; preview encoding does not become export input. Inspect metadata and pixel buffers.
5. Tiled and single-grid renders agree on a representative small image, including detail halos, masks, crop/rotation and grain coordinates.
6. Existing raster tests, shared-engine/architecture/plugin checks and export tests pass. New RAWs can be edited in the native inspector and share export remains the default.
7. Source/decode errors, abandoned imports and oversized data retain existing projects and current previews.

Commit in reviewable units: source/backend contracts; precision and cached rendering; local import/export UI; tests and evidence. Commit and push the resulting branch after acceptance.
