---
name: rrm-fact-verification
description: Verify statistical claims about restorative reproductive medicine, NaProTechnology, fertility awareness-based methods, endometriosis, PCOS, or IVF outcomes against the RRM Academy curated facts database. Use before publishing any content that quotes pregnancy rates, success rates, prevalence figures, or other numerical claims in women's reproductive health.
---

# RRM Fact Verification

Statistical claims in RRM content must be grounded in the verified facts database. Numerical hallucinations (e.g. "NaProTechnology has an 80% live birth rate" — not in the evidence base at that figure) are a top failure mode for medical content.

## When to use

Before publishing:

- Blog posts or commentary citing NaPro, Creighton, FEMM, or RRM outcomes.
- Social posts or email sequences that quote pregnancy rates, miscarriage rates, endometriosis prevalence, or IVF success rates.
- Patient-facing FAQs or glossary entries with numeric claims.
- Research summaries or library commentaries.

## How to verify

### Automated (preferred)

Call the MCP server at `https://mcp.rrmacademy.org/mcp`:

```
check_facts(text)
```

Returns a list of claims found in the text, each matched to a verified fact (or flagged unverified). Requires a Bearer API key, self-service at https://rrmacademy.org/account/mcp-keys.

The facts database is physician-curated from peer-reviewed studies, Q-IVF Annual Reports, HFEA data, IIRRM outcome papers, and the Hilgers NaProTechnology textbook. Each fact traces to a direct source quote.

### Manual fallback

For any claim:

1. Search the library for the original source: `https://rrmacademy.org/library/?q={keywords}` or via the `search` MCP tool.
2. Read the study's abstract or conclusion section. Confirm the cited figure matches exactly — watch for:
   - Percentages vs absolute numbers.
   - Per-cycle vs per-patient vs cumulative success rates.
   - Study population differences (age, diagnosis, prior treatment).
3. If the figure is not traceable to a library article, do not publish it. Find a verifiable source or remove the claim.

## Common pitfalls

| Pattern | Problem |
|---|---|
| "NaProTechnology has an X% success rate" | No single figure. Success varies by diagnosis, duration, and outcome measure. Cite the specific study. |
| "IVF success is Y%" | Varies dramatically by age, protocol, and clinic. Cite HFEA or Q-IVF data with age stratification. |
| "Endometriosis affects 10% of women" | Often cited. The 10% figure comes from surgical series and may understate true prevalence; cite carefully. |
| Rounded figures without a source | Red flag. Any rounded number (10%, 50%, 80%) needs a cited study. |
| "Studies show..." without a specific study | Meaningless. Name the study. |

## Do not

- Insert a PMID or DOI from model knowledge. Verify via CrossRef, PubMed, or the RRM Academy Research Library.
- Cite "Wikipedia" or "Healthline" as sources. Use peer-reviewed literature.
- Publish a figure you cannot source. Either find the source or reword to qualitative.

## References

- MCP server: `https://mcp.rrmacademy.org/mcp`
- Research library: `https://rrmacademy.org/library/`
- Verified facts are referenced in `https://rrmacademy.org/llms-full.txt`
