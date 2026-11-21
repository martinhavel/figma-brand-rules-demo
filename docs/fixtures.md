# Fixture specification

These are fictional static inputs, not generated outputs and not a live Figma
export. Each `figma-variables-local.json` follows the documented REST local
variables envelope: `status`, `error`, `meta.variableCollections`, and
`meta.variables`. Variables are map entries keyed by ID; collections enumerate
their modes and `defaultModeId`.

## Brand and mode boundary

| Brand | Modes | Default |
| --- | --- | --- |
| alpha | `light`, `dark` | `light` |
| beta | `default` | `default` |
| gamma | `default` | `default` |

Every brand supplies primitive color, spacing, radius, and typography fields,
plus semantic color variables. `semantic/color/text` and
`semantic/color/background` are `VARIABLE_ALIAS` values pointing at their own
brand primitive IDs. These aliases deliberately cross the two collections in
their brand; no alias crosses a brand boundary. Collection modes map by their
shared mode name (`light`, `dark`, or `default`), not by equal mode IDs.

## Intended later conversion

The implementation may convert each selected brand/mode to DTCG 2025.10, then
emit CSS variables, server JSON, and ASE. `npm run pipeline` writes those deterministic artifacts under ignored `artifacts/` paths.
`fixtures/dtcg-typography.expected.json` is a single-brand root required converter fixture:
the `typography` `$value` contains all five required properties—`fontFamily`,
`fontSize`, `fontWeight`, `letterSpacing`, `lineHeight`—and references the
primitive DTCG values. `fontSize` and `letterSpacing` are dimensions;
`lineHeight` is a number.

## Rules, contrast, and canaries

Each brand's `rules.json` has stable IDs, a reason, and a source for color-pair,
minimum-font-size, spacing-scale, and unique-canary rules. Color pair paths
match the contract: `semantic.color.text` and `semantic.color.background` in
the selected brand's resolved mode. Numerical WCAG verdict is independent of
whether that ordered pair is listed as brand-approved.

`fixtures/wcag-contrast-vectors.json` provides manually inspectable opaque sRGB
vectors. It records the WCAG relative-luminance/contrast equation, source, and
AA thresholds (normal 4.5, large 3). The `#777777` on white ratio is deliberately
below normal AA (4.478089453577214) and above large-text AA.

Future changelog generation must consider both token conversion diffs and rule
diffs. This specification does not define a generator, execute a conversion,
or assert that frozen acceptance criteria have passed.
