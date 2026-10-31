# Vendored KaTeX

- Version: **0.16.11** (npm `katex`, files from https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/), MIT license (see LICENSE).
- `katex.min.js` 275,414 bytes (unmodified).
- `katex.min.css` 21,201 bytes: only change is `@font-face src` reduced to the `.woff2` url (relative `fonts/...`); `.woff`/`.ttf` dropped.
- `fonts/*.woff2`: 20 files, about 270 KB total (unmodified).
- Loaded lazily by `js/math.js`; precached in `sw.js`.
