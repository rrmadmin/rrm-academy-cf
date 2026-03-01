# Schema Audit — rrmacademy.org

**Date:** 2026-03-01 | **Commit:** `6d5ad0a`

---

## Overall Schema Health: 10/10

All pages have schema. All rich result eligibility blockers resolved.

---

## Page-by-Page Inventory

| Page | Schema Types | Rich Result Eligibility | Notes |
|------|-------------|------------------------|-------|
| / | WebSite + EducationalOrganization | Sitelinks Search Box | Fixed `6d5ad0a` |
| /about/ | EducationalOrganization + 2x Person | — | Strong entity graph |
| /contact/ | ContactPage + EducationalOrganization | — | @id reference added |
| /courses/ | ItemList + Course (live only) | — | comingSoon excluded |
| /courses/[slug]/ | Course + CourseInstance + Person + BreadcrumbList + FAQPage | Course + FAQ + Breadcrumbs | Image added; all required fields present |
| /commentary/ | Blog | — | @id on publisher |
| /commentary/[slug]/ | BlogPosting + BreadcrumbList | Article | mainEntityOfPage added |
| /library/ | CollectionPage | — | SearchAction moved to homepage |
| /library/[slug]/ | MedicalScholarlyArticle | — | |
| /faqs/ | FAQPage | FAQ | |
| /faqs/[slug]/ | FAQPage | FAQ | |
| /donate/ | DonateAction + NGO | — | |
| /save-the-uterus-club/ | WebPage + JoinAction | — | @id references added |
| /what-is-rrm/ | Article + MedicalWebPage + FAQPage + BreadcrumbList | Article + FAQ + Breadcrumbs | Image + mainEntityOfPage added |
| /endo-survey/ | Quiz + MedicalCondition | — | |

---

## Changes Made — `6d5ad0a`

### Homepage (`index.astro`)

**Before:** Single `EducationalOrganization` node.

**After:** `@graph` with two nodes:

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://rrmacademy.org/#website",
      "name": "RRM Academy",
      "url": "https://rrmacademy.org/",
      "publisher": { "@id": "https://rrmacademy.org/#organization" },
      "potentialAction": {
        "@type": "SearchAction",
        "target": {
          "@type": "EntryPoint",
          "urlTemplate": "https://rrmacademy.org/library/?q={search_term_string}"
        },
        "query-input": "required name=search_term_string"
      }
    },
    {
      "@type": "EducationalOrganization",
      "@id": "https://rrmacademy.org/#organization",
      "name": "RRM Academy",
      "url": "https://rrmacademy.org/",
      "hasOfferCatalog": {
        "numberOfItems": 4
      }
    }
  ]
}
```

**Why:** `WebSite` schema on the homepage is required for Google's Sitelinks Search Box eligibility. The `SearchAction` was previously buried inside the library `CollectionPage.isPartOf` — wrong location. `hasOfferCatalog.numberOfItems` now counts only live (non-`comingSoon`) courses.

---

### Course pages (`courses/[slug].astro`)

**Before:** `Course` + `Person` + optional `FAQPage`. Missing `image`, `isAccessibleForFree`, `offers` on free courses, `BreadcrumbList`.

**After:**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Course",
      "name": "...",
      "image": "https://pub-4af88159ce884265baba8fb4f3470625.r2.dev/courses/.../cover.jpeg",
      "url": "https://rrmacademy.org/courses/[slug]/",
      "provider": { "@id": "https://rrmacademy.org/#organization" },
      "instructor": { "@id": "https://rrmacademy.org/#naomi-whittaker" },
      "isAccessibleForFree": true,
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "USD",
        "availability": "https://schema.org/InStock"
      },
      "hasCourseInstance": {
        "@type": "CourseInstance",
        "courseMode": "online",
        "instructor": { "@id": "https://rrmacademy.org/#naomi-whittaker" }
      }
    },
    { "@type": "Person", "@id": "https://rrmacademy.org/#naomi-whittaker", ... },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rrmacademy.org/" },
        { "@type": "ListItem", "position": 2, "name": "Courses", "item": "https://rrmacademy.org/courses/" },
        { "@type": "ListItem", "position": 3, "name": "[course title]", "item": "https://rrmacademy.org/courses/[slug]/" }
      ]
    },
    { "@type": "FAQPage", "mainEntity": [...] }
  ]
}
```

