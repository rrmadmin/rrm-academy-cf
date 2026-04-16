# Find a Provider -- Implementation Plan

> Comprehensive practitioner directory at `/find-a-provider/` on rrmacademy.org.
> Telehealth-first. ~1,900 practitioners across 6 methods. Automated refresh pipeline.

## 1. Data Sources

### Already collected

| Source | Records | Method | Type | Telehealth | Credentials | File |
|--------|---------|--------|------|-----------|-------------|------|
| CFCMC Medical Consultants | 108 | napro | medical | unknown | yes | D1 `practitioner` table |
| FertilityCare Centers | 195 | creighton | center | unknown | n/a | D1 `practitioner` table |
| CCL Amelia API | 134 | sympto-thermal | educator | unknown | 0% | `.firecrawl/ccl/ccl-parsed.json` |
| CCL Liga KML | 87 | sympto-thermal | educator | unknown | 0% | `.firecrawl/ccl/ccl-parsed.json` |
| BOMA teachers | 150 | billings | educator | partial | 16% | `.firecrawl/billings/billings-parsed.json` |
| BOMA remote | 24 | billings | educator | yes | 33% | `.firecrawl/billings/billings-parsed.json` |
| BOMA physicians | 24 | billings | medical | partial | 100% | `.firecrawl/billings/billings-parsed.json` |
| FEMM providers | 148 | femm | medical | 41% | 3% | `.firecrawl/femm/femm-parsed.json` |
| FEMM teachers | 623 | femm | educator | unknown | 3% | `.firecrawl/femm/femm-parsed.json` |
| **Unified (listed)** | **1,159** | | | **7%** | **7%** | `.firecrawl/unified-practitioners-listed.json` |

### To scrape

| Source | Est. records | Method(s) | Telehealth | Credentials | Crawl notes |
|--------|-------------|-----------|-----------|-------------|-------------|
| MyCatholicDoctor | ~401 | napro, creighton, femm, billings, sympto-thermal, marquette | ~100% | 100% | `Crawl-delay: 10` in robots.txt. ~70 min. Sitemap: `wp-sitemap-posts-doctors-1.xml` |

### Future sources (manual or outreach)

| Source | What | How to get |
|--------|------|-----------|
| IIRRM provider directory | International RRM physicians | iirrm.org (may need partnership) |
| Marquette method instructors | Marquette-trained educators | marquette.edu NFP directory (if public) |
| Individual NaPro practices | Solo practitioners not in CFCMC list | Manual additions, email outreach |
| FertilityCare center practitioners | Individual FCPs within centers | Centers list the org, not people. Outreach to centers for staff rosters |

## 2. D1 Schema

### Migration 011: `practitioner` table v2

New columns on existing table:

```sql
-- Core identity
ALTER TABLE practitioner ADD COLUMN slug TEXT;
ALTER TABLE practitioner ADD COLUMN bio TEXT;

-- Method and role
ALTER TABLE practitioner ADD COLUMN method TEXT;  -- napro, creighton, sympto-thermal, billings, femm, marquette
ALTER TABLE practitioner ADD COLUMN practitioner_type TEXT;  -- medical, educator, center
ALTER TABLE practitioner ADD COLUMN organization TEXT;  -- CFCMC, FCCA, CCL, BOMA, FEMM, MyCatholicDoctor

-- Telehealth (tri-state)
ALTER TABLE practitioner ADD COLUMN telehealth TEXT DEFAULT 'unknown';  -- yes, no, unknown
ALTER TABLE practitioner ADD COLUMN telehealth_states TEXT;  -- JSON array of state abbreviations

-- Languages
ALTER TABLE practitioner ADD COLUMN languages TEXT;  -- JSON array: ["English", "Spanish"]

-- Geolocation
ALTER TABLE practitioner ADD COLUMN latitude REAL;
ALTER TABLE practitioner ADD COLUMN longitude REAL;

-- Center/practice grouping
ALTER TABLE practitioner ADD COLUMN practice_id TEXT;  -- FK to another practitioner record with type='center'
ALTER TABLE practitioner ADD COLUMN practice_name TEXT;  -- denormalized for display

-- Refresh pipeline
ALTER TABLE practitioner ADD COLUMN source_url TEXT;
ALTER TABLE practitioner ADD COLUMN source_date TEXT;
ALTER TABLE practitioner ADD COLUMN last_verified TEXT;
ALTER TABLE practitioner ADD COLUMN listed INTEGER DEFAULT 1;  -- 0 = hidden
ALTER TABLE practitioner ADD COLUMN verified INTEGER DEFAULT 0;  -- 1 = manually confirmed

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_practitioner_slug ON practitioner(slug);
CREATE INDEX IF NOT EXISTS idx_practitioner_method ON practitioner(method);
CREATE INDEX IF NOT EXISTS idx_practitioner_type ON practitioner(practitioner_type);
CREATE INDEX IF NOT EXISTS idx_practitioner_listed ON practitioner(listed);
CREATE INDEX IF NOT EXISTS idx_practitioner_practice ON practitioner(practice_id);
CREATE INDEX IF NOT EXISTS idx_practitioner_telehealth ON practitioner(telehealth);
```

