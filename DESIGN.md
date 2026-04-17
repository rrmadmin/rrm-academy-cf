# RRM Academy Design System

Entry point for everything visual in this project. Read this first to know where to look, where to edit, and what gates block your deploy.

## Artifacts

| File | Role | Who reads it |
|------|------|--------------|
| `docs/design/design-system.json` | **Machine-readable SSOT.** Auto-generated. Contains every token, every theme, brand rules, fonts, typography. | Agents, LLMs, scripts |
| `docs/design/design-system.manual.json` | Hand-curated non-CSS facts (brand rules, fonts, typography scale). Source for the manual block of the SSOT. | Humans editing brand or typography |
| `src/styles/global.css` | Runtime source of CSS tokens. Every `:root` variable across three themes (light, dark, eink) lives here. | Humans editing tokens |
| `src/styles/fonts.css` | `@font-face` declarations for Cormorant Garamond + Inter. | Humans editing font loading |
| `STYLE-GUIDE.md` | Narrative companion. Describes philosophy, typography intent, component patterns. Not machine-parsed. | Humans onboarding |
| `src/components/Header.astro` | Canonical wordmark treatment (`.logo__text`). | Humans designing branded assets |

## Brand essentials (quick reference)

- **Wordmark:** "RRM Academy" in Cormorant Garamond 600, color `--text-primary`. Pure text. **No mark, monogram, icon, circle, seal, or glyph.** The tree logo is deprecated. Do not invent one.
- **Accent:** `--accent` (light: `#725e7e`, dark: `#b8a3c4`, eink: `#5a5045`). Purple. Never rose. Rose is a semantic palette used for community/feminine UI, not brand signaling.
- **UI font:** `--font-body` (`Inter`). **Display font:** `--font-display` (`Cormorant Garamond`).
- **Dark variant of any branded asset:** use `--footer-bg` (`#313131`) + `--footer-accent` (`#c9b8d3`) so it reads as native to the site footer.
- **Philosophy:** purple as authority. Used sparingly for accent links, buttons, interactive states. Never competes with content.

Full brand block lives in `docs/design/design-system.json` under `brand`.

## How to edit

### Change a color, spacing, or any CSS token

1. Edit `src/styles/global.css` (find the token in the relevant `[data-theme=...]` block).
2. Run `npm run design-tokens`. This regenerates `docs/design/design-system.json`.
3. Commit both `global.css` and `design-system.json`.

### Change a brand rule, font stack, or typography value

1. Edit `docs/design/design-system.manual.json`.
2. Run `npm run design-tokens`.
3. Commit both files.

### Never

- Never edit `docs/design/design-system.json` by hand. It is auto-generated and CI blocks deploys on drift.
- Never guess token names. If a token is not in the SSOT, it does not exist. Use `npm run design-tokens:audit` locally to list phantoms in your branch.

## Gates (CI-enforced)

| Gate | Script | What it blocks |
|------|--------|----------------|
| SSOT drift | `npm run design-tokens:check` | Deploy fails if `design-system.json` is stale relative to `global.css` or `design-system.manual.json`. |
| Phantom tokens | `npm run design-tokens:audit` | Deploy fails if any `var(--X)` in `src/` or `functions/` references a token that is neither in the SSOT nor defined locally. Example caught: `--color-primary`, `--color-surface`, `--color-error` (typo), `--purple-400` (doesn't exist). |
| Mobile hamburger | `npm run verify-hamburger` | Deploy fails if `Header.astro` loses the mobile `.mobile-toggle` right-alignment rule or the hamburger element itself disappears. |

Runtime counterpart for the hamburger gate: `tests/e2e/mobile-responsive.spec.js` asserts at iPhone SE / XR viewports that the hamburger element sits within 48px of the header's right edge. Run locally with `npm run test:e2e:mobile`.

## Token categories

Top-level keys in `design-system.json`:

- `brand` - wordmark rules, accent rules, dark-asset palette, philosophy
- `fonts` - display + UI font stacks, loaded weights
- `typography` - h1-h4 + body + prose + meta + eyebrow scale, hero clamps
- `themes.light`, `themes.dark`, `themes.eink` - 73 tokens each, grouped by:
  - `palette` (purple, neutral, sand, rose, sage)
  - `status` (green, amber)
  - `tier` (tier1, tier2, tier3 - endo survey)
  - `semantic` (bg-*, text-*, accent, border-*, color-error)
  - `footer` (always dark in light mode)
  - `shadow`, `grain`, `gradient`, `focusRing`
- `shared` - 19 theme-independent tokens (spacing, radius, maxWidth, fontFamily)

## Available npm scripts

```
npm run design-tokens              regenerate SSOT from global.css + manual.json
npm run design-tokens:check        verify SSOT matches sources (CI)
npm run design-tokens:audit        verify every var(--X) in code is a real token (CI)
npm run design-tokens:audit:strict also fail on orphan tokens defined but unused
npm run verify-hamburger           verify mobile hamburger still right-aligned (CI)
npm run test:e2e:mobile            runtime mobile tests including hamburger position
```

## Deprecated

- `docs/design/tokens.json` - removed 2026-04-16. Was a static snapshot that drifted from `global.css`. Superseded by the auto-generated SSOT.
- `docs/design/design-system.html` - obsolete rendered reference (369 lines). Safe to delete; nothing links to it.
- Tree logo - deprecated. Do not use, do not draw, do not reference.
