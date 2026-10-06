# FrameLark website

This application contains the public FrameLark website and a browser-only editing workspace for GitHub Pages. The public source preserves the website approved in the local design preview. It is deployed separately from the complete Node.js studio in `apps/studio/`.

Build from the repository root:

```sh
node apps/website/build.mjs --site-url https://geminilight.github.io/FrameLark/
```

The output is `_site/`. GitHub Actions supplies the current Pages URL when publishing, so project paths and custom-domain paths are handled consistently. No environment files, model keys, local drafts or private projects are included.

The Pages workspace supports browser photo import, styles, light and color controls, cropping, local adjustments, versions and download. AI review is clearly unconfigured. `static-runtime.js` supplies this availability state in the browser and prevents server-only requests from being sent. It never returns fabricated model results.

Run the complete workspace for visual AI and Agent file-project collaboration; see the [deployment guide](../../docs/DEPLOYMENT.md). Keep the generated portrait's AI attribution and the photographic source credits when updating the website.
