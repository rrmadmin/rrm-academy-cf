---
title: Naomi Knowledge Panel — Comet handoff (chunked self-edits)
created: 2026-06-27
for: Naomi, run from HER OWN account/Comet (Wikimedia + X + bio.site + ORCID logins). NEVER mowsenter.
parent_plan: 2026-06-27-naomi-knowledge-panel-plan.md
entity: Wikidata Q139936526 — https://www.wikidata.org/wiki/Q139936526
status: Chunks 0–6 READY (Chunk 0 gated on Brian's CC-BY-SA decision). HELD chunks at bottom — DO NOT RUN.
---

# How to use this doc

Run ONE chunk at a time. For the Comet chunks, paste the fenced prompt into Naomi's Comet and let it act, then do the verification line yourself. Space the edits out naturally (a few minutes apart). This is Naomi self-editing her own biography from her own account — that is allowed and normal.

**Account rule (hard):** every edit here is from Naomi's own Wikimedia / social / ORCID logins. Do NOT use the `mowsenter` Wikidata account for anything in this doc. The same Wikimedia login works for both Wikimedia Commons (Chunk 0) and Wikidata (Chunks 1–3).

**Order:** Chunk 0 → 1 first (the unlock, and 1 depends on 0). The rest can run in any order in the same sitting.

---

## Chunk 0 — Wikimedia Commons headshot (THE UNLOCK)

**Photo chosen (Brian, 2026-06-27): Naomi's current Instagram profile picture** — the white-coat selfie with the pink butterfly pin. This is the same shot used as the RRM Academy author headshot.

> ONE CONFIRM before uploading: this is a selfie Naomi took herself. If so she owns the copyright and "own work" + CC-BY-SA 4.0 is correct and truthful. CC-BY-SA 4.0 is irrevocable and lets anyone reuse the photo commercially with attribution. If someone else actually took it, stop and get their written CC release first (Commons deletes professional-looking "own work" uploads that lack permission).

**Resolution note:** do NOT use the file Instagram serves — its profile-pic copy is only 100x100, too small for a good panel thumbnail. Use the largest copy of the same photo, in this order of preference:
1. The original full-resolution selfie file from Naomi's phone (best).
2. Fallback: the 600x600 site copy at `https://rrmacademy.org/images/authors/naomi-whittaker.webp` (convert to JPG before upload).

This is the step Ben Sigman calls the single highest-impact action; his panel appeared ~5 weeks after it. Do it as a guided manual upload:

1. Prepare the file: a JPG or PNG of the chosen photo (JPG preferred). If using the site copy, convert the `.webp` to JPG first.
2. Go to https://commons.wikimedia.org/wiki/Special:UploadWizard (logged in as Naomi).
3. Upload the file. Filename (descriptive, unique): `Naomi Whittaker MD headshot 2026.jpg`.
4. Source/licensing: choose **"This is my own work"** and license **CC BY-SA 4.0** (correct because it is her own selfie).
5. Description: `Dr. Naomi Whittaker, MD, board-certified OBGYN and NaProTechnology surgeon.` Add categories like `Obstetrician-gynecologists` and `Physicians from Pennsylvania` if offered.
6. Publish. **Copy the exact final filename** (it is what Chunk 1 needs; Commons may adjust spacing/case).

Verify: the file page loads at `https://commons.wikimedia.org/wiki/File:Naomi_Whittaker_MD_headshot_2026.jpg` (or the adjusted name) and shows the CC-BY-SA 4.0 license box.

---

## Chunk 1 — Wikidata P18 (image) — depends on Chunk 0

Paste into Comet (replace the filename only if Commons adjusted it in Chunk 0):

```
Go to https://www.wikidata.org/wiki/Q139936526 (I am logged in as myself). This is my own Wikidata item.
Add a new statement:
- Property: P18 (image)
- Value: Naomi Whittaker MD headshot 2026.jpg
Type the filename exactly; pick the matching Commons file from the suggestions. Then click publish.
After publishing, confirm the statement now shows the image thumbnail on the item.
```

Verify: reload the item; the P18 image renders at the top of the statements list.

---

## Chunk 2 — Wikidata P856 (official website)

Completes the two-way bridge (the site schema already points to this item; this points back).

```
Go to https://www.wikidata.org/wiki/Q139936526. Add a new statement:
- Property: P856 (official website)
- Value: https://rrmacademy.org/about/
Click publish, then confirm the statement appears.
```

Verify: reload the item; `official website → https://rrmacademy.org/about/` is present.

---

## Chunk 3 — Wikidata references (optional, low priority)

None of the unreferenced claims are deletion-risk, so this is polish, not urgent. Two worth a source if you want them tight:

```
Go to https://www.wikidata.org/wiki/Q139936526.
1) On the statement "notable work: Tuboplasty", add a reference:
   - reference URL (P854): https://doi.org/10.1201/9781003312109-33
2) On the statement "field of work: restorative reproductive medicine", add a reference:
   - reference URL (P854): https://rrmacademy.org/what-is-rrm/
Publish each reference. Leave the ORCID and OpenAlex statements as-is (external IDs do not need references).
```

Verify: both statements now show a reference count of 1.

---

## Chunk 4 — X display name (high value, low effort)

The display name is currently `NaPro_Fertility_Surgeon`, which hurts entity name-matching. Set it to her real name (keep the @naomimwhittaker handle and the existing bio).

```
Open https://x.com/settings/profile (logged in as @naomimwhittaker).
Change the display NAME field from "NaPro_Fertility_Surgeon" to: Naomi Whittaker, MD
Do not change the @handle or the bio text. Save.
```

Verify: x.com/naomimwhittaker shows "Naomi Whittaker, MD" as the name above the @handle.

---

## Chunk 5 — bio.site credential string

Align the patient/marketing byline to canonical. The page currently reads `MD, OB/Gyn, FACOG, NFPMC, FCI`; `FACOG` is not in our credential SSOT and `MIGS` is missing.

```
Open the bio.site editor for napro_fertility_surgeon (logged in).
Change the headline credential line to exactly: Dr. Naomi Whittaker, MD, Board-Certified OBGYN, MIGS, NFPMC, FCI
Leave the rest of the page (links, descriptor) unchanged. Save.
```

Verify: https://bio.site/napro_fertility_surgeon shows the canonical byline.

---

## Chunk 6 — ORCID abbreviation fix

ORCID bio prose writes `IRRMA`; canonical is `IIRRM` (International Institute for Restorative Reproductive Medicine).

```
Open https://orcid.org/0000-0003-3706-3112 (signed in) and edit the biography/affiliation text.
Find "IRRMA" and change it to "IIRRM". Do NOT touch the UPMC employment record. Save.
```

Verify: the ORCID public bio shows `IIRRM`, and the UPMC employment entry is unchanged.

---

# HELD — DO NOT RUN (pending Brian)

These brush the UPMC-separation hold. Do not execute until Brian explicitly clears them.

- **City / residence.** Do NOT add `P551` on Wikidata or a city to X / Instagram / bio.site. Asserting a clinical city is hold-sensitive and her home city is private. A panel can instantiate without a city.
- **Primary-affiliation reframing.** Do NOT remove or demote the UPMC employer (`P108` on Wikidata, "Physician Lead, UPMC Divine Mercy" in schema/ORCID). This push is additive only. Strengthening the RRM Academy founder identity is fine; flipping the primary employer away from UPMC is not, until separation resolves.

# Post-run

- Note the date you ran Chunk 1 (the P18 add). Sigman's panel appeared ~5 weeks after his P18; start watching an incognito SERP for "Naomi Whittaker MD OBGYN" around then.
- Once a panel or a Google Knowledge Graph ID appears, tell Brian. Adding `P2622` (Google KG ID) to the Wikidata item then further strengthens the graph.
- Do NOT tweak the panel after it appears — per Sigman, edits during the settle window can cause Google to retract it.
