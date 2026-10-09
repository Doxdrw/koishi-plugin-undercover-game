# Notices and asset provenance

## Default hero cards

The ten default PNG hero cards under `uc-pics/` are identified by stable hero
keys in `uc-pics/manifest.json`. Their dimensions and SHA-256 values are
recorded there for package integrity checks.

## Typeface use in raster output

The card typography uses the following typefaces:

- Qiji (齊伋體), QIJIC Combo 0.0.1, including Source Han Serif fallback glyphs:
  SIL Open Font License 1.1.
  [Qiji license](https://github.com/LingDong-/qiji-font/blob/v0.0.1/LICENSE),
  [Source Han Serif license](https://github.com/adobe-fonts/source-han-serif/blob/release/LICENSE.txt).
- Noto Sans CJK 2.004 and Noto Serif CJK 2.003: SIL Open Font License 1.1.
  [Sans license](https://github.com/notofonts/noto-cjk/blob/Sans2.004/LICENSE),
  [Serif license](https://github.com/notofonts/noto-cjk/blob/Serif2.003/Serif/LICENSE).
- LXGW WenKai (霞鹜文楷) 1.522: SIL Open Font License 1.1.
  [License](https://github.com/lxgw/LxgwWenKai/blob/v1.522/OFL.txt).
- DFKai-SB (標楷體) 5.02, supplied with Windows: used for static graphic output
  under [Microsoft's font terms](https://learn.microsoft.com/en-us/typography/fonts/font-faq).

These credits identify the typefaces used to render the cards. The package
distributes raster images, not font software or editable design sources.

## Software license

The plugin source code and project documentation are licensed under the
MPL-2.0 as described in `LICENSE.md`. The packaged card artwork has separate
terms in `uc-pics/ASSET-LICENSE.md`.
