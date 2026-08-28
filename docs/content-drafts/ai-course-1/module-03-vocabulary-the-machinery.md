# Module 3: The Vocabulary, Part 1: The Machinery

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: model, parameters/weights, training data, knowledge cutoff, inference, GPU/compute. Uses: LLM, pretraining, fine-tuning, RLHF (Modules 1-2).

## Orientation

By the end of this module you will own the six words that describe the machinery itself: model, parameters, training data, knowledge cutoff, inference, and compute. These are the words in every product announcement, every vendor pitch, and every "GPT-5 versus Claude" headline. After this module, those sentences parse.

## Lesson

### Model: the artifact itself

The word **model** names the thing all that training produced: one specific, frozen artifact. GPT-5 is a model. Claude is a family of models. When a company "releases a new model," they ran the training process again, bigger or better, and shipped the new artifact.

Two clinical-world analogies help. A model version is like a drug formulation: "the chatbot" is not one thing over time, and behavior can change meaningfully between versions, which is why "AI said X" means little without knowing which model and when. And model families have tiers, like imaging modalities: the same company ships a fast, cheap model and a slower, more capable one. Module 7 maps the current tiers; here, just fix the word: a model is a specific frozen artifact with a name and a version.

> **Term: Model.** The specific, frozen artifact produced by training, with a name and version. Behavior differs between models and between versions of the same product.

### Parameters and weights: where the learning lives

Inside a model, what actually changed during those months of training? Billions of numbers. Each is called a **parameter** or a **weight** (the terms are interchangeable), and each one nudges the prediction a tiny amount. Learning, in these systems, is nothing more than adjusting these numbers until predictions get good.

The count is the headline spec: frontier models have hundreds of billions to trillions of parameters. More parameters generally means more capacity to absorb patterns, the way more neurons support more complexity, though the relationship is loose and training quality matters as much as size. What you should take from the number is scale, not precision: the "knowledge" from Module 2 is smeared across billions of numbers, which is exactly why there is no database inside and no way to point at where a fact lives.

> **Term: Parameters (weights).** The billions of adjustable numbers inside a model where all learning is stored. More parameters roughly means more capacity, loosely.

### Training data: the diet

**Training data** is the corpus everything in Module 2 was learned from. The phrase to remember: the model is what it ate. Strengths and blind spots trace back to the diet. English medical content is abundant, so the model is strong there. Recent content past the cutoff is absent. Paywalled journals are underrepresented compared to abstracts and press coverage of them, which should adjust your expectations about how deeply the model knows a study versus its headline finding.

Vendors do not fully disclose training data, and you cannot audit it. What you can do is reason about it: for any topic, ask "what does the internet mostly say about this?" and expect the model's default to sit there.

> **Term: Training data.** The text corpus a model learned from. The model is what it ate: abundance in the corpus becomes fluency; absence becomes a blind spot.

### Knowledge cutoff: the frozen calendar

Module 2 showed that learning stops on a date. That date is the **knowledge cutoff**, and it is a published spec of each model, typically 6 to 18 months before you are using it.

Clinical habits to build now: anything time-sensitive, new trials, guideline updates, drug availability, anything with a date, is outside the model's native competence. Either the model must look it up live (web search, Module 6) or you must supply the current material yourself (Course 2). The dangerous case is not the model saying "I do not know about that"; it is the model answering from the old world without flagging it. It will describe the guideline as current because, in its frozen corpus, it was.

> **Term: Knowledge cutoff.** The date a model's training data ends. It knows nothing after it natively, and will not always warn you.

### Inference: the model at work

Training happens once, at the factory. **Inference** is everything after: the model running, turning your prompt into a response. Every chat message you send triggers inference.

Why give this a name? Because the two phases have completely different properties, and confusing them causes real misunderstandings. Training is slow, astronomically expensive, and changes the model. Inference is fast, cheap per use, and changes nothing: the model is identical before and after your conversation. When Module 2's quiz said the chatbot "learned so much about our practice" was wrong, this is the vocabulary for why: use is inference, and inference does not write anything back into the weights.

> **Term: Inference.** The model in use: producing responses from your input. Fast, cheap, and changes nothing inside the model.

### Compute and GPUs: why this all costs billions

The hardware behind both phases is the **GPU**, the graphics processing unit, a chip originally built for video games that happens to be ideal for the arithmetic neural networks need. **Compute** is the general term for this processing capacity. Frontier training runs use tens of thousands of GPUs for months; that, plus the electricity, is the moat that limits frontier models to a handful of companies, and it is what headlines about "AI infrastructure" and chip export politics are about.

For you, compute mostly surfaces in one practical place: pricing and tiers. Bigger models burn more compute per answer, which is why the most capable models sit behind paid plans and why vendors ship cheaper, faster tiers alongside them. When Module 7 compares subscription tiers, "how much compute per answer" is the invisible variable underneath.

> **Term: GPU / compute.** The specialized chips (GPUs) and processing capacity (compute) AI runs on. Training consumes vast compute; inference consumes a little per answer. Explains cost, tiers, and why few companies make frontier models.

