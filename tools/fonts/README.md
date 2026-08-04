# tools/fonts

Latin subsets of the two families used by the NeoFertility Medical Training
Cohort course cover (`scripts/make-neofertility-cohort-cover.py`). Both were
identified from the vendor's original artwork by shape-matching candidate
families at matched cap height, not guessed.

| File | Family | Used for |
|------|--------|----------|
| `Montserrat-700.ttf` | Montserrat Bold | the cover's date line (`STARTS OCTOBER 13, 2026`) |
| `Poppins-500.ttf` | Poppins Medium | the cover's red feature badge |

Both are licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>). Source: Fontsource latin subsets,
`https://cdn.jsdelivr.net/fontsource/fonts/{montserrat,poppins}@latest/latin-{700,500}-normal.ttf`.

These are NOT site fonts. Nothing in `src/` or `public/` loads them; they exist
only so the cover generator can reproduce the vendor's lettering offline. Site
typography is defined in `docs/design/design-system.json` -- read that, not this.
