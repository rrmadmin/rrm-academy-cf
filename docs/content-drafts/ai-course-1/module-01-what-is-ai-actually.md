# Module 1: What Is AI, Actually

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: artificial intelligence (AI), machine learning, large language model (LLM), generative AI.

## Orientation

By the end of this module you will be able to say what "AI" actually refers to when people say it in 2026, tell the difference between the AI that reads mammograms and the AI you type to, and explain why "it's autocomplete on steroids" is both true and misleading. Four terms enter your vocabulary here, and every later module builds on them.

## Lesson

### First, the elephant in the room

Most clinicians arrive at this course carrying some distrust, usually from experience: a chatbot that discussed fertility as if IVF were the only serious option, the academic reputation these tools have for inventing references, or the background hum of "AI will replace us." Name all three now, because this course takes each seriously rather than waving them away. The IVF-first default is real and structural, and Modules 2 and 5 explain exactly where it comes from and how completely you can redirect it. The fabrication problem is real and permanent, and Module 5 turns it into a managed, thirty-second habit. The replacement fear is the weakest of the three: these tools do words-work, not medicine, and patients want a human who knows them; the practical gap is between clinicians who reclaim hours with these tools and clinicians who do not. You do not need to trust AI to profit from this course. You need to understand it, which is precisely what distrust done well looks like.

### The word "AI" is doing too much work

When a colleague says "I used AI for that," they could mean a dozen different technologies. The term covers the software that flags abnormal cells on a pathology slide, the system that predicts which patients will no-show, the dictation tool on your phone, and the chatbot that drafted their newsletter. These work in very different ways, and lumping them together is where most confusion about AI starts.

**Artificial intelligence (AI)** is the umbrella term: software that performs tasks we associate with human intelligence, like recognizing patterns, understanding language, or making predictions. It is a marketing word as much as a technical one. Nothing inside these systems is "intelligent" the way you are. They are mathematical systems that got very good at specific tasks.

> **Term: Artificial intelligence (AI).** Software performing tasks associated with human intelligence: pattern recognition, language, prediction. An umbrella term, not a specific technology.

### Machine learning: patterns from examples, not rules from programmers

Most modern AI is built with **machine learning**. The old way to build software was to write explicit rules: if temperature over 100.4, flag as fever. Machine learning flips this. Instead of writing rules, you show the system millions of examples and it finds the patterns itself.

A spam filter was never given a rule list for what spam looks like. It was shown millions of emails labeled spam or not-spam, and it learned the statistical fingerprints on its own. The same approach reads imaging studies: show a system enough labeled scans and it learns to spot what radiologists spot, sometimes catching things they miss, sometimes failing in ways no human would.

This matters to you for one reason above all: **a machine-learned system is only as good as its examples.** It has no understanding underneath, only patterns extracted from what it was shown. When it meets something unlike its training examples, it does not know that it does not know. Hold that thought; it becomes the center of Module 5.

> **Term: Machine learning.** Building software by showing it millions of examples and letting it find patterns, instead of programming explicit rules. The foundation of nearly all modern AI.

### The kind you will actually use: generative AI and LLMs

The AI boom you have lived through since late 2022 is about one specific family: **generative AI**. Earlier machine learning mostly classified or predicted things that already existed: is this spam, is this scan abnormal, will this patient no-show. Generative AI produces new content: text, images, audio, video, that did not exist before.

The generative AI you will use most is the **large language model**, or **LLM**. ChatGPT, Claude, and Gemini are all LLMs with a chat interface on top. An LLM is a machine-learned system trained on an enormous amount of text, a meaningful fraction of the public internet plus books and articles, whose one trick is: given some text, predict what text comes next.

That sounds too simple to matter. Here is why it is not.

### "Autocomplete on steroids": true and misleading

You have used autocomplete. Your phone suggests "you" after you type "thank." An LLM does the same fundamental operation, predicting the next chunk of text, but at a scale that changes what the operation *is*.

To predict the next word well across everything humans have written, the system had to internalize an enormous amount of structure: grammar, logic, the format of a referral letter, the difference between how a textbook and a patient forum discuss the same condition. Predicting the next word in "The most common cause of secondary amenorrhea is..." requires something that behaves a lot like medical knowledge. So the "autocomplete" framing is true about the mechanism and misleading about the capability. These systems draft documents, summarize papers, translate jargon into plain language, and reason through problems step by step, because doing next-word prediction extremely well turns out to require those abilities.

Here is the part to keep: **the mechanism never changes.** Even when the output looks like expertise, the system is producing plausible next words, not consulting a database of verified facts. It has no internal fact-checker, no concept of true versus false, only patterns of what text tends to follow what text. That single mechanism explains almost everything about when these tools are brilliant and when they are dangerous, and the rest of this course is largely working out its consequences.

> **Term: Generative AI.** AI that produces new content (text, images, audio) rather than only classifying or predicting existing data.

> **Term: Large language model (LLM).** A generative AI trained on massive amounts of text to predict what text comes next. ChatGPT, Claude, and Gemini are LLMs. The technology this course teaches you to use.

### Where each kind of AI meets your practice