### The sentence that uses all six

You can now parse a typical announcement: "Our new model, trained on an expanded dataset with a March 2026 knowledge cutoff, uses its larger parameter count to deliver better answers, with faster inference on our new GPU clusters." Every clause of that sentence is now yours.

### Try it

Find one real AI headline or product page this week and identify which of the six terms each claim is about. Two minutes; it will demonstrate to you that the fog has lifted.

## Demo script (2-4 min)

1. Open the model picker in ChatGPT and in Claude. "These are models: named, versioned artifacts. Notice each product offers several tiers."
2. Ask the model: "What is your knowledge cutoff? Answer in one sentence." Show it. "A published spec, not a secret. Everything after this date does not exist for it natively."
3. Ask: "In one paragraph for a medical professional: why does using you not teach you anything?" Show the answer. "Training versus inference, in the model's own words. Your conversations do not change the weights."
4. Close over a shot of a GPU cluster photo or a news headline: "This vocabulary, model, parameters, training data, cutoff, inference, compute, is the whole machinery. Next module: the vocabulary of the conversation, where your actual skill begins."

## Quiz (5 questions)

1. **MCQ.** "GPT-5" and "Claude" name:
   - A. Companies
   - B. Specific frozen model artifacts (or families of them) with versions ✓
   - C. Databases of medical knowledge
   - D. Search engines
   - *Explanation: These are models: trained artifacts with names and versions, whose behavior can change between versions.*

2. **MCQ.** Where is a model's learned knowledge physically stored?
   - A. In a searchable database of training documents
   - B. Distributed across billions of parameters (weights) ✓
   - C. In a file of memorized facts, one per topic
   - D. On the internet, accessed live
   - *Explanation: Learning is the adjustment of billions of numbers. Knowledge is smeared across them, which is why no fact can be located or cited from inside.*

3. **True/false with why.** "If a treatment guideline changed two months ago, a model with a cutoff from last year will usually warn you its information may be outdated when you ask about that guideline."
   - False. ✓ *The model answers from its frozen corpus, where the old guideline was current, and typically presents it as current. The burden of checking recency is on you or on a live web search.*

4. **MCQ.** Training is to inference as:
   - A. Fast is to slow
   - B. Building the tool is to using the tool ✓
   - C. Free is to expensive
   - D. Reading is to writing
   - *Explanation: Training builds and changes the model once; inference is every subsequent use, which changes nothing inside it.*

5. **Spot the problem.** A vendor pitch says: "Our medical AI continuously learns from every doctor's queries, getting smarter each day, with no knowledge cutoff."
   - A. Nothing suspicious; this is how LLMs work
   - B. The claim conflicts with how models actually work: deployed models are frozen between versions, and use (inference) does not update weights; either the claim is marketing overstatement or it describes something needing scrutiny about what happens to your query data ✓
   - C. The only problem is the missing parameter count
   - D. Continuous learning is impossible in software
   - *Explanation: Real-time learning from user queries is not how deployed LLMs work; and a system genuinely ingesting doctors' queries raises exactly the data-handling questions Module 8 teaches you to ask.*

## Scenario

**Setup.** Your practice is evaluating two AI documentation products. Vendor A: "Powered by a frontier model with over a trillion parameters." Vendor B: "Powered by a smaller model fine-tuned specifically on medical documentation." A colleague concludes Vendor A must be better because the model is bigger.

**Task.** Using this module's vocabulary, write three or four sentences assessing the colleague's reasoning and listing what you would actually want to know.

**Model answer.** Parameter count is capacity, not a quality guarantee; the relationship is loose, and training data and fine-tuning matter as much as size. Vendor B's smaller model, fine-tuned on documentation, could easily beat a giant general model at this specific task. The questions that actually discriminate: what data was each fine-tuned on, what are the knowledge cutoffs and how do updates ship (new model versions), how does each perform on notes like ours in a real trial, and, ahead of Module 8, what happens to our note content at inference time: is it stored, and is it used for anyone's training? "Bigger model" alone answers none of these.

## Flashcards (6)

| Front | Back |
|---|---|
| Model | The specific frozen artifact training produces, with a name and version (GPT-5, Claude). *Why you care: behavior changes between versions; "AI said X" is meaningless without which model, when.* |
| Parameters (weights) | The billions of adjustable numbers where a model's learning is stored. *Why you care: knowledge is smeared across them, so nothing inside can be looked up or cited; size means capacity, loosely, not quality.* |
| Training data | The corpus the model learned from; the model is what it ate. *Why you care: publication volume in the corpus, not evidence strength, sets default answers; gaps in the diet are blind spots.* |
| Knowledge cutoff | The date training data ends; the model natively knows nothing after it. *Why you care: it presents its frozen world as current; recency checking is on you or on live search.* |
| Inference | The model in use, producing answers; changes nothing inside the model. *Why you care: your conversations never train the model in real time; apparent memory is other machinery.* |
| GPU / compute | The chips and processing capacity AI runs on. *Why you care: explains pricing tiers, why capable models cost more, and why frontier models come from few companies.* |
