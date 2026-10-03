# Rendering reference fixtures

Prepared 2026-09-30. Samples are evaluation inputs, not automatic recipes or proof that every photo should be edited.

| Case | Source | Rights / preparation |
| --- | --- | --- |
| portrait | NASA, Eileen Collins (`astronaut.png`) from the official scikit-image 0.26.0 wheel | Public domain per [scikit-image dataset documentation](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.astronaut); original 512 × 512, RGB |
| night | SpaceX, `rocket.jpg`, official scikit-image wheel | Public domain per [dataset documentation](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.rocket); original 640 × 427, dusk with dark sky and point lights |
| high-contrast | Lav Varshney, `camera.png`, imageio official binaries | CC0 per [dataset documentation](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.camera); original 512 × 512 grayscale |
| backlight | Existing project asset `public/assets/alpine-demo.png` | Product example, resized to 640 × 480; source authenticity is not independently verified |
| sky | Upper sky/sun crop from the same project example | Crop (400, 0, 1448, 340), resized to 640 × 208; not an independent sky photograph |

The P6 PPM copies let Node tests read reference pixels without an image decoding dependency. Preparation uses Pillow with Lanczos resizing. Public samples downloaded through the official package were fully decoded to reject truncated downloads. A partial imageio astronaut download and a failed rocket PNG link were excluded and replaced with complete official wheel data.

These cases cover one light skin portrait, one dusk scene, one grayscale high-contrast scene, and two views of the product example. They do not cover different skin tones, mixed lighting, camera RAW, long-exposure noise, or a broad population of scenes.
