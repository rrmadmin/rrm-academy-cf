/**
 * The one greeting line for transactional email.
 *
 * Every sender that personalizes by name has to answer the same question: what
 * do we say to somebody whose name we do not have? Before 2026-08-25 four files
 * answered it four times and disagreed -- billing and auth said "Hi there,",
 * community and events said "Hi,", and each re-implemented the blank check with
 * slightly different guards. This is that decision, made once.
 *
 * The no-name case is not an edge case here. 2,476 of 4,037 user rows carry no
 * name in any column, almost all of them from the Wix-era import that brought
 * email addresses across and nothing else. Those people are on the active
 * newsletter list and in the community, so a greeting that reads badly without
 * a name reads badly for well over half the audience. "Hi there," is written to
 * be the normal case rather than a visible fallback.
 *
 * Takes a first name or a full name and uses the first token either way, so a
 * caller that only has `user.name` or a Stripe `customer_details.name` does not
 * have to split it first and get the blank handling subtly wrong on the way.
 *
 * Returns a plain-text line. HTML callers escape the result, exactly as they
 * escaped the bare name before.
 *
 * @param {string|null|undefined} name First name, full name, or nothing.
 * @returns {string} e.g. "Hi Ada," or "Hi there,"
 */
export function greetingLine(name) {
  return `Hi ${greetingName(name) || 'there'},`;
}

/**
 * The name part on its own, for callers that need to know whether a name exists
 * (to pick different copy, not to rebuild the greeting).
 *
 * @param {string|null|undefined} name
 * @returns {string} the first token, trimmed, or '' when there is no name
 */
export function greetingName(name) {
  // Non-strings are treated as no name rather than stringified. A caller that
  // hands this a number or a NaN has a bug, and "Hi there," is a far better
  // outcome for the person receiving the mail than "Hi NaN," or "Hi 0,".
  if (typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0];
}
