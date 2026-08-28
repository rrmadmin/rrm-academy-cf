# Module 6: The Capability Landscape

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: reasoning model, retrieval/RAG, web search (in-chat), multimodal, agent, skill/tool. Uses: LLM, knowledge cutoff, context window, grounding, hallucination (Modules 1-5).

## Orientation

So far, "AI" has meant a text-in, text-out chat. This module widens the lens to the capabilities now bolted around that core: models that think before answering, models that look things up, models that see and hear, and models that act. By the end you can name each capability, know when to reach for it, and know which of Module 5's cautions travel with each one.

## Lesson

### Reasoning models: thinking before answering

A standard model starts producing its answer immediately. A **reasoning model** (also marketed as a thinking model) first generates extensive internal work: breaking the problem down, trying approaches, checking itself, before composing the reply. You see a pause and sometimes a summary of its thinking; underneath, it is spending far more computation per question.

The tradeoff is time and cost for reliability on hard problems. Reasoning models markedly outperform standard ones on multi-step logic, careful document analysis, math, and problems with interacting constraints. For "rewrite this paragraph warmly," the extra machinery buys nothing; for "reconcile these three guideline excerpts and identify where they actually conflict," it can be the difference between shallow and genuinely useful.

Rule of thumb: standard model for speed and transformation, reasoning model when the answer requires holding several things in tension. Both hallucinate; reasoning reduces careless errors, not fabrication, so Module 5's rules ride along unchanged.

> **Term: Reasoning model (thinking model).** A model that generates extensive internal work before answering. Slower and costlier, markedly better on multi-step and analytical problems. Reduces careless error, not fabrication.

### Retrieval: the model that looks things up

Module 2's frozen model has an obvious fix: let it fetch text at answer time and ground on what it fetched. The general pattern is called **retrieval**, or **RAG** (retrieval-augmented generation): search a source, pull relevant passages into the context window, generate from them. You will meet RAG mostly as a vendor word; products that "chat with your protocols" or search a curated medical corpus before answering are RAG systems, and the quality of any RAG product is gated by what is in its source library, a question to ask every vendor.

The everyday version you control is **web search** inside the chat: the model searches the live web mid-conversation and grounds its answer on what it finds, with links. This directly patches the knowledge cutoff and converts many hallucination-prone questions into grounded ones.

Two new habits come with it:

- **Turn it on for anything recent or checkable.** Current guidelines, drug availability, anything after the cutoff, and any citation you want to actually exist. A cited claim from live search is categorically different from a generated citation (Module 5): a real page exists, and you can click it.
- **Grounded is not the same as right.** Search grounds the answer in sources, and the sources themselves may be weak: the model can retrieve a low-quality page as readily as a strong one, and summaries can flatten a source's caveats. Check what it actually cited; the links are the point.

> **Term: Retrieval / RAG.** Fetching relevant text from a source (a document library, a database) into the context before generating, so the answer is grounded on retrieved passages rather than training memory. The architecture behind "chat with your documents" products.

> **Term: Web search (in-chat).** The model searching the live web mid-answer and grounding on results, with links. Patches the knowledge cutoff; shifts your scrutiny from "does this source exist" to "is this source good."

### Multimodal: models that see and hear

**Multimodal** models accept and produce more than text: images, audio, and increasingly video. Practically, today, three capabilities matter to you:

