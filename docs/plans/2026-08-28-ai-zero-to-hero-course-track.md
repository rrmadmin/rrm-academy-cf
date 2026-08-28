# AI Course Track Plan

Date: 2026-08-28. Status: PLAN (grilled + approved in session "F High").

## RESTRUCTURE 2026-08-28 (Brian's call, after reviewing the Course 1 full draft)

The 9-module Zero to Hero course 1 is high quality but too much for the average clinician or clinic manager. Split into two products:

1. **AI Essentials** (NEW, the priority course). Audience: busy clinicians, solo-practice clinicians, clinic managers running a small practice. Just enough vocabulary for a mental model of the AI types they would actually use clinically. 13 terms, 7 short modules (0-6), hands-on from module 1. Module 5 "The Back Office Goldmine" added 2026-08-28 (Brian: the A+ back office angle): the zero-PHI lane for clinicians who opt out of patient-adjacent AI entirely, with the green/yellow/red 15-minute audit and the clinic manager as the back-office AI power user. Course stays product-neutral; the concept aligns with the Whittaker AI back-office offering without naming it. NO machinery internals (no RLHF, no parameters, no open-vs-closed). Drafts: `docs/content-drafts/ai-essentials/`. Lightened to v2 on 2026-08-28 (Brian: lighter than the first distillation). **Trust module added 2026-08-28 (Brian's call): a "Start Here: Can You Trust This Thing?" module 0 addressing the psychological barriers BEFORE any content: (a) the IVF/suppression-default bias of out-of-the-box chatbots (validated as real, reframed as steerable), (b) the hallucination reputation from academia, (c) the overblown job-replacement fear. Same thread inserted as one "elephant in the room" section in Zero to Hero module 1; nothing else in Zero to Hero changed.** **Whittaker AI pathway (Brian's call 2026-08-28): NO pitch at the course end; instead the module 0 instructor-disclosure block states plainly that Brian works with clinics on retainer through Whittaker AI ("that is the whole pitch; you will not hear it again"). Disclosure-as-awareness. Because the course is an RRMF member benefit and Whittaker AI is a Brian-controlled entity (4958), the disclosure arrangement should get a nod from the unconflicted board before launch; language is drafted transparency-first to make that easy.**
2. **AI Zero to Hero** (KEPT as-is, the deep track). The existing 9-module course for those who want depth. Drafts: `docs/content-drafts/ai-course-1/`.

Courses 2-3 (AI in Your Practice, The AI-Fluent Clinician) remain planned, sequenced after Essentials ships. Essentials is the build priority.

## Locked decisions

| Decision | Answer |
|---|---|
| Audience | RRM clinicians, RRM Academy product |
| Access | Member benefit (STUC-gated), not sold separately |
| Byline | Brian (named instructor; honest about who has the AI expertise) |
| Format | Text-first lessons + screen-recorded demos; cheap to update as tools change |
| Structure | Sequential 3-course ladder, each presumes the prior |
| Floor | True zero (some members have never opened ChatGPT) |
| Ceiling | Daily-workflow fluency + personalization (Projects/custom GPTs). No code, no external automation tools |
| Tool stance | Vendor-neutral concepts, demos in ChatGPT + Claude only |
| PHI | Firm rule + dedicated early module; every exercise PHI-free by design |
| Rollout | Ship course 1 first, drip 2 and 3 as finished |
| Course style | Honen-style (honen.com) interactivity, EMULATED on rrmacademy.org, not hosted on Honen. Each module: lesson + quiz + flashcards + scenario exercise + progress. Glossary doubles as the flashcard deck. No AI tutor in v1. (Decided 2026-08-28) |

## Structure rules (cross-cutting)

- Every term is defined before use, added to the shared glossary, and demonstrated live in a demo. No term appears in courses 2-3 that course 1 did not build.
- Every module = written lesson + short screen demo + one PHI-free hands-on exercise + prompt library entries.
- Both tools shown where behavior differs; one where it doesn't.
- Ships with a member-facing AI glossary (30-40 terms) referenced by all three courses.

## Course 1 — AI Zero to Hero: The Mental Model

True zero -> understands what they're using.

