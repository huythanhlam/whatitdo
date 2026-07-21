# Whats Happenin — Brand Asset Library

All logo assets for Whats Happenin. SVGs are the source of truth (vector, infinitely
scalable); PNGs are convenience raster exports. All wordmark/lockup text is **Oswald**,
already converted to vector outlines — no font needed to render these files.

## Contents

```
badge/            Full retro "Whats Happenin ATX" illustration (Austin only)
  badge-color.svg           vector, editable
  badge-color-1024.png      raster exports
  badge-color-512.png
icon/             Sunrise mark — city-neutral, works small (favicon/app tile)
  icon.svg
  icon-512/256/128/64/32.png
  favicon.ico               (16/32/48 multi-res)
  apple-icon-180.png
wordmark/         Type-only "Whats Happenin" (Oswald, outlined)
  wordmark-1line-{teal,twotone,dark}.svg + .png
  wordmark-2line-{teal,twotone,dark}.svg + .png
  wordmark-titlecase-{teal,dark}.svg + .png
lockup-inline/    WHATS · icon · HAPPENIN (icon between the words)
  lockup-inline-{teal,twotone,dark}.svg + .png
lockup-horizontal/ icon left + two-line wordmark
  lockup-horizontal-{teal,twotone,dark}.svg + .png
lockup-stacked/   icon on top + two-line wordmark  ← the app header logo
  lockup-stacked-{teal,twotone,dark}.svg + .png
og/
  og-austin.png             1200×630 social share image (Austin)
palette.svg / .png          color swatch sheet
COLORS.md                   full color reference
```

## Variant naming

- `teal` — primary: teal-slate type `#4A6163` on light/transparent backgrounds
- `twotone` — "WHATS" teal + "HAPPENIN" coral `#F17A7E`
- `dark` — cream type `#F9FAF4` for placing on dark/colored backgrounds

## Which to use where

| Context | Asset |
| --- | --- |
| App header (current) | `lockup-stacked/lockup-stacked-teal.svg` |
| Compact nav / inline | `lockup-inline/…` or `lockup-horizontal/…` |
| Favicon / app icon | `icon/icon.svg`, `favicon.ico`, `apple-icon-180.png` |
| Social share (Austin) | `og/og-austin.png` |
| Hero / poster / merch | `badge/badge-color.svg` |
| Dark backgrounds | any `*-dark.svg` |

## Notes

- The **badge** has "ATX" baked into the artwork — it's Austin-only. Other cities need
  their own badge; the icon and wordmark lockups are city-neutral and work everywhere.
- Text is outlined, so these render identically without the Oswald font installed. To
  edit the wording, re-run `scripts` with the Oswald source (or set live Oswald text).
