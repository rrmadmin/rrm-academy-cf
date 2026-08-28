# Module 2: How an LLM Works (No Math)

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: pretraining, fine-tuning, RLHF (human feedback training). Uses: LLM, machine learning, generative AI (Module 1).

## Orientation

By the end of this module you will be able to describe how an LLM is made, in three stages, without any math, and explain the most consequential fact about these systems: there is no database inside. Three terms enter your vocabulary. If you understand this module, the strengths and failures you will see in every later module stop being mysterious.

## Lesson

### Three stages, one useful analogy

An LLM is made in stages, and a medical-training analogy holds up surprisingly well: medical school, then residency, then attendings correcting you until your judgment is calibrated.

### Stage 1: Pretraining, the medical school

**Pretraining** is where the "large" in large language model comes from. The system is fed a vast amount of text: a filtered slice of the public internet, digitized books, reference works, scientific articles, code. The training task is the one from Module 1: over and over, trillions of times, predict the next word, check against the actual next word, adjust, repeat.

Nobody teaches it grammar, anatomy, or the structure of a SOAP note. All of it is absorbed as a side effect of getting better at prediction across everything humans have written. This stage takes months on warehouse-scale computing and costs the companies hundreds of millions of dollars, which is why only a handful of organizations make frontier models.

Two properties of your future tool are set here, and both matter clinically:

**First, it learned from everything, weighted by volume.** Peer-reviewed literature went in, and so did patient forums, marketing copy, and outdated textbooks. The model absorbed the mainstream view of every topic in proportion to how often it appears in text, not in proportion to how correct it is. On topics where the published mainstream and your clinical framework differ, and in restorative reproductive medicine you know exactly which topics those are, expect the model's default answer to reflect the majority literature, not the strongest evidence. It is a mirror of what was written, not a judge of what is true.

**Second, the learning stopped on a date.** Training data was collected up to a cutoff, then training ran, then the model shipped. Out of the box, it knows nothing after that date: no new trials, no new guidelines, no drug approvals. Module 3 gives this a name (knowledge cutoff) and Module 6 shows the workaround (letting the model search the web).

> **Term: Pretraining.** The first, massive stage of building an LLM: learning next-word prediction across an enormous text corpus. Everything the model "knows" by default was absorbed here, frozen at a cutoff date.

### Stage 2: Fine-tuning, the residency

A model fresh out of pretraining is a raw prediction engine. Ask it a question and it might just continue with more questions, because on the internet, questions often follow questions. It has enormous capability and no manners.

**Fine-tuning** shapes that raw engine into an assistant. The model is trained further on a much smaller, curated set of examples of good behavior: here is a question, here is what a helpful, well-formatted answer looks like. Thousands of examples of following instructions, answering in the asked-for format, declining harmful requests.

> **Term: Fine-tuning.** A second, smaller training stage on curated examples that turns a raw prediction engine into an instruction-following assistant.

### Stage 3: Human feedback, the attending's red pen

The final stage, **RLHF** (reinforcement learning from human feedback), calibrates judgment. The model generates multiple answers to the same prompt; human reviewers rank them; the model is adjusted toward what people prefer. Repeat at scale.

This is why ChatGPT and Claude feel polite, structured, and eager to help. It is also the origin of a failure mode you should know by name: **models are trained toward answers people rate highly, and people rate confident, complete, agreeable answers highly.** A model that says "I am not sure" less often than it should, or that warms to your framing instead of challenging it, is doing exactly what its training rewarded. Keep this in mind when you use AI as a second opinion; Course 3 teaches how to prompt around it.

> **Term: RLHF (human feedback training).** The final training stage: humans rank the model's answers and the model is adjusted toward preferred ones. Source of the polished assistant behavior, and of the bias toward confident, agreeable answers.

### The most important sentence in this course

After all three stages, here is what shipped: **a single, frozen mathematical object that turns text into a prediction of the next word. There is no database inside.**

Everything the model absorbed in training is stored the way your knowledge of a language is stored in you: as dispositions, not as files. You cannot open the model and find the sentence it learned about clomiphene, and neither can its makers. When it tells you something, it is not quoting a record; it is reconstructing plausible text from patterns.

Consequences you will meet again and again:

- It can be wrong fluently, in perfect professional prose, because fluency and accuracy come from the same process (Module 5).
- It cannot tell you where in its training a claim came from. Ask for its source and it will generate a plausible-looking one, which is not at all the same thing (Module 5).
- It does not update. New knowledge arrives only through a new model version or through text you put in front of it (Modules 3, 4, and 6).
- It genuinely excels at transformation: summarizing, rewriting, restructuring, translating registers. When the source material is in front of it, the prediction task is anchored by that material, which is why Course 2 leans so heavily on "give it the document."

### Try it