### Center/practice model

A "center" is a `practitioner` record with `practitioner_type = 'center'`. Individual practitioners at that center have `practice_id` pointing to the center's `id`.

Example:
```
id: abc-123, name: "Abiding FertilityCare Center", type: center, city: Cypress, state: TX
id: def-456, name: "Jane Smith", type: educator, practice_id: abc-123, practice_name: "Abiding FertilityCare Center"
```

On the site:
- Center pages show the center info + list all practitioners with that `practice_id`
- Practitioner pages show "Part of [Center Name]" with a link
- Search results show practitioners individually but badge the center affiliation

For Phase 1, the 195 FertilityCare centers stay as center records. Individual practitioners discovered later (via outreach) get linked via `practice_id`.

### Telehealth model

Three states: `yes`, `no`, `unknown`.

- MyCatholicDoctor: default `yes` (telehealth is their model)
- BOMA remote teachers: `yes`
- FEMM providers with telemed flag: `yes`
- Billings physicians with telehealth_states: `yes`
- Everyone else: `unknown` (NOT `no` -- absence of data is not evidence of absence)

The directory UI shows a telehealth filter with options:
- "Offers telehealth" (telehealth = yes)
- "All providers" (no filter)
- NOT "In-person only" -- we don't have reliable in-person-only data

## 3. Scraping Pipeline

### MyCatholicDoctor scrape

```
Input:  wp-sitemap-posts-doctors-1.xml (401 URLs)
Method: Fetch each profile with 10s delay (robots.txt Crawl-delay)
Output: .firecrawl/mycatholicdoctor/mcd-parsed.json
Time:   ~70 minutes
```

Fields to extract per profile:
- Name + credentials (in page title and h1)
- Role/title ("Family Nurse Practitioner", etc.)
- Licensed states (taxonomy: state categories)
- NFP methods (taxonomy: `sl-creighton`, `sl-femm`, etc.)
- Phone + extension
- Bio text (education, training, fellowships)
- Photo URL
- CFCMC flag (from slug or bio text)
- Telehealth: default `yes`

Method mapping from MyCatholicDoctor taxonomy:
- `sl-creighton` -> `creighton`
- `sl-femm` -> `femm`
- `sl-marquette` -> `marquette`
- `sl-billings` -> `billings`
- `sl-symptothermal` -> `sympto-thermal`
- Providers may have multiple methods (store as JSON array `methods`)

### Automated refresh pipeline (future)

Each source has a different refresh strategy:

| Source | Refresh method | Frequency |
|--------|---------------|-----------|
| CCL Amelia API | Re-fetch entities endpoint | Monthly |
| BOMA/nfpcharting | Re-scrape state pages | Monthly |
| FEMM | Re-scrape sitemaps + profiles | Monthly (when DNS works) |
| MyCatholicDoctor | Re-scrape sitemap + profiles (10s delay) | Monthly |
| FertilityCare.org | Re-scrape center pages | Quarterly |
| CFCMC | Manual (PDF-based) | Annually |

Implementation: A Node.js script (`scripts/refresh-practitioners.mjs`) that:
1. Fetches each source
2. Diffs against current D1 data
3. Updates changed records, marks removed records as `listed = 0`
4. Updates `last_verified` timestamp
5. Logs changes to Analytics Engine
6. Optional: Telegram notification on significant changes (>10 added/removed)

