# Shared retouch policy and workflow

Status: implemented and locally validated; PR checks are the final merge gate. Baseline: `6d5008b` (`origin/main`, fetched and rebased 2026-10-08). Historical review: `50597e2`.

## Scope and authority

The Web advisor and installed photo-retouch Skill use one versioned photography policy, the same on-demand reference loader, capability declarations, diagnosis/audit contracts, and document-plan compiler. Entry adapters own model transport, UI, and storage. Existing pixel kernels, RAW decoding/master rendering, legacy compatibility bases, geometry stages, queues, and handoff concurrency checks remain authoritative.

Policy provenance records the policy version/content identity and the references actually loaded. A declaration proves which material was supplied, not that an agent looked at an image or made a good photographic judgment. Independent review identity remains a host declaration.

## Deliverables and commit boundaries

1. Shared policy core, bounded task-based reference loading, CLI policy entry, separate document/legacy prompts, and common capabilities. Capability negotiation retains native fallback for unsupported state.
2. Shared diagnosis/audit normalization and Web adapters; audits bind image, composition, output/viewing scope and target context. Historical audits stay stored but cease to be current after target/annotation/composition changes. Human acceptance and Agent reviewed delivery remain distinct.
3. Shared planning entry that compiles finite atomic commands. Each selectable proposal item carries a visual objective, expected benefit, tradeoff and finding links. Existing step edits retain identity, mask, opacity and independent later steps. Proposal items, pixel steps and undo transactions are different objects. Hard dependencies only express actual resources; crop/rotation remain geometry.
4. Deterministic regression tests, explicit subscription-backed semantic acceptance runner and evidence, actual browser checks, complete relevant project checks, one PR with verified CI at its head. No merge or release.

## Acceptance matrix (fixed before implementation)

| Case | Deterministic acceptance | Model/visual acceptance |
| --- | --- | --- |
| Shared guidance | Web/CLI policy version and reference hashes agree; references loaded by task; no document prompt requesting legacy tools | Generated/public night photo: global lift preserves existing highlights; model names visible gain and costs |
| Scoped update | Original exposure changes by +0.25 EV; count, IDs, maskRef, opacity and unrelated steps unchanged; undo restores prior state | Same photo/document, explicit scoped follow-up; raw model output must compile unmodified |
| Selectable goals | Separate light/color/geometry goals map to proposal items; selections recompile from fixed base; invalid resource dependencies reject atomically | Compound request gives independent choices; missing semantic segmentation/external AI is disclosed without fake operations |
| Audit validity | Intent, annotations, selection, step order, image identity or viewing scope invalidate previous authority; history retained | Same-goal comparison records ready/revise/reject separately from scores and viewing limits |
| Shared project | Web → CLI → Web preserves recipe; stale revision and cancelled handoff cannot write | Browser interaction checks shared project, selection and current audit presentation |
| RAW and fallback | Master export reads high-precision master, not proxy; decoder failure preserves project; negotiated unsupported features retain native editor | Capability output states raster/RAW/export limits; no invented segmentation or generative atomic tool |

## Real-model protocol

Run a fixed small matrix using the local logged-in Codex subscription, model `gpt-6-astra`, reasoning `xhigh`. Never fall back to an API key or another model. One attempt per case; no outcome-selected reruns and no manual repair of a response counted as passing. Transport failure may be recorded as unavailable; deterministic results do not replace semantic validation. Preserve source/license or generation recipe, exact inputs and schema, policy/reference provenance, original model output, compilation/validation results, and rendered evidence in an explicit output directory. Do not commit credentials, personal photos, local session state or private absolute paths. Runner is opt-in and excluded from subscription-free CI.

## Invariants

- Per-step masks bound that step; final-pixel protection references a saved version. Live masks resample after upstream changes.
- Missing semantic segmentation or external image generation is a capability boundary, never a fabricated atomic command.
- RAW high-precision master, display proxy and export are distinct; ordinary 8-bit input cannot regain lost information.
- Historical legacy tools cannot be reconstructed into invented steps. Document state rejects legacy aggregate overwrite.
- Existing bounded render queues, cancellation, revision checks and project locks remain in force.

## Validation record

- Shared source: `skills/photo-retouch/policy/` and `retouch-policy.mjs`; Web/CLI/host inputs record the same policy version and actual reference hashes. Advisor document/legacy prompts are separate; analysis/reassessment adapters only explain their output fields.
- Shared planner: `edit-stack/planning.js` delegates to the original compiler and rejects hard dependencies without concrete created resources. Existing recipes and pixel kernels remain unchanged. Preview tuning preserves visual metadata and depends only on the resources it actually uses.
- Shared records: `review-protocol.js`, project runtime and Web project-review adapter. Current audit queries now include target/diagnosis/source identity; historical records remain. Whole-frame preview dimensions stay explicit. Plan generation and human acceptance have separate provenance.
- Standard editor now supports reviewed document projects through explicit diagnosis/audit buttons. Legacy reviewed state, RAW masters, lettering, final protection and unmatched local ranges retain native fallback. A browser test exposed a selection/file-event race; previews now read the committed revision before loading images.
- Local complete regression: 659 tests passed. Architecture, 45-module shared checks, knowledge, both plugin bundles and photography-eye checks passed. Browser suites passed for collaboration, editable stack, inspector, export, shared collections, navigation, website and the new shared review flow. New UI tests use a local fixture and remain subscription-free in CI.
- Real subscription matrix: five of six scenarios completed contract verification; scoped EV follow-up timed out at the fixed 240-second limit and was not retried. The result audit said `revise`, and Agent delivery was blocked. Raw outputs and all limitations are in the [acceptance evidence](evidence/shared-retouch-20261008/README.md).
- RAW: generated DNG and checksum-bound public NEF passed actual backend/master export checks; failed decoding preserved the existing project. A valid black proxy did not change 16-bit master output.
- No aesthetic equivalence across models is claimed. Policy loading and hashes establish supplied material and identities, not visual attention, an authenticated independent reviewer, or universal image quality. No merge or release was performed.
