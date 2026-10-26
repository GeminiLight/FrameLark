# Responsive editing and clearer project state

Continuous range input previously cancelled each unfinished full preview, terminating its worker and discarding its render cache. A long stack could therefore show no updated pixels until the gesture stopped. Project notification reconnects could also clear an unrelated write error, while automatic browser-save candidates appeared as Agent proposals.

## Changes

- A dedicated preview scheduler admits one render and retains only the newest waiting request. A continuous gesture uses a transient, adaptive small preview; release or 180 ms without input requests the complete preview. Full results, different photo/crop contexts and replaced source pixels are cancelled when obsolete. Completed quick frames can trail the same gesture but cannot unlock export.
- Sampling retains original-space crop/rotation metadata and never changes the recipe, source pixels, final rendering algorithm, or acceptance/export checks. Only a latest full frame updates the final-effect signature and histogram. Returning from the browser's page cache resumes rendering instead of reusing a disposed renderer.
- Project save state covers active edits, failed writes, conflicts and native-editor changes. Notification connection state is separate and cannot erase a failed write.
- The header names the actual storage state. Browser drafts remain in workspace settings for file projects. The legacy adjustment row explains whether prior adjustments exist. Agent handoff describes saving and copying context for an external Agent; automatic browser-save candidates remain in project history but no longer inflate the Agent comparison list.

## Evidence

Local Node suite: 826 tests passed before the final sampler and source-replacement tests; the additional tests and final targeted suite (52 tests) also passed. Architecture, shared-engine, plugin packaging and shared-retouch UI checks passed. CI runs the complete suite plus browser workflows, including a new quick-preview/export-gate check.

Daily Chrome manual checks: a 24-step, 1400 × 1050 landscape preview, slider edit, undo/redo, saved status and export availability; a 390 px embedded viewport with a portrait project. The landscape returns to the original preview dimensions. No application console errors were observed. This is a responsive viewport check, not a physical-phone performance test.

Actual Chrome Web Worker comparison on Apple M5 Pro: fixed 1400 × 1050 synthetic gradient and 24 exposure/tone/color/detail/finish steps; 14 first-step changes at intervals of at least 30 ms, one complete baseline render before each gesture, three trials per mode with alternating order. The control uses the same scheduler with interactive previews disabled; it is not a replay of the historical application.

| Trial | Mode | First visible frame | Release → full frame | Worker cancellations | Quick frames |
| --- | --- | ---: | ---: | ---: | ---: |
| 1 | Full-only control | 2484 ms | 2054 ms | 13 | 0 |
| 1 | Progressive | 209 ms | 1680 ms | 0 | 4 |
| 2 | Full-only control | 7136 ms | 6692 ms | 13 | 0 |
| 2 | Progressive | 793 ms | 7236 ms | 0 | 1 |
| 3 | Full-only control | 7175 ms | 6734 ms | 13 | 0 |
| 3 | Progressive | 706 ms | 6435 ms | 0 | 1 |

All six final pixel buffers match byte-for-byte. Timings vary substantially in the ordinary running browser environment, so these samples support earlier visible feedback, not a general throughput or percentile claim. Full-quality processing is still expensive and is not consistently faster. The adaptive size target is a heuristic, not a latency guarantee.

The local benchmark harness and raw results are retained under `ai-photography/artifacts/responsive-editing-2026-10-27/` in the task workspace. No model call or paid service was used. This change does not establish better aesthetic quality, broad device performance, or an optimal system.
