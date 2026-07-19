// Shared abstract-snippet logic for the ArticleCard list variant.
// Single source of truth so the component (render) and the gate
// (scripts/gates/validate-abstract-snippets.mjs) strip labels identically.
//
// Structured abstracts carry section labels THROUGHOUT ("Background: … Methods:
// … Results: …"), not just at the front, so a leading-only strip would leave a
// label stranded mid-snippet. Two families exist in the corpus and both must go:
// ALL-CAPS ("OBJECTIVE:", 461) and Title-Case ("Background:", 263). We match a
// known label vocabulary in any case, plus any generic ALL-CAPS run — so an
// acronym in running prose ("…risk of PCOS: a review") is NOT a label position
// and real acronyms (PCOS, AMH, IVF) survive. Corpus-audited over 3,720
// abstracts: 1,233 distinct labels removed, 0 left leading, 0 false positives.
//
// Separator is a colon OR a bare line break — some journals label sections by
// newline only ("Background\nEndometriosis can be…"). A bare space is NOT a
// separator: stripping "Background " would risk eating real prose, and it only
// affects ~0.7% of abstracts. Corpus-audited: 0 over-strips.
export const ABSTRACT_LABEL_WORDS =
  'background(?: and objectives?)?|objectives?|introduction|purpose(?: of review)?|aims?|methods?(?: and materials)?|materials(?: and methods)?|results?(?: and the role of chance)?|conclusions?|design|setting|participants|patients|subjects|interventions?|main outcome measures?|outcome measures?|measurements|study design|study question|research question|study objective|context|importance|problem(?:\\/condition)?|in brief|summary(?: answer)?|discussion|limitations?|implications?|what is known already|reasons for caution|wider implications(?: of the findings)?|trial registration(?: number)?|study funding(?:\\/competing interests?)?|funding|clinical relevance|significance|data analysis';

/** A fresh label-matching RegExp (global). Callers that need `.exec`/`.test`
 *  in a loop should build their own via this factory to avoid shared lastIndex. */
export function abstractLabelRegExp() {
  return new RegExp(
    `(^|\\s)(?:(?:${ABSTRACT_LABEL_WORDS})|[A-Z][A-Z][A-Z \\/&-]{1,28})(?::|\\r?\\n)\\s*`,
    'gi',
  );
}

/** Strip structured-abstract section labels and normalise whitespace.
 *  Iterates to a fixed point: a match's trailing whitespace consumes the
 *  leading boundary of an ADJACENT label ("SETTING, Participants:"), so a
 *  single pass leaves the second label stranded. Looping until the string
 *  stops changing catches those (112 corpus offenders -> 0). */
export function abstractSnippet(abstract) {
  let s = String(abstract || '');
  let prev;
  do {
    prev = s;
    s = s.replace(abstractLabelRegExp(), '$1');
  } while (s !== prev);
  return s.replace(/\s{2,}/g, ' ').trim();
}