- **Vision.** Paste or upload an image and the model reads it: a photographed form, a chart screenshot, a table in a scanned PDF, a slide. Enormously useful for "get this into workable text" tasks. Not a diagnostic device: consumer vision reading a clinical image is nowhere near regulated imaging AI (Module 1's other branch), and no patient-identifying image belongs in a consumer tool anyway (Module 8 makes this precise).
- **Voice.** Speaking instead of typing, and hearing answers back. The underlying interaction is unchanged: your speech becomes tokens in the same context window; everything from Modules 4 and 5 applies verbatim.
- **Image generation.** Producing diagrams and illustrations from a description. Useful for patient-education visuals, with review, since generated anatomy can be confidently wrong in the same way generated citations are.

> **Term: Multimodal.** Model capability beyond text: reading images (vision), conversing by voice, generating images. Same prediction machinery, same cautions, new input and output channels.

### Agents: models that act

Everything so far answers. An **agent** acts: given a goal, it works in steps, using **tools**, and checks its progress. A tool (some products say **skill**) is a capability the agent can invoke: run a search, open a browser, read a file, execute code, fill a form. The agent loop is: assess the goal, pick a tool, use it, look at the result, decide the next step, repeat until done.

You have already met a miniature agent without the label: a model that decides mid-answer to run a web search, reads the results, and searches again with a refined query is doing a small agent loop. Full agent products extend this to booking, form-filling, multi-document research, and multi-step office tasks.

For clinicians, agents are the capability to watch rather than the one to lean on first, and the reason is a straight extension of Module 5: **an agent that acts on a hallucination does not just tell you something wrong, it does something wrong.** The review-before-use discipline that makes chat safe has to become review-before-execution, and consumer agent products are still building those checkpoints. Understand the concept now; adopt slowly, with the same stakes-scaled caution, and never in a lane where an unreviewed action touches a patient or a chart.

> **Term: Agent.** An AI that pursues a goal in steps, using tools and reacting to results, rather than only answering. The frontier capability; adopt behind a review-before-execution discipline.

> **Term: Skill / tool.** A discrete capability an agent can invoke: search, browse, read files, run code, fill forms. The verbs an agent has; an agent is only as trustworthy as its tools and checkpoints.

### Choosing from the landscape: a one-glance map

| Your task | Reach for |
|---|---|
| Rewrite, summarize, draft from supplied material | Standard chat, grounded (Module 5) |
| Hard analysis, multi-document reconciliation, logic | Reasoning model |
| Anything recent, anything you will cite | Web search on |
| "Chat with our protocols" product evaluation | It is RAG; audit the source library |
| Photographed form, chart screenshot, slide | Vision |
| Hands-busy capture, dictated drafting | Voice |
| Patient-education diagram | Image generation plus your review |
| Multi-step tasks executed for you | Agents; cautiously, checkpoints, watch this space |

### Try it

Take one question in your field where the answer has plausibly changed in the past year. Ask it three ways in the same product: standard model without search, with web search on, and to a reasoning model. Compare the three answers for currency, sourcing, and depth. Ten minutes, and the landscape stops being abstract.

## Demo script (4-6 min)

1. Split screen, same hard prompt (a three-guideline reconciliation) to a standard model and a reasoning model. Show the pause, then compare depth. "Same vendor, different machine. This one thought first."
2. Ask a post-cutoff question without search: show the stale or hedged answer. Toggle search on, re-ask: show the current, linked answer. Click a link. "That is a real page. This is the difference between generated and grounded citations."
3. Upload a photo of a printed (synthetic, non-patient) intake form: "Extract this into a table." Show it. "Vision: paper to workable text in one step."
4. Thirty-second agent teaser, screen recording of an agent doing a multi-step lookup with visible steps. "It is acting, not just answering. Powerful, and every Module 5 caution now applies to actions. We adopt this one slowly."
5. Close: "Thinker, searcher, seer, doer. Next module: the actual products these live in, and which subscriptions are worth it."

## Quiz (5 questions)

1. **MCQ.** Which task most justifies a reasoning model over a standard one?
   - A. Warming up the tone of a recall letter
   - B. Identifying where three overlapping guideline excerpts genuinely conflict ✓
   - C. Converting a paragraph to bullet points
   - D. Generating four subject-line options
   - *Explanation: Multi-source reconciliation is multi-step analysis under constraints, exactly where extra deliberation pays. Transformations do not need it.*

2. **MCQ.** A vendor demos a product that "answers from your practice's protocols." Architecturally, this is:
   - A. A model fine-tuned on your protocols nightly
   - B. Retrieval (RAG): fetching relevant protocol passages into context before generating ✓
   - C. An agent
   - D. A larger context window
   - *Explanation: "Chat with your documents" products are RAG. The follow-up question writes itself: what exactly is in the retrieval library, and how is it kept current?*

3. **True/false with why.** "With web search turned on, the model's cited sources exist, so the answer no longer needs scrutiny."
   - False. ✓ *Search solves existence, not quality: the model can ground on weak pages and flatten caveats. Scrutiny moves from "is this real" to "is this good," and the links are there to be checked.*

4. **MCQ.** Why do agents demand a stricter discipline than chat?
   - A. They use more compute
   - B. A hallucination becomes an action taken, not just a statement made, so review must happen before execution ✓
   - C. They cannot use web search
   - D. They only run on reasoning models
   - *Explanation: Acting on wrong output does damage directly. The chat-era habit of reviewing before use must become reviewing before the agent executes.*

5. **Spot the problem.** A practice manager plans: "We will have the voice assistant listen in the exam room and an agent auto-send the follow-up instructions it drafts to each patient, no review step, to save time."
   - A. Fine; voice models are more accurate than typed chat
   - B. Two failures: exam-room audio is patient data in a consumer tool (Module 8 territory), and auto-sending unreviewed AI drafts to patients removes the review-before-execution safeguard exactly where stakes are highest ✓
   - C. The only problem is cost
   - D. Agents cannot send messages, so the plan is impossible
   - *Explanation: Multimodal input does not change data rules, and agent execution without review is the precise failure mode this module warns against, aimed at patients.*

## Scenario

**Setup.** You want to know whether anything published in the last twelve months changes how you counsel patients on a specific adjunct therapy you sometimes recommend. You have twenty minutes between patients and a paid AI subscription with a standard model, a reasoning model, and web search.

**Task.** Write your play, step by step, naming which capability you use at each step and why. Then reveal the model answer.

**Model answer.** One strong play: (1) Web search on, standard model: "What has been published on [therapy] for [indication] in the last 12 months? List studies with links." Search, because this is a recency question the frozen model cannot answer; links, because Module 5 says citations must be real and checkable. (2) Open the links; discard weak sources yourself. (3) Feed the one or two substantive papers (PDFs or pasted abstracts) to the reasoning model: "Given my current counseling approach [two sentences], does anything here change it? Reason carefully, and separate what the evidence shows from what it merely suggests." Reasoning model, because this is now multi-document analysis under clinical constraints; grounding, because the papers are in context. (4) Verify any specific figure you plan to quote against the paper itself before it enters a patient conversation. Twenty minutes, each capability doing the one thing it is for.

## Flashcards (6)

| Front | Back |
|---|---|
| Reasoning model (thinking model) | Generates extensive internal work before answering; slower, costlier, much better on multi-step analysis. *Why you care: reach for it when the answer must hold several things in tension; it reduces careless error, not fabrication.* |
| Retrieval / RAG | Fetching relevant passages from a source library into context before generating. *Why you care: the architecture of every "chat with your documents" product; its quality ceiling is the library, so audit the library.* |
| Web search (in-chat) | The model searches the live web and grounds its answer, with links. *Why you care: patches the knowledge cutoff and makes citations real; your job shifts to judging source quality.* |
| Multimodal | Input and output beyond text: vision, voice, image generation. *Why you care: paper-to-text and hands-free capture are immediate wins; data rules and review discipline are unchanged.* |
| Agent | AI pursuing a goal in steps with tools, acting rather than only answering. *Why you care: a hallucination becomes an action; adopt behind review-before-execution, never patient-facing without a human gate.* |
| Skill / tool | A discrete capability an agent can invoke (search, browse, code, forms). *Why you care: the agent's verbs; trustworthiness is set by its tools and checkpoints, so ask what it can do and where it stops.* |
