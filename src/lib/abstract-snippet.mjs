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
// and real acronyms (PCOS, AMH, IVF) survive.
//
// THE CLAIM THAT USED TO SIT HERE WAS FALSE, and the correction is left in
// place rather than quietly deleted. The line read: "Corpus-audited over 3,720
// abstracts: 1,233 distinct labels removed, 0 left leading, 0 false
// positives." The first two counts were true. "0 false positives" was not:
// from 2026-07-13 to 2026-09-18 this stripper deleted real prose from 860 of
// those same 3,720 abstracts, and the sentence's own example ("risk of PCOS: a
// review") was one of the things it broke. Cause and dates are on
// abstractLabelRegExp below.
//
// The audit was not fabricated; it measured the wrong thing. It counted what
// the stripper removed ON PURPOSE and never what it removed by accident, which
// is how a real measurement over the real corpus reported success. Any
// re-audit of this file compares BEFORE and AFTER text, never label counts.
//
// Separator is a colon OR a bare line break — some journals label sections by
// newline only ("Background\nEndometriosis can be…"). A bare space is NOT a
// separator: stripping "Background " would risk eating real prose, and it only
// affects ~0.7% of abstracts. Corpus-audited: 0 over-strips.
export const ABSTRACT_LABEL_WORDS =
  'background(?: and objectives?)?|objectives?|introduction|purpose(?: of review)?|aims?|methods?(?: and materials)?|materials(?: and methods)?|results?(?: and the role of chance)?|conclusions?|design|setting|participants|patients|subjects|interventions?|main outcome measures?|outcome measures?|measurements|study design|study question|research question|study objective|context|importance|problem(?:\\/condition)?|in brief|summary(?: answer)?|discussion|limitations?|implications?|what is known already|reasons for caution|wider implications(?: of the findings)?|trial registration(?: number)?|study funding(?:\\/competing interests?)?|funding|clinical relevance|significance|data analysis'
  // Added 2026-09-18, after the `i`-flag fix stopped the generic arm eating
  // unlisted labels as collateral. These three were left showing at the head
  // of a snippet and are genuine section labels, so they belong in the
  // vocabulary, which is the declared mechanism for exactly this. Measured on
  // the live corpus before adding: Disclosure 3, "To the Editor" 3 (NOT added,
  // that is the opening of a letter and real content), Rationale 1,
  // Description 1.
  //
  // "description" is the borderline one and it is deliberately included: as a
  // label it must still be followed by a colon or newline AT a whitespace
  // boundary, which is what keeps it from matching the word in running prose.
  // The corpus check below the fix records that it removes nothing else.
  + '|disclosures?|rationale|description';

/** The vocabulary, letter by letter, so it matches any case WITHOUT an `i`
 *  flag on the whole pattern.
 *
 *  This exists because of the defect below, and it is the only way to express
 *  "this arm is case-insensitive, that arm is not" in one JavaScript RegExp:
 *  JS has no inline (?i:...) group, and under a whole-pattern `i` flag there is
 *  no character class that can refuse lowercase, since [A-Z] and even
 *  (?![a-z]) both stop discriminating.
 *
 *  The vocabulary's own regex syntax survives untouched because none of it
 *  contains ASCII letters: it is only `(?:`, `)?`, `|`, `\\/` and spaces. */
const anyCase = (src) => src.replace(/[a-z]/gu, (c) => `[${c}${c.toUpperCase()}]`);

/** A fresh label-matching RegExp (global). Callers that need `.exec`/`.test`
 *  in a loop should build their own via this factory to avoid shared lastIndex.
 *
 *  THE 2026-07-13 DEFECT, fixed 2026-09-18. This factory carried the `i` flag:
 *
 *      `(^|\s)(?:(?:${ABSTRACT_LABEL_WORDS})|[A-Z][A-Z][A-Z \/&-]{1,28})(?::|\r?\n)\s*`, 'gi'
 *
 *  The `i` was needed for the vocabulary arm, so that "Background:" matched as
 *  well as "BACKGROUND:". It was applied to the whole pattern, and the second
 *  arm is written to mean "an ALL-CAPS run". Under `i` its classes match
 *  lowercase, and the third class contains a space, so the arm actually meant
 *  "any run of 3 to 31 letters and spaces followed by a colon". That is a
 *  clause of ordinary English, and it was deleted along with the colon.
 *
 *  Measured on the live corpus before the fix: 860 of 3,720 abstracts (23.1%)
 *  lost text, 29,935 characters in total, median 28, max 776. For example
 *  "Evaluation and treatment of recurrent pregnancy loss: a committee opinion"
 *  rendered as "Evaluation and treatment a committee opinion".
 *
 *  The history is worth keeping because the lesson is not "someone was
 *  careless". Commit 70ec00a6 (2026-07-13 10:06) shipped the all-caps arm
 *  ALONE and case-SENSITIVE, which was correct. Commit 8175edbd, seventeen
 *  minutes later, added the Title-Case vocabulary and the `i` flag it needed,
 *  and in the same commit added the header's claim of "0 false positives,
 *  corpus-audited over 3,720 abstracts". The audit counted labels removed and
 *  labels left leading -- both true, and both still true under the defect. It
 *  never asked what ELSE had been removed. The damage was mid-sentence and
 *  grammatical, so nothing looked broken for 67 days. */
export function abstractLabelRegExp() {
  return new RegExp(
    `(^|\\s)(?:(?:${anyCase(ABSTRACT_LABEL_WORDS)})|[A-Z][A-Z][A-Z \\/&-]{1,28})(?::|\\r?\\n)\\s*`,
    'g',
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
