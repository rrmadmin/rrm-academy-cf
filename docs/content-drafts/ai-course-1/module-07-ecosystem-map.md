# Module 7: The Ecosystem Map

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: model tier/family, open vs closed model, ambient scribe. Uses: model, compute, reasoning model, web search, multimodal, agent (Modules 3, 6).

NOTE FOR MAINTENANCE: this module names current products and plan prices; it is the most drift-prone module in the course. Review quarterly; prices and model names are illustrative in the draft and must be verified at publish time.

## Orientation

You now know the machinery and the capabilities. This module maps the actual marketplace: who makes the frontier models, how the product lines and subscription tiers relate, what "open" models are, and what an ambient scribe actually is under the hood. By the end you can read any AI product announcement and place it on the map, and you will know what to subscribe to and why.

## Lesson

### Three frontier labs, three product lines

Module 3 explained why frontier models come from a handful of companies: compute. In practice, three matter most for your daily use:

- **OpenAI** makes the GPT model family; the product is **ChatGPT**.
- **Anthropic** makes the **Claude** family; the product is also called Claude.
- **Google** makes the **Gemini** family, woven through Google's products as well as a standalone app.

All three ship the full Module 6 stack: standard and reasoning tiers, web search, vision, voice, and early agent features. For the text-heavy professional work this course teaches, all three are excellent, differing in feel more than in category: they interleave the lead on benchmarks every few months, and switching costs are low because the skills you are learning transfer completely. This course demos ChatGPT and Claude; everything taught works in Gemini too.

Around the big three sit others you will encounter: Meta's open Llama family (below), Microsoft's Copilot products (largely OpenAI models embedded in Office), Perplexity (a search-first AI product), and a fast-moving field of others. New names will keep appearing; the map's structure, labs making model families, products wrapping them, is what stays stable.

### Families and tiers: reading a model name

Each lab ships its models as a **family** spanning **tiers**: a fast, inexpensive model for everyday tasks; a flagship for hard work; often a reasoning specialist (Module 6). Names change constantly; the tier structure does not. When you see any model name, ask two questions: whose family, and which tier, fast, flagship, or reasoning?

Practical tier habit: default to the fast tier for transformations (rewrites, formats, summaries of supplied text); step up to the flagship or reasoning tier when the task is analysis, ambiguity, or anything you will act on. Paid plans exist largely to sell you access to the upper tiers and higher usage limits, because upper tiers burn more compute per answer (Module 3).

> **Term: Model tier / family.** A lab's related models (family) at different capability and cost levels (tiers): fast, flagship, reasoning. Names churn; the structure persists. Match the tier to the task.

### What subscriptions actually buy

Free tiers of ChatGPT, Claude, and Gemini are genuinely capable and fine for this course's exercises. The roughly $20-per-month individual plans buy: upper-tier model access, much higher usage limits, and earlier access to new features. For a clinician using AI daily, one paid subscription to any of the big three is easily justified; which one matters far less than the habit of using it.

The tier that matters professionally is the business or enterprise plan, not for capability but for **data terms**: business plans typically contract that your conversations are not used to train models, and offer administrative controls. Module 8 turns this from a shopping note into the deciding factor for anything work-related; for now, plant the flag: **the plan you are on changes what happens to what you type.**

### Open versus closed models