1. **What is AI, actually.** AI vs machine learning vs LLM vs "chatbot"; generative vs predictive; why "autocomplete on steroids" is both true and misleading.
2. **How an LLM works (no math).** Training on text -> patterns -> next-token prediction. Pretraining vs fine-tuning vs RLHF in plain language. Why there is no database inside.
3. **Core vocabulary, part 1 — the machinery.** Model, parameters, weights, training data, knowledge cutoff, inference, GPU. Glossary card per term.
4. **Core vocabulary, part 2 — the conversation.** Prompt, token (visual: how "endometriosis" tokenizes), context, context window (the model's working memory; why long chats degrade; why it "forgets"), system prompt, temperature/randomness (why the same question gets different answers).
5. **Hallucination, explained properly.** Confident fabrication as a structural feature of next-token prediction, not a bug being patched out. Citation fabrication as the canonical clinical hazard.
6. **The capability landscape.** Chat, reasoning models, web search/retrieval (RAG in plain terms), vision, voice/dictation, image generation, agents and skills (AI that takes multi-step actions vs AI that answers). Where each is today.
7. **The ecosystem map.** OpenAI/ChatGPT, Anthropic/Claude, Google/Gemini, open models; model tiers and names; free vs paid; what an ambient scribe actually is under the hood.
8. **The PHI line.** Never PHI in consumer tools; de-identification patterns; what a BAA changes; when to say no.
9. **Hands-on setup + first conversations.** Accounts, interfaces, dictation. Exercises deliberately demonstrate the concepts: watch it hallucinate a citation, watch it lose context in a long chat, compare model tiers on one prompt.

Deliverable alongside course 1: the member-facing AI glossary.

## Course 2 — AI in Your Practice

Understands -> productive.

0. **Mental model, level 2.** Prompt anatomy as steering the prediction; context = deliberately filling the context window; few-shot examples; structured output.
1. **Prompt anatomy that works.** Role, context, task, format, examples; the reusable template pattern.
2. **Documentation support.** Templates, note skeletons, referral and prior-auth letter drafting (de-identified workflow).
3. **Patient education at scale.** Handouts, FAQ answers, reading-level control, your-voice consistency.
4. **Literature triage.** Summarizing papers, extracting methods/limitations, interrogating a PDF, fabricated-reference defense.
5. **Admin and practice ops.** Policies, job posts, emails, scheduling logic, staff training material.
6. **Long documents and data.** Uploads, tables, structured output; explicitly tied to context-window limits and what happens past them.
7. **Building your prompt library.** Capture, refine, organize what worked.

## Course 3 — The AI-Fluent Clinician

Productive -> skilled.

0. **Mental model, level 3.** Reasoning/thinking models vs fast models and when each wins; agents, tools, and skills in practice; memory features vs context windows (what persists, what doesn't); retrieval vs training knowledge.
1. **Advanced judgment.** When to reach for AI vs not; second-opinion patterns; red-teaming your own output.
2. **Advanced prompting.** Multi-step reasoning, critique-then-revise loops, comparing model answers.
3. **Personalization.** Custom instructions, memory features, Claude Projects / custom GPTs for recurring workflows.
4. **Personal AI operating rhythm.** Daily/weekly workflow design; capstone: build 3 personalized assistants for your practice.
5. **Evaluating new tools.** Clinician's checklist: data handling, BAA, vendor claims. Keeps the course useful through tool churn.
6. **Staying current without drowning.** What actually matters when models update.

## Working titles

- Course 1: "AI Foundations for the Restorative Clinician"
- Course 2: "AI in Your Practice"
- Course 3: "The AI-Fluent Clinician"

## Companion docs

- Module template spec: `2026-08-28-ai-course-module-template-spec.md` (includes 2026-08-28 infra audit resolution + build-gap list)
- Glossary term list (flashcard deck SSOT): `2026-08-28-ai-course-glossary-terms.md`
- Existing platform specs this rides on: `docs/superpowers/specs/2026-06-06-honen-style-courses-upgrade-design.md` (rendition architecture, Phase 1 LIVE) and `2026-08-10-text-first-courses-design.md` (approved, pending implementation)

## Next steps

1. DONE 2026-08-28: module template spec, infra audit, glossary term list (41 terms, draft).
2. Course 1 lesson briefs -> full drafts (9 modules: lesson + quiz + flashcard defs + scenario + demo script), Brian byline, Brian reviews.
3. Code: article-primary reading fix + logged-out signup panel (per 2026-08-10 spec) + scenario rendition format. Small; coder agent, per-repo CI.
4. Load content as D1 rendition rows via existing admin CRUD; course row `access_type='members'`.
5. Record demos from scripts; Stream upload.
6. Ship course 1 + member announcement; courses 2-3 are authoring only.