## 4. Data Enrichment

### Credentials gap

| Source | Current | Strategy |
|--------|---------|----------|
| CCL (0%) | Teaching couples don't have clinical credentials | Leave blank -- label as "Teaching Couple" in UI |
| FEMM teachers (3%) | Credentials in bio text, not parsed | Re-parse bios when FEMM DNS returns |
| FEMM providers (3%) | Same issue | Re-parse from cached HTML |
| BOMA teachers (16%) | Some have RN, CNM, etc. in name | Already extracted |
| MyCatholicDoctor (100%) | Full credentials in every profile | Will extract during scrape |
| CFCMC (100%) | MD, DO, NP, PA + certification codes | Already in D1 |

### Telehealth gap

| Source | Current | Strategy |
|--------|---------|----------|
| CCL (0%) | Many teach online classes | Check if Amelia events have "online" tag -> mark those couples as telehealth=yes |
| FEMM teachers (0%) | Unknown | Leave as unknown |
| BOMA teachers (0%) | 24 remote teachers identified | Already marked |
| MyCatholicDoctor (~100%) | Telehealth is their model | Default yes during scrape |
| CFCMC (0%) | Many offer telehealth | Email outreach: "Do you offer telehealth?" |
| FertilityCare centers (0%) | Some offer remote instruction | Email outreach or check websites |

### Email outreach plan

For CFCMC medical consultants (108 high-value practitioners with good contact data):

Subject: "Verify your listing on RRM Academy's provider directory"

Content:
- We're building a provider directory at rrmacademy.org/find-a-provider
- Your listing shows: [name, city, state, credentials]
- Please confirm or update:
  - Do you offer telehealth? (Yes/No)
  - What states are you licensed in?
  - Preferred contact method (phone/email/website)
  - Practice name (if applicable)
  - Brief bio (optional)
- Link to a simple form (could be a Tally or Airtable form)

This doubles as relationship building -- practitioners who verify get a "Verified" badge on their listing.

## 5. Site Architecture

### Routes

| Route | Page |
|-------|------|
| `/find-a-provider/` | Index with search, filter, grid |
| `/find-a-provider/[slug]/` | Individual profile OR state page |
| `/find-a-provider/[slug]/` | Center page (for type=center, shows all affiliated practitioners) |

State pages use state slugs (e.g., `pennsylvania`). Profile slugs always contain a name + location + hash suffix, so no conflicts.

### Data flow

```
D1 practitioner table
  -> scripts/fetch-practitioner-data.mjs (Wrangler D1 query)
  -> src/data/practitioners.json (~300KB)
  -> Astro getStaticPaths() generates all pages
  -> Sitemap integration (sitemap-providers.xml)
```

### Page types

**Index** (`/find-a-provider/`):
- Hero: "{count} practitioners across {methods} methods"
- Telehealth toggle (prominent, top of filters)
- Filter bar: method, state, type (medical/educator/center), telehealth
- Name search (client-side)
- Card grid (all 1,500+ practitioners, filtered client-side)
- State browse section (linked cards with counts)
- Method explainer section (links to pillar guides)

**Profile** (`/find-a-provider/[name-city-state-hash]/`):
- Breadcrumb: Home > Find a Provider > [Name]
- Name + credentials prominently displayed
- Telehealth badge (green "Offers Telehealth" or grey "Contact for availability")
- Method badge(s) with links to pillar guides
- Location (city, state, country)
- Contact section (phone, email, website)
- Center affiliation (if practice_id set)
- Licensed states (if available, especially for telehealth)
- Related practitioners in same area
- Schema: Person/Physician + LocalBusiness

**State page** (`/find-a-provider/pennsylvania/`):
- H1: "Find RRM & FABM Providers in [State]"
- Telehealth providers who serve this state (from telehealth_states) listed FIRST
- Local practitioners grouped by method
- FAQ schema per method present in state
- Neighboring states links

**Center page** (`/find-a-provider/[center-slug]/`):
- Center name, location, contact
- List of all affiliated practitioners
- Schema: MedicalBusiness

### Schema markup

| Page type | JSON-LD |
|-----------|---------|
| Profile (medical) | Person + Physician + MedicalBusiness |
| Profile (educator) | Person |
| Center | MedicalBusiness + employees[] |
| State | FAQPage + ItemList |
| Index | CollectionPage |