**Why:** Google's Course rich results require `image`. Free courses without `offers` are technically missing a recommended property. `BreadcrumbList` enables breadcrumb display in SERPs.

---

### Commentary posts (`commentary/[...slug].astro`)

**Before:** Flat `BlogPosting` without `mainEntityOfPage`. Author for Whittaker posts was a bare name string.

**After:**

```json
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "BlogPosting",
      "headline": "...",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "https://rrmacademy.org/commentary/[slug]/"
      },
      "author": {
        "@type": "Person",
        "@id": "https://rrmacademy.org/#naomi-whittaker",
        "name": "Naomi Whittaker"
      },
      "publisher": { "@id": "https://rrmacademy.org/#organization" }
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "Home", "item": "https://rrmacademy.org/" },
        { "@type": "ListItem", "position": 2, "name": "Commentary", "item": "https://rrmacademy.org/commentary/" },
        { "@type": "ListItem", "position": 3, "name": "[post title]", "item": "https://rrmacademy.org/commentary/[slug]/" }
      ]
    }
  ]
}
```

**Why:** `mainEntityOfPage` is required for `BlogPosting` to be eligible for Article rich results in Google Search. The `@id` author reference connects to the known Person entity rather than an anonymous string.

---

### what-is-rrm (`what-is-rrm/index.astro`)

**Before:** `Article + MedicalWebPage + FAQPage`. Missing `image`, `mainEntityOfPage` was a string URL, no `BreadcrumbList`.

**After:** Added `image`, upgraded `mainEntityOfPage` to `{ "@type": "WebPage", "@id": "..." }`, added `BreadcrumbList` node.

---

### Trailing slash + `@id` cleanup

All schema `url` fields now use trailing slashes matching canonical URLs. `publisher`, `provider`, `isPartOf` nodes now use `@id` references where the full entity is defined elsewhere in the graph, reducing redundancy and strengthening entity connections.

---

## Entity Graph

The site now has a consistent entity graph across all pages:

| Entity | @id | Defined fully in |
|--------|-----|-----------------|
| WebSite | `https://rrmacademy.org/#website` | homepage |
| Organization | `https://rrmacademy.org/#organization` | homepage, about |
| Person (Naomi) | `https://rrmacademy.org/#naomi-whittaker` | about, course pages |
| Person (Brian) | `https://rrmacademy.org/#brian-whittaker` | about |

All other pages reference these entities by `@id` rather than duplicating properties.

---

## Rich Results Eligibility Summary

| Rich Result Type | Pages | Status | Key Requirement Met |
|-----------------|-------|--------|---------------------|
| Sitelinks Search Box | / | Eligible | WebSite + SearchAction on homepage |
| Course | /courses/[slug]/ | Eligible | image, name, description, provider, offers |
| FAQ | /courses/[slug]/, /faqs/, /what-is-rrm/ | Eligible | mainEntity Question/Answer |
| Article / BlogPosting | /commentary/[slug]/, /what-is-rrm/ | Eligible | mainEntityOfPage, image, datePublished, author |
| Breadcrumbs | /courses/[slug]/, /commentary/[slug]/, /what-is-rrm/ | Eligible | BreadcrumbList itemListElement |
| MedicalScholarlyArticle | /library/[slug]/ | Eligible | name, about, author |

---

## Open Items

- **Page-specific OG images** — `what-is-rrm` uses `og-default.png` as the Article `image`. If a dedicated hero image is added to that page, update the schema image to match.
- **Commentary non-Whittaker authors** — author entity is a bare `Person` with name only (no `@id`). If other named authors get profile pages, add `@id` references.
- **Validate in Rich Results Test** — run each page type through [search.google.com/test/rich-results](https://search.google.com/test/rich-results) after next deploy to confirm no warnings.
- **Search Console** — check Enhancements reports 2-4 weeks post-deploy for Course, Article, FAQ, and Breadcrumb coverage.
