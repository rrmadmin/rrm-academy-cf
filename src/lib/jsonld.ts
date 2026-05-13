/**
 * Serialize a JSON-LD value for safe inlining inside a `<script type="application/ld+json">`
 * block via `set:html={safeJsonLd(obj)}`.
 *
 * `JSON.stringify` escapes `"` and `\` but does NOT escape `<`. A string field anywhere in
 * the JSON-LD graph containing `</script>` (e.g. an article abstract, FAQ answer, post
 * excerpt, or any SSOT-supplied description that flows into JSON-LD) closes the inline
 * script block, after which the browser parses the rest as live HTML. This helper
 * converts every `<` to the JSON Unicode escape `<`, which is byte-equal in the
 * downstream JSON parser but invisible to the HTML tokenizer.
 *
 * Use everywhere JSON-LD is emitted via `set:html`. Do not bypass this helper.
 */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, '\\u003c');
}