### Internal linking

| From | To |
|------|---|
| Practitioner profiles | Relevant pillar guide based on method |
| Practitioner profiles | Relevant courses based on method |
| Pillar guides | `/find-a-provider/?method=X` |
| FAQ "How do I find a provider?" | `/find-a-provider/` |
| Commentary posts mentioning methods | `/find-a-provider/?method=X` |
| State pages | Bordering state pages |
| Center pages | All affiliated practitioner profiles |

## 6. Phases

### Phase 1: Schema + Data Load (Day 1)

1. Write migration 011 (new columns)
2. Run migration on D1 remote
3. Backfill existing 303 records (set method, practitioner_type, organization, slug)
4. Write import scripts for CCL, Billings, FEMM from unified JSON
5. Import 1,159 listed practitioners
6. Verify D1 counts

### Phase 2: MyCatholicDoctor Scrape (Day 1-2)

7. Write MyCatholicDoctor scraper (respects 10s crawl-delay)
8. Run scraper (~70 min)
9. Normalize MyCatholicDoctor data (method mapping, credentials, licensed states)
10. Import into D1
11. Cross-source dedup (MyCatholicDoctor CFCMC doctors vs existing CFCMC records)

### Phase 3: Site Build (Day 2-3)

12. Add `/find-a-provider` to rrm-router ASTRO_ROUTES
13. Write `scripts/fetch-practitioner-data.mjs` (D1 -> JSON)
14. Write `src/lib/practitioners.ts` (data layer)
15. Build `PractitionerCard.astro` component
16. Build `/find-a-provider/index.astro` (filters + grid)
17. Build `/find-a-provider/[...slug].astro` (profiles + state pages + center pages)
18. Schema markup (Person, Physician, MedicalBusiness, FAQPage)
19. Sitemap integration
20. Internal linking from pillar guides
21. Add to header nav

### Phase 4: Enrichment (Week 2)

22. Re-parse FEMM cached HTML for credentials from bios
23. Check CCL Amelia events for "online" tag -> mark telehealth
24. Draft verification email for CFCMC consultants
25. Build Tally/Airtable verification form
26. Send verification emails (batch of 20, monitor responses)
27. Apply verified data to D1

### Phase 5: Automated Refresh (Week 3)

28. Write `scripts/refresh-practitioners.mjs`
29. Add monthly cron (n8n or GitHub Actions)
30. Telegram notifications for significant changes
31. Add "Last updated [date]" to directory pages
32. Build admin view for review queue (new/changed/removed practitioners)

### Phase 6: Polish (Week 4)

33. Proximity search (client-side Haversine with lat/lng)
34. Map visualization (if justified by traffic)
35. Practitioner claim flow ("Is this you? Verify your listing")
36. Mobile filter UX refinement
37. OG images for state pages (if warranted)

## 7. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Telehealth field | Tri-state (yes/no/unknown) | Absence of data != no telehealth |
| Center model | Same table, `practice_id` FK | Simple, no joins needed at build time |
| Data source | D1 -> JSON at build | Static gen, fast, same pattern as library |
| Filtering | Client-side | 1,900 records ~ 500KB HTML, viable |
| State vs profile routing | Single `[...slug].astro` | No ambiguity, clean |
| Slug format | `{name}-{city}-{state}-{8-char-id}` | Unique, SEO-friendly |
| Refresh | Monthly automated + manual verification | Keeps data current |
| Multi-method providers | `methods` JSON array + primary `method` | MyCatholicDoctor providers often practice multiple methods |

## 8. Router Update

Add to ASTRO_ROUTES in `~/iCode/projects/rrm-router/src/index.js`:
```js
'/find-a-provider',  // Practitioner directory
```

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| MyCatholicDoctor changes site structure | Sitemap-based scraping + monthly refresh catches changes |
| FEMM DNS stays down | We have 771 cached records; re-scrape when it returns |
| Duplicate practitioners across sources | Dedup on name + city + state; manual review for edge cases |
| Stale data (practitioners move, retire) | Monthly refresh + "Report an issue" link on profiles |
| Legal/privacy concerns | All data is from public directories; include "Request removal" link |
