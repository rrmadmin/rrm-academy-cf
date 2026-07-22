<!-- Extracted from CLAUDE.md 2026-07-20 (context-size offload). This file is the live inventory: keep it updated exactly as the old in-CLAUDE.md section was. -->

## Components

41 files in `src/components/` (last synced 2026-07-02 — when adding a component, add it here):

**Chrome & shell:** `Header` (site header/nav), `Footer`, `AppShellChrome` (app-shell sidebar wrapper), `MaybeShell` (conditional shell-on/off wrapper), `BackToTop`, `MobileSearchModal`

**Cards:** `ArticleCard` (library), `BlogCard` (commentary), `CourseCard`, `ProviderCard`, `ProviderAvatar`, `TeamCard`

**Article & guide furniture:** `ArticleHero`, `AuthorByline` (identity-SSOT byline), `Citation`, `CiteThisPage`, `GlossaryTerm` (shared term-body renderer, pillar + per-term pages), `LastUpdated` (from `page-dates.json`), `PdfDownload`, `SectionShare`, `SectionTocChips` (chip TOC for shell-enabled guides), `StatCards`, `SynopsisInfographic`, `TopicTag`

**Course renditions:** `LessonTabs`, `RenditionAudio`, `RenditionFlashcards`, `RenditionQuiz`, `RenditionReading`, `AudioPlayer` (commentary audio; separate consumer from RenditionAudio, not redundant)

**Fundraising & social:** `CampaignCallout`, `FoundingSupporters`, `LibraryFundingCallout`, `NewsletterSignup`, `ShareKit`, `SocialRow`, `SuperHeroLogos` (donor/partner logo strip), `SupporterTicker`, `SupporterWall`

**Search & tracking:** `SearchBar` (Pagefind + semantic RRF fusion), `FingerprintTracking` (visitor-ID script injector)

**Layouts** (`src/layouts/`): `BaseLayout` (every page; head/SEO/JSON-LD — see Page Templates section), `GuideLayout` (long-form pillar/condition/method guides)
