# FrameLark website

This application contains the public FrameLark website and a browser-only editing workspace for GitHub Pages. The public source preserves the website approved in the local design preview. It is deployed separately from the complete Node.js studio in `apps/studio/`.

Build from the repository root:

```sh
node apps/website/build.mjs --site-url https://geminilight.github.io/FrameLark/
```

The output is `_site/`. GitHub Actions supplies the current Pages URL when publishing, so project paths and custom-domain paths are handled consistently. No environment files, model keys, local drafts or private projects are included.

The Pages workspace supports browser photo import, styles, light and color controls, cropping, local adjustments, versions and download. AI review is clearly unconfigured. `static-runtime.js` supplies this availability state in the browser and prevents server-only requests from being sent. It never returns fabricated model results.

Run the complete workspace for visual AI and Agent file-project collaboration; see the [deployment guide](../../docs/DEPLOYMENT.md). Keep the generated portrait's AI attribution and the photographic source credits when updating the website.

The homepage places case studies inside the three feature chapters. Photography Eye defaults to the lakeside scene and switches among lakeside, arcade and cafe inputs with their shooting-reference boards, using tabs, arrow buttons, keyboard navigation and touch swipes. Retouching keeps the existing parameter comparisons and a real saved-version example; the collection chapter shows the two-photo example with selectable theme, ordering and editing steps. Short opacity transitions honor reduced-motion preferences. Scrolling preserves photo geometry and the comparison divider is controlled manually. Complete source credits remain available in the case detail page.

## Verification

Run `node --test test/web/website-cases.test.js` for domain-root and project-path builds, the four case links, and unchanged full-resolution source resources. Run `npm run test:website` with agent-browser installed for case switching, visible failure/retry, late-image cancellation, dialogs, keyboard comparison, 390/320px navigation, reduced motion and legacy links. Pages runs both checks before publishing.

The homepage uses self-hosted font assets: CJK subsets derived from Noto Sans SC at 400 and 600 weights, plus Manrope for Latin text and numerals. Original copyrights and SIL Open Font Licenses are shipped at `public/assets/website/fonts/licenses.txt`. Verify CJK glyph coverage and update the subsets when adding new copy. The runtime does not request fonts from Google.

The lakeside case is the first default Photography Eye scene. Chapter shortcuts and explicit workspace/plugin entry labels make the starting paths distinct. Navigation loading, image decoding, retry feedback, keyboard control and mobile menu background/focus handling are part of the homepage interaction contract. Motion must preserve component position and photo geometry.
