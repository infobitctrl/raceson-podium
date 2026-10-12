# Optimized Podium artwork

These WebP files preserve the original event photographs and brand artwork.
Cards select 480 or 960 pixel variants through `model/responsiveArtwork.ts`;
large headers can use the largest variant, capped at the original width or 1600
pixels. CSS retains the existing framing. Logos use lossless WebP at twice their
normal display width (the event wordmark allows up to 320 CSS pixels).

To regenerate from the retained originals after installing locked dependencies:

```sh
node scripts/optimize-podium-images.mjs
```

The script also regenerates `model/artworkVariants.ts`. It removes image metadata,
never reads remote images, and does not alter sponsor uploads. Commit generated
files together with any source change, then inspect cards and headers in the app.
Original asset attribution and license restrictions still apply.
