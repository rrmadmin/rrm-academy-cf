/**
 * Parse structured abstracts (BACKGROUND:, METHODS:, RESULTS:, etc.)
 * Ported from Wix Velo item page (v3.1.0).
 */

const SECTION_PATTERN = /\b(BACKGROUND|INTRODUCTION|OBJECTIVE[S]?|PURPOSE|AIM[S]?|CONTEXT|MATERIAL[S]?\s+AND\s+METHOD[S]?|METHOD[S]?|STUDY\s+DESIGN|DESIGN|SETTING|PATIENT[S]?|PARTICIPANT[S]?|SUBJECT[S]?|INTERVENTION[S]?|MAIN\s+OUTCOME\s+MEASURE[S]?|MEASURE[S]?|RESULT[S]?|FINDING[S]?|OUTCOME[S]?|CONCLUSION[S]?|DISCUSSION|SIGNIFICANCE|IMPLICATIONS?|LIMITATIONS?)\s*:/gi;

export interface AbstractSection {
  heading: string | null;
  text: string;
}

/**
 * Parse a structured abstract into sections.
 * Returns array of { heading, text } objects.
 */
export function parseStructuredAbstract(text: string): AbstractSection[] {
  if (!text || text.trim() === '' || text.trim() === '- -') {
    return [];
  }

  const trimmed = text.trim();
  const matches = trimmed.match(SECTION_PATTERN);

  if (!matches || matches.length < 2) {
    // Unstructured abstract — return as single block
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

    // Title case the heading
    const heading = rawHeading.charAt(0).toUpperCase() +
      rawHeading.slice(1).toLowerCase().replace(/\b(and)\b/g, 'and');

    const cleanContent = content
      .replace(/^\s*:\s*/, '') // Remove leading colon
      .trim();

    if (heading || cleanContent) {
      sections.push({ heading, text: cleanContent });
    }
  }

  return sections;
}
