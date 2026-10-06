# RAW PR #29 review

PR: https://github.com/GeminiLight/FrameLark/pull/29

Reviewed contributor head: `37ea461203e92cac78428663c29655bd1916e5fc`. Integrated with main `97b9da7f0ea2c37cc53d2292533464ae7dd4cbd6`, preserving the published website fixes and quick Photography Eye installer. The RAW implementation and its original commits remain credited to Yijie Xu (@yeahjack).

## Scope and evidence

- Read the platform adapters, immutable source manifests, linear proxy and master rendering, tile halos, protection references, shared render changes, project import/export, cancellation, packaging and real-backend gates.
- The original head passed Linux and macOS checks, including a generated Bayer DNG and a checksum-bound public Nikon NEF. These are CI observations; this review did not install a decoder into the user's account or claim to test every camera locally.
- Shared-engine parity, architecture and both plugin package checks passed. The website browser gate passed scene recovery, keyboard navigation, crop/retouch comparison, collection interactions and 390/320px layouts. The live installation page also passed mobile overflow and copy-request checks.
- Local integrated regression: **545/545 passed**. Ordinary raster golden checks remain in the suite. Five additional tests reproduce the import recovery failures below, then pass after the corrections.
- RAW remains local only, with fixed as-shot development and sRGB output. Windows hardware, all camera/compression combinations, 96 MP worst-case load, wide-gamut output and Kelvin controls remain outside the proven scope.

## Corrections before merge

1. **RAW preparation inherited a 30-second browser deadline.** The decoder itself allows 180 seconds per job and queues up to eight jobs. A large or queued RAW could be marked failed while still decoding. RAW preparation now has a separate 30-minute outer deadline covering bounded queue admission, upload and proxy preparation. Header/image reads retain their 30-second limit. The user can cancel during the wait.
2. **A preparation timeout only rejected its wrapper.** The request did not receive an abort, so the decoder could continue and consume queue capacity. Each bounded operation now owns a child AbortController. Timeout and user cancellation abort the actual preparation request, prevent late commits and preserve subsequent usable photos. The server already propagates disconnected requests to its bounded decoder.
3. **An oversized RAW was labelled “over 30 MB.”** It now reports the actual 512 MiB RAW limit with an actionable recovery message. Browser RAW extension detection is shared by preparation and deadline selection.
4. **Native help still claimed that RAW was unsupported.** The help now distinguishes 8-bit raster editing from local RAW processing and 16-bit sRGB TIFF export.

The five new checks cover a RAW completing after 30 seconds, abort on an ordinary preparation timeout, the RAW size message, abort on the RAW outer deadline with later photos remaining usable, and immediate user cancellation reaching a RAW fetch. Virtual time proves the deadlines without a 30-minute test wait.

## Merge decision

Accept after the corrected head passes the required checks. Preserve the contributor's commits, current website structure, standalone Photography Eye plugin and quick installation flow. A passing numerical pipeline does not establish aesthetic quality across genres; continue to judge actual retouch candidates at full view and detail view.