- Classification-style machine learning: imaging analysis, risk scores, billing anomaly detection. Usually embedded in products; you consume its outputs.
- Generative AI / LLMs: drafting, summarizing, explaining, brainstorming. You drive it directly, which is why skill matters.
- Speech-to-text (dictation, ambient scribes): machine learning for hearing plus, increasingly, an LLM for structuring the note. Covered properly in Module 7.

This course is about the second category, because it is the one where your skill determines the value.

### Try it

No account needed yet; this is a thought exercise. Next time you hear "AI" this week, in a vendor pitch, a headline, a colleague's story, ask which kind: is it classifying something, or generating something? The answer changes what questions you should ask about it.

## Demo script (2-4 min screen recording)

1. Open a plain ChatGPT window and a Claude window side by side. "These are the two tools this course uses. Both are LLMs, the same kind of AI, made by different companies."
2. In one, type: "Continue this sentence: The patient was advised to return in..." Show the completion. "Under the hood, this is the whole trick: predict what text comes next."
3. Then type: "Explain in three sentences, for a medical audience, why a language model can draft a referral letter." Show the answer. "Same trick, next-word prediction, but at a scale where it produces useful professional work."
4. Close: "Notice what we did not do: look anything up. Nothing was retrieved from a database. It generated every word. Keep that in mind; it is the key to everything in Module 5."

## Quiz (5 questions)

1. **MCQ.** A vendor says their product "uses AI" to flag abnormal cervical cytology. Which kind of AI is this most likely to be?
   - A. A large language model
   - B. Classification-style machine learning trained on labeled slides ✓
   - C. Generative AI producing new images
   - D. Autocomplete
   - *Explanation: Flagging abnormals is classification: pattern recognition on labeled examples. No new content is generated.*

2. **MCQ.** What is the single operation an LLM performs?
   - A. Looking up facts in a curated medical database
   - B. Predicting what text comes next, given the text so far ✓
   - C. Searching the internet and summarizing results
   - D. Matching your question to previously asked questions
   - *Explanation: Everything an LLM does, drafting, summarizing, reasoning, is built out of next-text prediction. It has no internal database of verified facts.*

3. **True/false with why.** "An LLM checks its statements against a database of verified facts before answering."
   - False. ✓ *There is no internal fact-checker. Output is plausible text continuation, which is why verification stays with you (Module 5).*

4. **MCQ.** Why is "autocomplete on steroids" misleading, even though it is technically accurate?
   - A. LLMs do not actually predict text
   - B. Predicting text well at massive scale required internalizing structure (logic, formats, domain patterns) that produces genuinely useful professional work ✓
   - C. LLMs use a completely different mechanism than autocomplete
   - D. It undersells the accuracy of LLM facts
   - *Explanation: The mechanism is prediction, but the capability that emerged from doing it at scale is what makes the tools valuable. It does not make the facts reliable; that is a separate issue.*

5. **Spot the problem.** A colleague says: "I asked ChatGPT for the reference for that ovarian reserve study and it gave me the full citation, so I put it in my slide deck." What is the problem?
   - A. ChatGPT cannot output citations in the right format
   - B. The citation was generated as plausible text, not retrieved from a database, so it may not exist; it must be verified before use ✓
   - C. Slide decks should not contain citations
   - D. They should have asked Claude instead
   - *Explanation: Generated citations look perfect and are frequently fabricated. Module 5 covers this failure mode in depth; the fix is always independent verification.*

## Scenario

**Setup.** At a conference dinner, a colleague tells you: "Our practice bought an AI product. It reads incoming patient messages and drafts replies, and it also predicts which patients are likely to miss appointments. I do not trust any of it; it is all just ChatGPT."

**Task.** Before revealing the model answer, write two or three sentences: what would you say to sort out what is actually going on in that product, and is "it is all just ChatGPT" accurate?

**Model answer.** The product almost certainly contains two different kinds of AI. The no-show prediction is classification-style machine learning: patterns from historical scheduling data, nothing generative about it. The message-reply drafting is generative, likely an LLM, possibly the same family of technology as ChatGPT. Lumping them together makes it impossible to evaluate either one sensibly. The right questions differ: for the predictor, what data was it trained on and how accurate is it on patients like ours; for the drafting tool, who reviews the drafts before they reach patients, and what happens to message content (a privacy question Module 8 takes up directly). Distrusting "AI" as one blob and trusting it as one blob are the same mistake.

## Flashcards (4)

| Front | Back |
|---|---|
| Artificial intelligence (AI) | Umbrella term for software performing tasks associated with human intelligence: pattern recognition, language, prediction. Not one technology. *Why you care: vendor claims of "AI" tell you almost nothing until you ask which kind.* |
| Machine learning | Building software from millions of examples instead of explicit rules; the system finds the patterns itself. *Why you care: the system is only as good as its examples, and it does not know when it is out of its depth.* |
| Generative AI | AI that produces new content (text, images, audio) rather than classifying existing data. *Why you care: this is the kind you drive directly, so your skill determines its value.* |
| Large language model (LLM) | Generative AI trained on massive text to predict what comes next. ChatGPT, Claude, Gemini. *Why you care: it generates plausible text rather than retrieving verified facts, which defines both its power and its risks.* |
