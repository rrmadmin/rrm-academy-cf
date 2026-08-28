# Module 4: The Patient Data Rule

AI Essentials for the Busy Clinician. Byline: Brian Whittaker. Status: DRAFT v2 (lightened) for Brian review.
Terms: PHI, de-identify, BAA. Length target: 7 minutes.

EDITORIAL NOTE: safe-practice framing, not legal advice; say so to the learner.

## Orientation

One rule, one skill, one contract question. This is the module that lets your practice use AI without lying awake at night. Safe practice, not legal advice.

## Lesson

### The rule

**Patient information never goes into ChatGPT, Claude, Gemini, or any everyday AI tool. No exceptions.**

The moment you press enter, that text is on an outside company's servers under an ordinary consumer contract. Deleting the chat does not un-send it. The rule is absolute on purpose: bright lines survive busy days.

> **Term: PHI.** Health information connected to an identifiable person. Combinations count: a rare condition plus a small town plus an age identifies someone with no name attached.

### What counts as identifying

Names, birth dates, record numbers, photos, voice recordings, obviously. But also combinations: "a 41-year-old teacher in [small town] with [rare condition] seen Tuesday" identifies a person. When in doubt, it is identifying.

### The skill: de-identify, then use freely

Nearly everything AI does well works just as well on an anonymous version. Three moves:

1. **Strip** names, dates, places, numbers.
2. **Generalize**: exact age becomes "late 30s," the town disappears.
3. **Reread as a neighbor**: could someone who knows her recognize her here? If maybe, blur more or do not send.

Then use it freely: *"Draft the questions a woman in her late 30s with recurrent early miscarriage will likely ask, with plain-language answers I can adapt."* Everything useful survived. Nobody is findable.

> **Term: De-identify.** Strip, generalize, reread as a neighbor. Keeps AI's clinical usefulness inside the rule.

### The contract question: BAA

Real patient data can flow to an AI product under exactly one arrangement: a signed **BAA**, the healthcare contract where the vendor accepts legal responsibility for patient data. That is what makes legitimate scribes and EHR AI possible. Three things to remember:

- "HIPAA-compliant" on a website is marketing. A signed BAA in your files is the fact. Ask "where is our signed BAA?" before go-live.
- A BAA covers that product only. Never anyone's personal ChatGPT.
- A BAA covers data, not quality. The scribe's notes still get clinician review, every note.

> **Term: BAA.** The signed contract that permits one specific product to handle patient data. Verify it exists; it never replaces review.

### The three lanes, on one card

- **Everyday AI:** business writing + de-identified clinical thinking. Never identified patients.
- **BAA-covered products:** identified data, that product's job only, with review.
- **Neither fits?** No AI for that task. "No" is a complete sentence, even at 6pm.

## Demo script (2-3 min)

1. The rule on screen, spoken once. "Here is what that leaves, which is almost everything."
2. Live de-identify of a synthetic vignette: strip, generalize, neighbor test. Send, show the output. "Nothing useful was lost."
3. The 6pm temptation: portal message, cursor over paste. Stop. De-identified one-liner instead, same reply drafted. "Same two minutes. Zero disclosure."

## Quiz (3 questions)

1. **MCQ.** Which may go into an everyday AI tool?
   - A. A portal message, name deleted, rare diagnosis + town + date intact
   - B. "Draft counseling points for a woman in her late 30s with recurrent early miscarriage" ✓
   - C. A photo of a completed intake form
   - D. Visit audio, if you delete the chat after
   - *Only B passes the neighbor test. Deletion undoes nothing.*

2. **True/false.** "Our scribe vendor advertises HIPAA compliance, so we are covered."
   - False. ✓ *Marketing is not a contract. The fact is a signed BAA in your files.*

3. **Spot the problem.** At 6pm, a staff member pastes a patient's message thread into personal ChatGPT "just to draft a reply; I will delete it after."
   - A. Acceptable; replies are low-stakes
   - B. Disclosure happened at paste; a de-identified one-line summary would have produced the same draft ✓
   - C. Only issue is the personal account
   - D. Fine with training toggled off
   - *The exact moment the bright line exists for.*

## Scenario

**Setup.** Your manager proposes: everyday AI for business writing, de-identified vignettes for clinical thinking, the new scribe for real patient data "since the vendor says they are HIPAA-compliant."

**Model answer.** "The three lanes are exactly right. One fix: before the scribe goes live, get the signed BAA into our files, marketing claims are not contracts. And that BAA covers the scribe only, so any future patient-data AI needs its own agreement first."

## Flashcards (3)

| Front | Back |
|---|---|
| PHI | Health info connected to an identifiable person; combinations of ordinary details count. *Never enters everyday AI tools.* |
| De-identify | Strip, generalize, reread as a neighbor. *Keeps AI's clinical value inside the rule.* |
| BAA | The signed contract permitting one product to handle patient data. *Ask "where is our signed BAA?" It never replaces review.* |
