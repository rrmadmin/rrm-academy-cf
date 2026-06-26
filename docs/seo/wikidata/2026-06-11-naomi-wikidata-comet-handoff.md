# Naomi Wikidata item: chunked Comet handoff

Item: **Q139936526** ("Naomi Whittaker") -> https://www.wikidata.org/wiki/Q139936526
Prepared 2026-06-11. Every QID, property number, and identifier below was curl-verified against Wikidata / OpenAlex / CrossRef and adversarially re-checked. The item is NOT protected, so a brand-new account can edit it and create the chapter item immediately (no 4-day / 50-edit wait needed for any step here).

---

## READ THIS FIRST (account + scope)

1. **This is Naomi self-editing her OWN item from her OWN Wikidata account.** Create or use a personal account at wikidata.org. Username choice is hers (real name is fine for editing your own biography; it is a legitimate, allowed conflict-of-interest self-edit because every statement below is neutral, factual, and sourced, and nothing is being removed).
2. **Do NOT use any shared/automation account for this.** Use only Naomi's own login.
3. **Scope this account to her own item and her own publication only.** Do the three chunks below; do not have this account start editing other people's items or organisation items. Keeping it narrow avoids new-account scrutiny and keeps things clean.
4. **No long dashes (em dashes) anywhere in any value you type.** Wikidata's anti-vandalism filter flags them. Use hyphens / commas. (None of the values below contain one.)
5. **Hand Comet ONE chunk at a time.** Finish a chunk, confirm it saved, then paste the next. Do not paste all three at once.

---

## CHUNK 1 (easiest, ~1 minute): add her OpenAlex author ID

Paste this to Comet:

> Open https://www.wikidata.org/wiki/Q139936526 and make sure I am logged in to my Wikidata account (my username should show top-right, not "Log in"). Scroll to the very bottom block of the page titled **Identifiers**. Click **add statement** at the bottom of that Identifiers block. In the property box type **OpenAlex ID** and select the property **P10283**. In the value box type exactly **A5035074827** (capital A then the digits, no spaces, no URL). Click **publish**. Then confirm: the page should now show an "OpenAlex ID" row reading A5035074827 as a blue link that opens https://openalex.org/A5035074827.

Why this is safe: OpenAlex author A5035074827 was identity-confirmed as this Naomi Whittaker by matching her publication record (her 2026 "Tuboplasty" chapter, her 2016-2017 OB/GYN case reports, and her Creighton-era papers all appear on that node, overlapping her ORCID work list). Not currently on the item; not duplicated elsewhere.

---

## CHUNK 2 (~1 minute): add "field of work = restorative reproductive medicine"

Paste this to Comet:

> Open https://www.wikidata.org/wiki/Q139936526 (logged in as me). In the main **Statements** area, find the existing "field of work" statement (it currently lists "obstetrics and gynaecology") and click the **add** link next to that same "field of work" property to add a second value. In the value box paste exactly **Q139807849** and select the option whose label is **restorative reproductive medicine** (description: "approach to diagnosing and treating reproductive dysfunction by addressing underlying causes"). Click **publish**. Confirm: "field of work" should now list both "obstetrics and gynaecology" and "restorative reproductive medicine".

Notes: Q139807849 is the verified concept item; on Wikidata it is modelled as a subclass of reproductive medicine (mainstream framing, good). A reference is optional for this statement; if Comet offers to add one, it can skip it (field-of-work statements are commonly unreferenced) or use her practice page https://www.upmc.com/services/womens-health/locations/central-pa/camp-hill/225-grandview-ave-suite-302 as a reference URL.

---

## CHUNK 3 (advanced, ~10-15 minutes): represent her "Tuboplasty" textbook chapter

This is the one Brian specifically asked for. It is two stages because the chapter needs its own Wikidata item first, then we link it from Naomi's item. Do Stage 3A fully, write down the new Q number, then do Stage 3B.

Chapter facts (all CrossRef-verified, DOI 10.1201/9781003312109-33): Nolan W, Whittaker N. "Tuboplasty." In: Textbook of Minimally Invasive Gynecologic Surgery. 1st ed. CRC Press; 2026 Apr 16. p. 280-286.

### Stage 3A: create the chapter item

Paste this to Comet:

> Open https://www.wikidata.org/wiki/Special:NewItem (logged in as me). Leave Language as **en**. In **Label** type exactly: **Tuboplasty**. In **Description** type exactly: **book chapter by William Nolan and Naomi Whittaker**. Leave Aliases empty. Click **Create**. The new page opens with a Q number at the top (like Q1234567) - tell me that Q number, I need it for the next stage.
>
> Then on this new item, add these statements one at a time, clicking **add statement** and **publish** for each:
> 1. Property **instance of** (P31), value: type **scholarly chapter** and pick the one with description "chapter written by specific authors in a scholarly book" (**Q21481766**).
> 2. Property **DOI** (P356), value exactly: **10.1201/9781003312109-33**
> 3. Property **title** (P1476): set the small language dropdown to **en** and type exactly: **Tuboplasty**
> 4. Property **page(s)** (P304), value exactly: **280-286**
> 5. Property **publication date** (P577), value: **16 April 2026**
> 6. Property **author name string** (P2093), value exactly: **William Nolan**. Before publishing, click **add qualifier**, choose **series ordinal** (P1545), type **1**. Then publish.
> 7. Property **author** (P50), value: paste **Q139936526** and select "Naomi Whittaker - American obstetrician-gynecologist" (must be that exact one). Before publishing, click **add qualifier**, choose **series ordinal** (P1545), type **2**. Then publish.
>
> Then confirm the item shows: instance of = scholarly chapter, a DOI, a title, page(s) 280-286, publication date 2026, and two authors (William Nolan ordinal 1, Naomi Whittaker ordinal 2). Tell me the Q number again.

Optional (only if Comet is comfortable): add a reference URL **P854 = https://www.taylorfrancis.com/chapters/edit/10.1201/9781003312109-33/tuboplasty-william-nolan-naomi-whittaker** to the DOI or title statement.

Leave "published in" (P1433) OFF. The parent book has no Wikidata item yet, so do not add it.

### Stage 3B: link the chapter from Naomi's item

Paste this to Comet (replace QXXXXXXX with the number from Stage 3A):

> Open https://www.wikidata.org/wiki/Q139936526 (logged in as me). In the **Statements** area click **add statement**. Property box: type **notable work** and pick **P800**. Value box: paste **QXXXXXXX** (the Tuboplasty chapter item I just created); the dropdown should show "Tuboplasty - book chapter by William Nolan and Naomi Whittaker". Select it and click **publish**. Confirm: a "notable work" statement now appears on her item pointing to the Tuboplasty chapter.

---

## Deliberately NOT included (and why) - do not let Comet attempt these

These came up in the audit and were intentionally held back. They are either unsourced, blocked on a missing item, or high-risk for an agentic browser to fumble:

- **Residency (University of Illinois College of Medicine at Peoria)** and **Pope Paul VI Institute fellowship** - both are true, but neither institution has a correct Wikidata item (the only "Illinois College of Medicine" item is the wrong Chicago campus; the Paul VI Institute has no item at all). Adding "educated at" requires creating those institution items first. Defer to a later, separate task; do not attach her education to a department item or the wrong campus.
- **Holy Spirit Hospital (prior employer)** - the obvious reference (the NPI registry) does NOT actually state employer or dates, and the proposed end-year (2021) collides with her UPMC start-year (2021). Needs a real employment-era source before adding. Held back.
- **AAFCP Honorary Award (2024)** - "award received" needs an award ITEM to point at, and neither the award nor the AAFCP organisation exists on Wikidata yet. Both would have to be created first.
- **Minimally invasive gynecologic surgery as field of work** - real (ABOG Focused Practice Designation, verified) but there is no Wikidata concept item for MIGS to point at; every search hit is a journal article.
- **Date of birth** - no published reliable source. Wikidata norms discourage unsourced birth dates for living people. Naomi may add her own year of birth at her discretion as the subject, but it is better left off than added unsourced.
- **Reference polish on existing occupation statements** - high risk that an agentic browser accidentally creates a duplicate occupation statement instead of adding a reference to the existing one. Low value, skip.

---

## After all chunks: quick sanity check

Reload https://www.wikidata.org/wiki/Q139936526 and confirm the three new things are present: OpenAlex ID (A5035074827), field of work includes restorative reproductive medicine, and a "notable work" pointing to the Tuboplasty chapter. If anything looks doubled-up or wrong, statements can be removed via the item's edit history; nothing here is destructive.