Ask the same model, in two separate conversations: "What causes unexplained infertility?" and then "A patient labeled with unexplained infertility asks whether that label means no cause exists or no cause was found. What is the honest answer?" Notice how much the framing of your question steers which patterns the model draws on. That steering is a preview of Module 4 and all of Course 2.

## Demo script (3-5 min)

1. Open Claude. "Let me show you what training actually left behind." Prompt: "Complete this sentence the way a 1990s textbook would, then the way a patient forum post would: 'Painful periods are...'" Show both. "Both registers came from pretraining. It absorbed everything, and your prompt chooses which patterns surface."
2. Prompt: "What is the most recent development you know about in fertility medicine, and what is your knowledge cutoff?" Show the answer. "Frozen on a date. Whatever happened since, it does not know."
3. Prompt: "Where exactly did you learn that? Quote your training source." Show the model's response. "It cannot actually do this. Whatever it produces here is generated, not retrieved. Remember this moment in Module 5."
4. Close: "Prediction engine, shaped into an assistant, judged by human preference, frozen. No database. That is the machine."

## Quiz (5 questions)

1. **MCQ.** During which stage does an LLM absorb virtually all of its knowledge?
   - A. Pretraining ✓
   - B. Fine-tuning
   - C. RLHF
   - D. Continuously, as people use it
   - *Explanation: Pretraining on the massive corpus is where knowledge is absorbed. Later stages shape behavior, and usage does not update the model at all.*

2. **True/false with why.** "When an LLM answers a clinical question, it retrieves the answer from a stored copy of its training documents."
   - False. ✓ *No database exists inside. Knowledge is stored as prediction dispositions; every answer is reconstructed, which is why fluent errors are possible.*

3. **MCQ.** Your model gives a polished, confident, slightly wrong answer and agrees readily when you push back. Which training stage most directly explains the confidence and agreeableness?
   - A. Pretraining
   - B. Fine-tuning
   - C. RLHF: humans rated confident, agreeable answers highly ✓
   - D. The knowledge cutoff
   - *Explanation: Human-preference training rewards what people like to read, and people like confidence and agreement more than calibrated uncertainty.*

4. **MCQ.** On a topic where the majority of published literature and a minority evidence-based framework disagree, what should you expect an LLM's default answer to reflect?
   - A. The strongest evidence, because training identifies truth
   - B. The majority view, in proportion to its volume in the training text ✓
   - C. A balanced synthesis it derived independently
   - D. Refusal to answer contested topics
   - *Explanation: Pretraining mirrors the corpus. Volume, not validity, sets the default. Steering it toward specific evidence is a skill taught in Course 2.*

5. **Spot the problem.** A practice administrator says: "We have been using the same chatbot for a year, and it has learned so much about our practice from all our conversations."
   - A. Nothing wrong; models learn continuously from use
   - B. The model is frozen and learns nothing between versions; anything it "remembers" comes from text being put back in front of it, not from the model updating ✓
   - C. The model learned, but only during RLHF
   - D. Chatbots cannot be used for a year
   - *Explanation: Deployed models do not train on your conversations in real time. Apparent memory is separate machinery (saved context and memory features, Modules 4 and Course 3), not a changed model.*

## Scenario

**Setup.** A patient brings you a printout of a ChatGPT conversation. She asked it about a supplement protocol for egg quality, and the answer is fluent, referenced with two citations, and confidently states a mainstream position you know is weakly supported, while omitting an approach with better evidence that is less commonly published.

**Task.** Using only what this module taught about how the model was built, write three or four sentences explaining to the patient, without dismissing her, why the answer looks the way it does.

**Model answer.** Something like: "This tool learned from an enormous amount of text, so its default answer is the most-published view, weighted by how often it appears, not by how strong the evidence is. Approaches that are newer or less written about are underrepresented in its answers even when the evidence behind them is good. It also writes with the same confidence whether it is right or wrong, because it was trained toward answers people find satisfying to read, and those citations need to be checked before we trust them, since it generates reference text rather than looking references up. It is a genuinely useful starting point, and you were right to bring it in; now let us look at what the evidence actually shows for your situation." The key moves: explain volume-weighting, name the confidence bias, flag citation verification, keep the patient engaged rather than embarrassed.

## Flashcards (3)

| Front | Back |
|---|---|
| Pretraining | The massive first training stage: next-word prediction over a huge text corpus. All default knowledge comes from here, frozen at a cutoff. *Why you care: default answers mirror publication volume, not evidence strength, and know nothing past the cutoff.* |
| Fine-tuning | Smaller second stage on curated examples that turns the raw predictor into an instruction-following assistant. *Why you care: explains why the tool follows formats and instructions at all.* |
| RLHF (human feedback training) | Final stage: humans rank answers, model shifts toward preferred ones. *Why you care: source of the confident, agreeable tone, including when the content is wrong.* |
