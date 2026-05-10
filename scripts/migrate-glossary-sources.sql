-- Layered authoritative-source definitions per glossary term.
-- One row per (term, source). Renders below the RRMA-authored body_html
-- on each term's spoke page as an "Authoritative References" section.
--
-- Render order is governed by sort_order (ASC). Render flow:
--   10  RRMA (body_html on glossary_term -- not in this table)
--   20  PubMed MeSH (NLM, public domain)
--   30  ICD-10 / ICD-10-CM (WHO / CMS)
--   35  ICD-11 MMS (WHO)
--   40  SNOMED CT (IHTSDO)
--   50  NCI Thesaurus (NIH)
--   60  MedlinePlus (NLM, public domain, excerpt)
--   70  Wikipedia (CC-BY-SA, lead paragraph excerpt)
--   80  Cleveland Clinic / Mayo / journal (fair-use excerpt)
--   90  Hilgers, NaProTECHNOLOGY textbook (RRM canon)
--   95  Boyle, IIRRM case archive (RRM canon)
--   99  Internal RRM library cross-reference

CREATE TABLE IF NOT EXISTS glossary_definition_source (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    term_id TEXT NOT NULL REFERENCES glossary_term(id),
    source_key TEXT NOT NULL,
        -- 'mesh', 'icd10', 'icd11', 'snomed', 'nci', 'medlineplus',
        -- 'wikipedia', 'cleveland_clinic', 'mayo', 'journal',
        -- 'hilgers_textbook', 'boyle_archive', 'rrm_library', 'wikidata'
    source_label TEXT NOT NULL,
        -- Human-friendly label shown on page (e.g. "PubMed MeSH",
        -- "Hilgers, NaProTECHNOLOGY Ch. 32")
    source_url TEXT,
        -- Canonical link. NULL for internal sources without a public URL.
    code TEXT,
        -- e.g. 'D004716' (MeSH), 'N71' (ICD-10), 'C26739' (NCI), '78623009' (SNOMED)
    definition_text TEXT NOT NULL,
        -- Verbatim quote (is_verbatim=1) or paraphrased excerpt (is_verbatim=0)
    is_verbatim INTEGER NOT NULL DEFAULT 1 CHECK(is_verbatim IN (0, 1)),
        -- 1 = verbatim quote (public-domain or licensed sources)
        -- 0 = paraphrased / excerpt under fair use
    attribution TEXT,
        -- Attribution line displayed under the quote
        -- (e.g. "Source: National Library of Medicine. Public domain.")
    sort_order INTEGER NOT NULL DEFAULT 50,
    status TEXT NOT NULL DEFAULT 'published'
        CHECK(status IN ('draft', 'published', 'archived')),
    fetched_at TEXT,
        -- When source content was retrieved (ISO 8601). For provenance.
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    -- IMPORTANT: ingest scripts MUST use ON CONFLICT(term_id, source_key) DO UPDATE
    -- and explicitly OMIT human-curated columns (attribution, is_verbatim, sort_order,
    -- status, visibility) from the SET clause. Otherwise admin edits will be silently
    -- overwritten on the next sync. The previous schema used ON CONFLICT REPLACE
    -- which deletes the entire conflicting row -- removed 2026-05-10 after /arise
    -- finding #7 flagged the data-loss class.
    --
    -- Canonical upsert form for ingest scripts:
    --   INSERT INTO glossary_definition_source
    --     (term_id, source_key, source_label, source_url, code, definition_text, fetched_at)
    --   VALUES (?, ?, ?, ?, ?, ?, ?)
    --   ON CONFLICT(term_id, source_key) DO UPDATE SET
    --     source_label   = excluded.source_label,
    --     source_url     = excluded.source_url,
    --     code           = excluded.code,
    --     definition_text = excluded.definition_text,
    --     fetched_at     = excluded.fetched_at,
    --     updated_at     = datetime('now');
    --   -- Note: attribution, is_verbatim, sort_order, status NOT in SET -- admin-managed.
    UNIQUE(term_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_glossary_def_source_term
    ON glossary_definition_source(term_id);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_key
    ON glossary_definition_source(source_key);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_status
    ON glossary_definition_source(status);
CREATE INDEX IF NOT EXISTS idx_glossary_def_source_term_sort
    ON glossary_definition_source(term_id, sort_order);
