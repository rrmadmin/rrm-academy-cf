# Grokipedia Submission - Source Fills (2026-05-02)

Companion to `2026-05-02-grokipedia-naomi-submission.md`. Hardens 4 source gaps so the AI reviewer has stronger primary sources.

## Gap 1 - AAFCP primary citation

- URL: https://aafcp.net/events/past-annual-meetings/58-past-annual-meetings-list/449-2024-2 (stable AAFCP page hosting the 2025 Annual Meeting Program Book PDF; PDF accessed via the doclink it serves).
- Description: AAFCP-published 2025 (44th) Annual Meeting Program Book PDF (62 pages, ~50 MB, primary AAFCP publication). Page 30 of the PDF lists "2024 - Naomi Whittaker, MD, CFCMC" under "Honorary Awards: PAST AWARD WINNERS." This is the AAFCP's own internal record of the 2024 honoree, distinct from the awards index page.
- Confidence: VERIFIED. Downloaded the PDF (HTTP 200, 50,347,448 bytes, valid PDF v1.4), extracted text, confirmed the line at line 1551 of the extracted text. No other primary AAFCP press release, newsletter, or third-party news pickup was discoverable. Perplexity search returned zero additional primary sources beyond the awards index and program book.

## Gap 2 - AAGL S-MAP DOI

- DOI: 10.1016/j.jmig.2024.09.699
- Journal: Journal of Minimally Invasive Gynecology, vol. 31 no. 11 (Nov 2024), p. S66
- Title: "11099 Case Series: Diagnosis and Treatment of Four Rare Cancers by a Single Surgeon Due to Systematic Mapping and Near Contact Techniques"
- Verified abstract URL: https://doi.org/10.1016/j.jmig.2024.09.699 (302 -> https://linkinghub.elsevier.com/retrieve/pii/S1553465024011191)
- Single author per CrossRef: N Whittaker
- Brian was right: the S-MAP work IS the 2024 JMIG abstract already in the curated CSV. The phrase "Systematic Mapping" in the title IS S-MAP (Systematic Mapping of the Abdomen and Pelvis); "S-MAP" is her shorthand for the method, and the official journal title spells it out. There is no SECOND 2024 JMIG abstract titled "S-MAP" hiding in ORCID. ORCID returns 17 works total; only one 2024 JMIG entry exists.
- Confidence: VERIFIED via ORCID public API + CrossRef.

## Gap 3 - Post-2018 first-author paper

- Status: NO post-2018 first-author peer-reviewed JOURNAL paper exists. The only post-2018 traditional peer-edited publication where she is a named author is a co-authored textbook chapter:
  - DOI: 10.1201/9781003312109-33
  - Title: "Tuboplasty"
  - Volume: Textbook of Minimally Invasive Gynecologic Surgery (CRC Press / Taylor and Francis, Boca Raton)
  - ISBN: 9781003312109
  - Pages: 280-286
  - Year: 2026 (April 16, 2026 publication)
  - Authors: William Nolan (first), Naomi Whittaker (second)
  - URL: https://doi.org/10.1201/9781003312109-33 (302 -> https://www.taylorfrancis.com/books/9781003312109/chapters/10.1201/9781003312109-33)
  - This is a textbook chapter in a major MIGS reference text; she is a co-author, not first author, but it is meaningfully stronger evidence of professional standing than a conference-abstract roll.
- Search paths tried (all returned no first-author hit for our Naomi):
  - PubMed `("Whittaker N"[Author] OR "Whittaker NM"[Author] OR "Sasin N"[Author])` 2019 to 2026 returned exactly one record (PMID 31249085, Br J Gen Pract 2019, "Lessons learned tackling high opioid prescribing", Hodson et al, last author "Whittaker N") - this is a UK GP, not our Naomi (no MD at Lewisberry PA).
  - PubMed by ORCID `0000-0003-3706-3112[Author Identifier]` returned 0 results (her ORCID record is largely conference abstracts that PubMed does not index).
  - CrossRef `query.author=Naomi+Whittaker&from-pub-date=2019` returned only the Tuboplasty chapter where Naomi (our Naomi) is named.
  - CrossRef `query.bibliographic=Whittaker+Naomi+restorative+reproductive` returned only Andrea Whittaker (Australian medical anthropologist - different person).
  - ORCID public API (17 works) post-2018 entries: 2018 magazine commentary (Natural Womanhood / MercatorNet, not peer-reviewed), 2023 IRRMA conference paper, 2024 JMIG abstract (S-MAP, single author N Whittaker), 2025 FACTS conference paper. No first-author peer-reviewed journal article.
- Confidence: VERIFIED that no first-author peer-reviewed paper exists; the 2026 textbook chapter is the next-best post-2018 peer-edited publication.

## Gap 4 - ABOG verification URL

- Public form URL (form-only, no deep link to results): https://www.abog.org/verify-certification (HTTP 200; canonical user-facing form).
- DEEP LINK via API: https://api.abog.org/diplomate/9032678/verify (HTTP 200, returns clean JSON without auth).
- Verification path returned by the API:
  ```
  [{"userid":9032678,"name":"Naomi M. Whittaker, MD","startDate":"2020-02-24T00:00:00","certStatus":"Valid through 12/31/2026","mocStatus":"Yes","city":"Lewisberry","state":"PA"}]
  ```
