# Font Awesome subsets

`index.html` loads `src/assets/fontawesome-subset.css`. Generate it from the installed
`@fortawesome/fontawesome-free/css/fontawesome.min.css`; do not edit the generated
stylesheet or maintain a separate icon-to-codepoint map.

The generator scans complete `fa-*` names throughout `.vue`, `.js`, and `.scss` files
under `src`, including dynamic class literals in bindings, arrays, and menu objects.
Keep every possible icon name as a complete literal (for example,
`open ? 'fa-times' : 'fa-bars'`); assembling names as `'fa-' + name` cannot be scanned.
Generated CSS is excluded from the scan so removed icons do not retain themselves.
Unknown icon names fail generation with a list of missing mappings.

To regenerate CSS and both font subsets after adding icons or updating Font Awesome:

```sh
yarn icons:fontawesome
```

Font generation requires the existing `pyftsubset` command (FontTools with WOFF2
support). `src/assets/main.scss` continues to define the font faces and solid/regular
weights; the generator writes `fa-solid-subset.woff2` and `fa-regular-subset.woff2`
under `src/assets/fonts`.

When the existing font subsets already contain all required glyphs, regenerate just
the CSS without invoking FontTools or writing fonts:

```sh
yarn icons:fontawesome --css-only
```

The generated CSS retains the upstream license and all shared rules verbatim,
including font/pseudo-element behavior, accessible generated content and its fallback,
animations and reduced-motion handling, sizing, positioning, and stacking utilities.
Only icon mapping selectors are filtered, preserving each used alias independently.

Run the focused checks without building the application:

```sh
yarn test:unit run scripts/generate-fontawesome-subset.spec.js
```

The checks cover static and dynamic class literals, aliases, CSS character escapes,
missing mappings, shared rules, the HTML link, and every icon currently found in
source. They also detect a stale generated stylesheet. Check in the generator,
stylesheet, and any changed font subsets together when the icon set changes.
