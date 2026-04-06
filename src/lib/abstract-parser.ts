/**
 * Parse structured abstracts (BACKGROUND:, METHODS:, RESULTS:, etc.)
 * into labeled sections for display on article detail pages.
 *
 * Handles formatting from PubMed, CrossRef, Europe PMC, OpenAlex,
 * Human Reproduction, Cochrane Reviews, and other journal styles.
 *
 * Ported from Wix Velo item page (v3.1.0), expanded v4.0.0.
 */

// ----------------------------------------------------------------
// Label pattern -- order matters: longer alternatives before shorter
// ones to prevent partial matching (e.g. MAIN RESULTS before RESULTS).
// Case-insensitive via /gi flag.
// ----------------------------------------------------------------
const SECTION_PATTERN = new RegExp(
  '\\b(' +
  [
    // Compound labels (must come first -- contain words that are standalone labels below)
    'DISCUSSION\\s+AND\\s+CONCLUSION[S]?',
    'MATERIAL[S]?\\s+AND\\s+METHOD[S]?',
    'DATA\\s+COLLECTION(?:\\s+AND\\s+ANALYSIS)?',
    'MAIN\\s+OUTCOME\\s+MEASURE[S]?',
    'MAIN\\s+RESULT[S]?',
    'MAIN\\s+ARGUMENT[S]?(?:\\s*/\\s*EVIDENCE)?',
    'STUDY\\s+QUESTION',
    'STUDY\\s+DESIGN',
    'SUMMARY\\s+ANSWER',
    'WHAT\\s+IS\\s+KNOWN(?:\\s+ALREADY)?',
    'WHAT\\s+(?:DOES\\s+THIS\\s+STUDY\\s+ADD|THIS\\s+STUDY\\s+ADDS)',
    'WIDER\\s+IMPLICATION[S]?',
    'CLINICAL\\s+SIGNIFICANCE',
    'CLINICAL\\s+IMPLICATION[S]?',
    'SELECTION\\s+CRITERIA',
    'SEARCH\\s+(?:STRATEGY|METHOD[S]?)',
    'TRIAL\\s+REGISTRATION',
    'SYSTEMATIC\\s+REVIEW\\s+REGISTRATION',
    'LEVEL\\s+OF\\s+EVIDENCE',
    'EVIDENCE(?:\\s+REVIEW|\\s+SYNTHESIS)',
    'RECENT\\s+FINDING[S]?',
    'OPINION\\s+STATEMENT',
    'CASE\\s+REPORT[S]?',
    'KEY\\s+(?:WORDS?|FINDING[S]?|MESSAGE)',
    // Single-word / short labels
    'BACKGROUND',
    'INTRODUCTION',
    'OBJECTIVE[S]?',
    'PURPOSE',
    'AIM[S]?',
    'CONTEXT',
    'IMPORTANCE',
    'RATIONALE',
    'METHOD[S]?',
    'DESIGN',
    'SETTING',
    'POPULATION',
    'SAMPLE',
    'PATIENT[S]?',
    'PARTICIPANT[S]?',
    'SUBJECT[S]?',
    'EXPOSURE',
    'INTERVENTION[S]?',
    'MEASURE[S]?',
    'RESULT[S]?',
    'FINDING[S]?',
    'OUTCOME[S]?',
    'CONCLUSION[S]?',
    'DISCUSSION',
    'INTERPRETATION',
    'SUMMARY',
    'SIGNIFICANCE',
    'IMPLICATION[S]?',
    'LIMITATION[S]?',
    'FUNDING',
  ].join('|') +
  ')\\s*:',
  'gi'
);

// Small words that stay lowercase mid-heading in title case
const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if',
  'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet',
]);