- The legacy `https://search.abog.org/` host does not resolve in DNS. The current ABOG verification surface is `www.abog.org/verify-certification` for humans and `api.abog.org/diplomate/{userid}/verify` for machines.
- IMPORTANT FACT FLAG: The ABOG API returns startDate `2020-02-24` (February 24, 2020), not "March 2020" as currently stated in the bundle's Key Facts and Body. The "since March 2020" claim should be tightened to "since February 24, 2020" or relaxed to "since 2020".
- Confidence: VERIFIED.

## Patches to apply to the Grokipedia bundle

### Source list (numbered)

Replace Source [1] with a richer paired citation, and add three new sources [28], [29], [30] for the additions above:

- Source [1] - REPLACE current single-URL entry. Combine the awards index page AND the 2025 Annual Meeting Program Book PDF as a paired primary citation:
  ```
  1. American Academy of FertilityCare Professionals - Awards page (lists "2024 - Naomi Whittaker, MD, CFCMC" alongside the full 1985-2024 honoree roll). Supports: AAFCP Honorary Award 2024 and tier signal via co-recipients. https://aafcp.net/about-us/awards
     Also: AAFCP 2025 (44th) Annual Meeting Program Book (PDF, AAFCP-published primary record of the 2024 Honorary Award). Hosted page: https://aafcp.net/events/past-annual-meetings/58-past-annual-meetings-list/449-2024-2
  ```
- Source [28] - ADD. Strengthens Source [21] (the AAGL Congress page is event-only, not the abstract; the DOI is the citable artifact):
  ```
  28. Journal of Minimally Invasive Gynecology, vol. 31 no. 11 (November 2024), p. S66, abstract 11099, "Case Series: Diagnosis and Treatment of Four Rare Cancers by a Single Surgeon Due to Systematic Mapping and Near Contact Techniques" (N. Whittaker). DOI 10.1016/j.jmig.2024.09.699. Supports: S-MAP method publication record, AAGL 53rd Global Congress on MIGS abstract. https://doi.org/10.1016/j.jmig.2024.09.699
  ```
- Source [29] - ADD. Strongest post-2018 peer-edited publication (no first-author peer-reviewed journal paper exists):
  ```
  29. Nolan W, Whittaker N. "Tuboplasty," chapter 33 in Textbook of Minimally Invasive Gynecologic Surgery, CRC Press / Taylor and Francis, Boca Raton (April 2026), pp. 280-286. DOI 10.1201/9781003312109-33. ISBN 9781003312109. Supports: post-fellowship peer-edited textbook chapter on tubal microsurgery; co-authorship with William Nolan. https://doi.org/10.1201/9781003312109-33
  ```
- Source [30] - ADD. Stronger ABOG verification surface than the bare home URL:
  ```
  30. American Board of Obstetrics and Gynecology - Verify Certification (public verification form). Supports: board-certification status verification. https://www.abog.org/verify-certification
      Direct verification record (ABOG API, JSON, no auth): https://api.abog.org/diplomate/9032678/verify
  ```

### Body text edits

- Section "Surgical specialties" - line citing the S-MAP presentation. CHANGE the trailing citation from `[21]` to `[21][28]` so both the venue (AAGL Congress) and the citable artifact (JMIG DOI) are captured:
  ```
  In 2024 she presented a method she terms S-MAP (Systematic Mapping of the Abdomen and Pelvis) at the American Association of Gynecologic Laparoscopists 53rd Global Congress on MIGS, formalizing a diagnostic-laparoscopy mapping approach attributed to Thomas W. Hilgers [21][28].
  ```
- Section "Publications and presentations" - ADD one sentence at the end of the existing paragraph to lift the textbook chapter into the body:
  ```
  In 2026 she co-authored the chapter "Tuboplasty" (with William Nolan, first author) in the CRC Press Textbook of Minimally Invasive Gynecologic Surgery, covering microsurgical tubal repair techniques [29].
  ```
- Section "Board certification and licensure" - tighten the ABOG date and update the citation. CURRENT: "Whittaker has been certified by the American Board of Obstetrics and Gynecology since March 2020 [14]." CHANGE to:
  ```
  Whittaker has been certified by the American Board of Obstetrics and Gynecology since February 2020 [14][30].
  ```

### Key facts edits

- CHANGE `Board-certified by the American Board of Obstetrics and Gynecology since March 2020 [14]` to:
  ```
  Board-certified by the American Board of Obstetrics and Gynecology since February 24, 2020 (verified via ABOG public API) [14][30]
  ```

### Reference cleanup notes

- No existing references should be removed. Source [21] (AAGL Congress event page) stays - it documents the venue; Source [28] adds the citable abstract DOI.
- The Doximity, Healthgrades, and US News profiles (Sources [3][4][19]) are aggregator profiles; they remain useful for biographical breadth, but ABOG (Source [30]) is now the primary verification surface for board certification.
