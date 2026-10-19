<!-- Owner: server/console/icons.ts, server/console/client.css, server/build.ts -->

The console serves these assets from its private listener. `build:server` copies this directory to `dist/console/assets/`.

- `icons.svg` contains the selected, unchanged icon geometry from `lucide-static@1.59.0`, grouped as SVG symbols. Source: https://lucide.dev and https://www.npmjs.com/package/lucide-static/v/1.59.0. `Lucide-LICENSE.txt` retains the package's license and attributions.
- `MiSans-Regular.woff2` and `MiSans-Semibold.woff2` are unmodified files from `MiSans/woff2/` in Xiaomi's https://hyperos.mi.com/font-download/MiSans.zip. They contain the full character sets supplied by Xiaomi.
- `MiSans-LICENSE.pdf` is Xiaomi's license from https://hyperos.mi.com/font/zh/download/. The login page and footer identify MiSans and link to this license.

Font files have a private one-day browser cache. Scripts, styles and the icon sprite are served without caching.