// ----------------------------------------------------------------
// Pre-processing: repair broken compound labels before parsing.
// PubMed XML sometimes emits separate <AbstractText> elements for
// compound labels (e.g. Label="DISCUSSION AND" + Label="CONCLUSIONS"),
// which the eFetch parser joins with \n\n. This creates orphaned text
// like "DISCUSSION AND" sitting at the end of the prior section.
// ----------------------------------------------------------------
const COMPOUND_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /DISCUSSION\s+AND\s*\n+\s*CONCLUSION[S]?\s*:/gi, replacement: 'DISCUSSION AND CONCLUSIONS:' },
  { pattern: /MATERIAL[S]?\s+AND\s*\n+\s*METHOD[S]?\s*:/gi, replacement: 'MATERIALS AND METHODS:' },
  { pattern: /DATA\s+COLLECTION\s*\n+\s*AND\s+ANALYSIS\s*:/gi, replacement: 'DATA COLLECTION AND ANALYSIS:' },
  { pattern: /MAIN\s+OUTCOME\s*\n+\s*MEASURE[S]?\s*:/gi, replacement: 'MAIN OUTCOME MEASURES:' },
  { pattern: /WHAT\s+IS\s+KNOWN\s*\n+\s*ALREADY\s*:/gi, replacement: 'WHAT IS KNOWN ALREADY:' },
  { pattern: /WHAT\s+(?:DOES\s+)?THIS\s+STUDY\s*\n+\s*ADD[S]?\s*:/gi, replacement: 'WHAT THIS STUDY ADDS:' },
  { pattern: /MAIN\s*\n+\s*RESULT[S]?\s*:/gi, replacement: 'MAIN RESULTS:' },
  { pattern: /MAIN\s*\n+\s*ARGUMENT[S]?\s*:/gi, replacement: 'MAIN ARGUMENTS:' },
  { pattern: /WIDER\s*\n+\s*IMPLICATION[S]?\s*:/gi, replacement: 'WIDER IMPLICATIONS:' },
  { pattern: /CLINICAL\s*\n+\s*SIGNIFICANCE\s*:/gi, replacement: 'CLINICAL SIGNIFICANCE:' },
  { pattern: /CLINICAL\s*\n+\s*IMPLICATION[S]?\s*:/gi, replacement: 'CLINICAL IMPLICATIONS:' },
  { pattern: /CASE\s*\n+\s*REPORT[S]?\s*:/gi, replacement: 'CASE REPORTS:' },
  { pattern: /RECENT\s*\n+\s*FINDING[S]?\s*:/gi, replacement: 'RECENT FINDINGS:' },
  { pattern: /TRIAL\s*\n+\s*REGISTRATION\s*:/gi, replacement: 'TRIAL REGISTRATION:' },
  { pattern: /STUDY\s*\n+\s*QUESTION\s*:/gi, replacement: 'STUDY QUESTION:' },
  { pattern: /SUMMARY\s*\n+\s*ANSWER\s*:/gi, replacement: 'SUMMARY ANSWER:' },
  { pattern: /SEARCH\s*\n+\s*STRATEGY\s*:/gi, replacement: 'SEARCH STRATEGY:' },
  { pattern: /SELECTION\s*\n+\s*CRITERIA\s*:/gi, replacement: 'SELECTION CRITERIA:' },
  { pattern: /LEVEL\s+OF\s*\n+\s*EVIDENCE\s*:/gi, replacement: 'LEVEL OF EVIDENCE:' },
  { pattern: /OPINION\s*\n+\s*STATEMENT\s*:/gi, replacement: 'OPINION STATEMENT:' },
  { pattern: /EVIDENCE\s*\n+\s*REVIEW\s*:/gi, replacement: 'EVIDENCE REVIEW:' },
  { pattern: /EVIDENCE\s*\n+\s*SYNTHESIS\s*:/gi, replacement: 'EVIDENCE SYNTHESIS:' },
];

export interface AbstractSection {
  heading: string | null;
  text: string;
}

/**
 * Convert a raw section label to Title Case.
 * Preserves slash-separated parts (e.g. "Arguments/Evidence").
 */
function toTitleCase(raw: string): string {
  // Normalize internal whitespace
  const label = raw.replace(/\s+/g, ' ').trim();

  return label
    .split(/(\s*\/\s*)/) // split on "/" keeping the delimiter
    .map(segment => {
      if (segment.trim() === '/') return '/';
      return segment
        .split(/\s+/)
        .map((word, i) => {
          const lower = word.toLowerCase();
          if (i > 0 && SMALL_WORDS.has(lower)) return lower;
          return lower.charAt(0).toUpperCase() + lower.slice(1);
        })
        .join(' ');
    })
    .join('');
}

/**
 * Apply compound label repairs to raw abstract text.
 */
function repairCompoundLabels(text: string): string {
  let s = text;
  for (const { pattern, replacement } of COMPOUND_REPAIRS) {
    s = s.replace(pattern, replacement);
  }
  return s;
}

/**
 * Parse a structured abstract into sections.
 * Returns array of { heading, text } objects.
 */
export function parseStructuredAbstract(text: string): AbstractSection[] {
  if (!text || text.trim() === '' || text.trim() === '- -') {
    return [];
  }

  // Pre-process: repair any broken compound labels
  const trimmed = repairCompoundLabels(text.trim());

  const matches = trimmed.match(SECTION_PATTERN);

  if (!matches) {
    // Unstructured abstract -- return as single block
    return [{ heading: null, text: trimmed }];
  }

  // Split on section headers
  const sections: AbstractSection[] = [];
  const parts = trimmed.split(SECTION_PATTERN);

  // First part before any header
  if (parts[0] && parts[0].trim()) {
    sections.push({ heading: null, text: parts[0].trim() });
  }

  // Remaining parts alternate: header, content, header, content...
  for (let i = 1; i < parts.length; i += 2) {
    const rawHeading = parts[i];
    const content = parts[i + 1] || '';

    const heading = toTitleCase(rawHeading);

    const cleanContent = content
      .replace(/^\s*:\s*/, '') // Remove leading colon (artifact of some sources)
      .trim();

    if (heading || cleanContent) {
      sections.push({ heading, text: cleanContent });
    }
  }

  return sections;
}