The big three are **closed** models: you use them through the lab's product or API; the weights, the billions of parameters from Module 3, stay on the lab's servers. An **open** model (Meta's Llama family is the flagship example) has weights published for download: anyone can run it on their own hardware, modify it, and build on it.

Why a clinician should care, in two lines: open models power many of the cheaper products you will be pitched (ask any vendor whose model is under the hood, and how it is kept current); and open weights are what make fully self-hosted deployment possible, an option some health systems pursue precisely because data then never leaves their infrastructure. Capability-wise, the strongest closed models generally lead, with open models a competitive step behind, close enough for many embedded uses.

> **Term: Open vs closed model.** Closed: weights stay on the maker's servers; you use their product. Open: weights are published; anyone can run or modify the model on their own hardware. Open models underpin many cheaper products and all self-hosted deployments.

### The ambient scribe, decomposed

The AI product most aggressively marketed to clinicians right now is the **ambient scribe**: an app that listens to the visit and produces a draft note. You now own every concept needed to see through the marketing, because under the hood an ambient scribe is a pipeline of things you already know:

1. **Speech-to-text** (Module 6's voice capability) transcribes the room audio, including diarization, figuring out who said what.
2. **An LLM** transforms that transcript into a structured note, exactly the grounded-transformation task from Module 5: the transcript is the source material in the context window.
3. **Templates and system prompts** (Module 4) shape the note to the practice's format.

Decomposed, the evaluation questions ask themselves. Transcription quality: how does it handle accents, terminology, crosstalk? Generation: it can hallucinate, yes, even grounded on a transcript, models can add plausible content the patient never said, so what does review look like and how good is the diff against the transcript? Data: room audio is maximally sensitive patient data; where does it go, who holds it, is it trained on, and is there a BAA? (Module 8 gives you that last word properly.) And the models under the hood: whose, and on what plan's data terms?

Ambient scribes are a genuinely promising category, and several are mature commercial products. The point of this section is not skepticism for its own sake; it is that you can now interrogate one like a professional rather than a spectator.

> **Term: Ambient scribe.** A visit-listening product: speech-to-text plus an LLM drafting a structured note from the transcript, wrapped in templates. Evaluate as a pipeline: transcription quality, generation review, and above all data handling.

### Placing anything on the map

Any AI product you will ever be pitched decomposes the same way: **which model family (whose, which tier, open or closed) wrapped in what product machinery (RAG on which library? agent with which tools? templates and system prompts?) under what data terms?** Three questions, and the fog around any vendor pitch lifts. Try it on the next one you hear.

### Try it

Read one AI product announcement this week, from any vendor in your inbox, and answer the three questions: whose model, what wrapper, what data terms? If the announcement does not say, notice that too; it is usually the most informative omission.

## Demo script (3-5 min)

1. Screen: the three product interfaces side by side, same prompt to each. "Three labs, three families, one skill set. Notice the answers differ in voice, not in kind."
2. Open one product's model picker slowly. "Fast tier, flagship, reasoning. Ignore the names, read the structure. Default fast, escalate deliberately."
3. Pull up a (real, current) ambient scribe marketing page. Decompose it live, annotating: "Speech-to-text, here. LLM drafting from the transcript, here. And the question the page does not answer: where does the audio go? That is Module 8."
4. Close: "Labs, families, tiers, wrappers, data terms. One module remains before hands-on: the data rules that make all of this safe to use in a medical life."

## Quiz (5 questions)

1. **MCQ.** ChatGPT, Claude, and Gemini are best described as:
   - A. Three names for the same underlying model
   - B. Products wrapping the model families of OpenAI, Anthropic, and Google respectively ✓
   - C. Open models anyone can self-host
   - D. Specialized medical AI systems
   - *Explanation: Three labs, three families, three products, all shipping a similar capability stack. Skills transfer across them.*

2. **MCQ.** The most professionally consequential difference between an individual plan and a business plan is usually:
   - A. The business plan's models are smarter
   - B. The data terms: business plans typically contract that conversations are not used for training, plus admin controls ✓
   - C. Business plans remove the context window
   - D. There is no difference except price
   - *Explanation: Capability differences are modest; what happens to your data is the real dividing line, and Module 8 makes it decisive for work use.*

3. **True/false with why.** "An open model means the product built on it is free."
   - False. ✓ *Open refers to published weights, not price of products. Vendors build paid products on open models; the relevant questions are whose model, how current, and self-hosted or not.*

4. **MCQ.** Under the hood, an ambient scribe is:
   - A. A single medical AI trained to write notes from thin air
   - B. Speech-to-text feeding an LLM that drafts a note grounded on the transcript, shaped by templates ✓
   - C. A RAG system over the practice's protocols
   - D. An agent that acts in the EHR unsupervised
   - *Explanation: It is a pipeline of known parts, which is exactly what makes it evaluable: transcription quality, generation review, data handling.*

5. **Spot the problem.** A vendor pitches: "Our scribe uses proprietary medical AI, so unlike chatbots it cannot make things up, and clinician review is optional."
   - A. Plausible; medical-specific models do not hallucinate
   - B. Two red flags: an LLM drafting from a transcript can still add plausible unsaid content, so "cannot make things up" is false, and review of AI-drafted clinical notes is not optional ✓
   - C. The only issue is the word "proprietary"
   - D. Nothing wrong if the price is right
   - *Explanation: Grounding reduces hallucination; nothing abolishes it (Module 5). A claim of impossibility plus optional review is a vendor telling you they misunderstand, or hope you do.*

## Scenario

**Setup.** Your practice group is choosing between: (a) individual $20 ChatGPT plans for each clinician, (b) a business-tier Claude deployment, and (c) a cheaper third-party "medical AI assistant" that, on inspection, runs an open model with RAG over a medical library. You have this course's Modules 1 through 7 and one meeting to frame the decision.

**Task.** Write four or five sentences framing the decision the way this module taught: model, wrapper, data terms.

**Model answer.** All three run capable models, so capability is not the deciding axis. Option (a) is frontier models on individual data terms, which Module 8 will show is the wrong contract for anything work-related, whatever its convenience. Option (b) is a frontier family under business data terms (no training on our conversations, admin controls), the strongest data posture of the three for general professional use. Option (c) must be decomposed before it can be compared: whose open model and how current, what exactly is in the RAG library and who maintains it, and what are its data terms and BAA posture, questions the price tag does not answer. The framing for the meeting: we are not buying "an AI," we are choosing a model family, a wrapper, and a data contract, and the data contract is where medical practices win or lose.

## Flashcards (3)

| Front | Back |
|---|---|
| Model tier / family | A lab's related models at fast / flagship / reasoning tiers; names churn, structure persists. *Why you care: default to fast for transformations, escalate for analysis; paid plans mostly sell the upper tiers.* |
| Open vs closed model | Closed: weights on the maker's servers. Open: weights published, runnable and modifiable by anyone. *Why you care: open models power many cheap products and all self-hosted health-system deployments; always ask whose model is under the hood.* |
| Ambient scribe | Speech-to-text plus an LLM drafting a note grounded on the visit transcript, wrapped in templates. *Why you care: evaluate as a pipeline (transcription, generation review, data handling), not as magic; room audio is maximally sensitive data.* |
