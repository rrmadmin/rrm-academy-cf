# Module 2: Three Habits for Reliable Results

AI Essentials for the Busy Clinician. Byline: Brian Whittaker. Status: DRAFT v2 (lightened) for Brian review.
Terms: context, working memory (context window), grounding. Length target: 8 minutes.

## Orientation

Three habits separate the people who get real value from the people who quit in a week. Here they are.

## Lesson

### Habit 1: Give it the details

The AI knows nothing about your situation except what you tell it (your **context**). Compare:

*"Write a letter about a missed appointment."*

*"Write a warm, brief letter from a small women's health practice to a patient who missed her follow-up. Goal: rebook without guilt. Fifth-grade reading level, under 120 words, end with our scheduling line."*

Ten seconds of detail, a completely different letter. The template: **who for, what for, tone, length, format.** Five slots.

> **Term: Context.** Everything you have put into the conversation. The AI's entire knowledge of your situation.

### Habit 2: Give it the document

The biggest upgrade in this course: **if the answer should come from a document, put the document in.** Paste it or upload it, then ask.

From its memory: decent odds of drift. From your document: reliable. This is called **grounding**, and it is your default for anything factual.

- "Summarize this paper's findings and limitations in plain language."
- "Turn this policy into a one-page staff checklist."
- "Here are our post-procedure instructions. Rewrite at a sixth-grade level. Keep every warning."

> **Term: Grounding.** Giving the AI the source and asking it to work from that. Your most reliable results live here.

### Habit 3: One chat per task

The AI's attention (**working memory**) is finite. One giant everything-chat degrades: instructions fade, documents blur together. Not a malfunction; overflow.

- New task, new chat.
- Long chat? Ask for a summary of what is settled, carry it into a fresh one.
- New chats remember nothing from old ones. Provide what it needs again.

> **Term: Working memory (context window).** The finite span of conversation the AI can attend to. One chat per task keeps it sharp.

### The cheat sheet

Five-slot prompt. Document goes in first. One chat per task. Refine, don't retype: "shorter," "warmer," "as a table."

## Demo script (2-3 min)

1. Both missed-appointment prompts side by side. "Ten seconds of detail."
2. Upload a public guideline PDF, ask for the plain-language recommendations. "Grounded. The reliable lane."
3. A messy months-old chat vs a fresh one, same ask. "One chat per task."

## Quiz (3 questions)

1. **MCQ.** Your post-procedure instructions need a lower reading level. Best move:
   - A. Ask the AI what post-procedure instructions should say
   - B. Paste yours; ask for a rewrite at the target level, keeping all warnings ✓
   - C. Ask it to remember standard instructions
   - D. Ask three AIs and merge
   - *A invites it to invent your medicine. B is grounding.*

2. **True/false.** "The AI remembers your previous chats."
   - False. ✓ *New chat, blank slate. Provide it again, or keep a task in its own chat.*

3. **Spot the problem.** One "AI stuff" chat, two months old, now mixing up documents and forgetting the tone she set in week one.
   - A. The AI is wearing out
   - B. Working memory overflow; one chat per task ✓
   - C. Needs the paid tier
   - D. Handbooks are too long for AI
   - *Expected behavior of a finite attention span. Hygiene fixes it.*

## Scenario

**Setup.** 15 minutes, three tasks: simplify a consent explainer, draft an MA job posting, pull key recommendations from a 30-page guideline PDF.

**Model answer.** Three chats. (1) Paste the explainer: "sixth-grade level, warm, keep every risk statement, under 300 words." (2) "Job posting, part-time MA, small women's health practice, friendly professional, duties + hours placeholder + how to apply, under 250 words." (3) Upload the PDF: "key recommendations, plain language, grouped by topic, with page numbers." Review each, refine once.

## Flashcards (3)

| Front | Back |
|---|---|
| Context | Everything you have put in the conversation; all the AI knows of your situation. *Fill it with the five-slot prompt.* |
| Grounding | Give it the document, ask it to work from that. *The default for anything factual.* |
| Working memory (context window) | The finite span it can attend to. *One chat per task; decay is overflow, not malfunction.* |
