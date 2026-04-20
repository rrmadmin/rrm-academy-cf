Ask RRM Academy is a conversational answer tool at rrmacademy.org/ask. It answers questions about restorative reproductive medicine using the RRM Academy research library and glossary as its knowledge base, with editorial guardrails that restrict citations to real RRM Academy sources. It is currently in beta and requires a free account.

## Why We Built Ask RRM Academy

Most people searching for answers about [what restorative reproductive medicine is](/what-is-rrm/) get back twenty blue links. Some are accurate. Many are not. None of them know the RRM research base.

Generic AI assistants have the same problem at higher speed. They synthesize the median of whatever they were trained on. For RRM, NaProTechnology, cycle charting, endometriosis excision, or hormone evaluation, the median internet is not a reliable source.

You deserve answers pulled from the actual evidence. That is the only reason Ask RRM Academy exists.

## What Ask RRM Academy Actually Does

[Ask RRM Academy](/ask/) answers patient and clinician questions using a single, controlled knowledge base: the 3,200+ article [research library](/library/) and 159-term [glossary](/glossary/). It does not reach out to the open web. It does not synthesize generic health content.

You ask a question. It searches the library. It generates an answer. Every citation links to a real library page you can read yourself.

### How the Grounding Works

The system uses Cloudflare AI Search to crawl rrmacademy.org and index the library and glossary. Llama 3.3 70B generates the answer. The system restricts citations to real library URLs. Nothing is invented.

This is retrieval-augmented generation: the model does not answer from memory alone. It searches first, then writes. That distinction matters when accuracy is the point.

### The Editorial Guardrails

The system prompt carries the same editorial rules that govern all RRM Academy content.

The tool will not nudge you toward generic AI responses or answers that treat infertility as a technology problem to be solved rather than a condition to be diagnosed. When a question uses the phrase "unexplained infertility," the tool gently reframes it: infertility labeled unexplained usually means the diagnostic workup is unresolved, not that a cause does not exist. The tool will not tell you your symptoms are normal for you and leave it there.

These guardrails matter more than raw model size. A larger model without constraints will confidently give you the median answer. A constrained model grounded in the right sources gives you the RRM answer.

## Who It Is For

Patients who want fast, trustworthy answers without clinical jargon. People who have already read the generic articles and want to go deeper. Questions about cycle charting, NaProTechnology, endometriosis diagnosis, PCOS, hormone evaluation, recurrent pregnancy loss, and reproductive health generally are all within scope.

Clinicians curious about retrieval-grounded medical AI assistants will find it worth testing. The architecture is transparent: known source set, constrained citations, auditable answers.

A [free account](/signup/) unlocks Ask RRM Academy along with the full library, glossary, and courses.

## The Honest Limits (And Why the 20/Day Cap Exists)

Beta is not a marketing label. Tuning is ongoing. The model will occasionally miss relevant sources or weight a citation imprecisely. Confirm anything clinically significant with your care team. Ask RRM Academy is an educational tool, not a clinical decision support system, and not a replacement for a clinician.

The 20 queries per day cap is a deliberate tradeoff. Quality degrades when the system is pushed at scale. For a nonprofit, sustainable operating costs are real. Most users finish a research session well under 20 queries. The cap exists to protect both.

If you find an answer that is wrong or missing a key source, the feedback mechanism in the interface matters. Every report shapes the tuning that makes the next answer better.

## How to Try It

Sign in to your account, then go to [Ask RRM Academy](/ask/). Type a question. The tool returns an answer with citations you can follow.

Start with something specific. "What does NaProTechnology recommend for luteal phase defect?" or "How is endometriosis diagnosed without surgery?" or "What does cycle charting show about hormone patterns?" are the kinds of questions it is built for.

Answers include source links. Follow them. The library pages behind those links carry the full research context. Ask is a starting point, not the endpoint.

## Frequently Asked Questions

### Do I need an account to use Ask RRM Academy?

Yes. A free RRM Academy account is required. That same account also unlocks access to the research library, glossary, and available courses.

### Is the tool accurate?

The tool generates answers from the library of 3,200+ articles and the 159-term glossary. Citations link only to real library pages. This is a beta tool: tuning is ongoing, and the model can miss sources or weight citations imperfectly. Confirm clinical decisions with your care team.

### What does Ask RRM Academy know about?

The tool is grounded in the RRM Academy library and glossary. Topics include cycle charting, NaProTechnology, endometriosis, PCOS, recurrent pregnancy loss, hormone evaluation, and reproductive health generally. It does not reach outside this source set.

### Why is there a 20 queries per day limit?

The cap keeps answer quality high and keeps costs sustainable for a nonprofit. Most users finish research sessions well under 20 queries per day.

*Ask went live on April 16, 2026. Start at [rrmacademy.org/ask](/ask/).*
