# Module 8: The PHI Line

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: PHI (in the AI context), de-identification, BAA, training on your data. Uses: context, inference, training data, model tier, ambient scribe (Modules 2-7).

EDITORIAL NOTE: this module states rules of practice, not legal advice, and says so to the learner. Keep the framing "how to stay clearly safe," not "what the law permits at the margin."

## Orientation

This is the module the whole course has been pointing at. By the end you will have one bright-line rule you never break, a working ability to de-identify, an accurate understanding of what a BAA does and does not change, and the questions that determine whether any AI product is fit for patient data. Everything here is stated as safe practice for a clinical professional, not as legal advice; your obligations under HIPAA and your state's law are your own counsel's domain.

## Lesson

### The bright line, stated once

**Patient information never goes into a consumer AI tool. No exceptions, no "just this once," no partial versions of the rule.**

Consumer means the tools you have been using in this course on individual plans: ChatGPT, Claude, Gemini, and their peers, as ordinarily subscribed. The rest of this module builds the understanding around the rule, teaches the workaround that preserves nearly all of AI's value (de-identification), and explains what kind of arrangement changes the answer (a BAA). But the rule itself is the takeaway, and it is deliberately absolute: bright lines hold under time pressure; judgment calls erode.

### What counts: PHI, thought about properly

**PHI**, protected health information, is health information connected to an identifiable person. The regulatory definition enumerates 18 identifier categories; you do not need to recite them, you need the concept: **identifiability plus health context.** Name, date of birth, MRN, address, phone, email, photograph, obviously. But also the combinations that identify without any single identifier: a rare condition plus a small town; an age, procedure, and date together; "my 3pm Tuesday patient." A detail-rich clinical story can be identifiable with every formal identifier stripped, and in a community the size of many RRM practices, re-identification is easier than it feels.

Two immediate corollaries. First, faces and voices: a patient photograph or exam-room audio is patient data, which is why Module 6 flagged casual vision use and Module 7 pressed the scribe audio question. Second, adjacent-but-not-PHI data: your practice's finances, unpublished research, staff issues. Not PHI, but not material for a consumer tool on default terms either; the same data-handling logic applies at lower stakes.

> **Term: PHI (protected health information).** Health information connected to an identifiable person, where identifiability includes combinations of details, not just formal identifiers. In this course's usage: the category of data that never enters a consumer AI tool.

### Why the rule is absolute: where your words go

You now know enough machinery for the real explanation rather than a scary slogan. When you type into a consumer AI tool, your text is processed on the vendor's servers (inference, Module 3): it has left your control the moment you press enter. It may be retained in chat history and vendor logs under a consumer contract with no healthcare obligations. And on many consumer plans, conversations may be used for **training on your data**: your text becoming training data (Module 2) for future models, with settings and policies that vary by vendor and change over time.

> **Term: Training on your data.** The vendor using your conversations as training data for future models. Common on consumer plans (settings vary), typically excluded by contract on business plans. One of the two questions that define an AI product's data posture, alongside retention.

Here is the module's most important reframe: **the training question, though it gets the headlines, is not the load-bearing issue. Disclosure is.** Sending PHI to a third party without authorization or a business associate relationship is the problem, and it is complete at the moment of sending, whatever the vendor does or does not do with the text afterward. Opting out of training does not un-send anything. That is why the line is bright: it sits at the point of transmission, the one point you fully control.

### De-identification: the workaround that preserves the value

Here is the liberating half. Nearly everything AI does well for a clinician, drafting, summarizing, reframing, explaining, works exactly as well on a de-identified version of the situation. **De-identification** for daily AI use means removing every identifier and blurring every identifying particular until the person is not findable in what remains.

The working method, three moves:

1. **Strip** all direct identifiers: names, dates, locations, numbers, institutions.
2. **Generalize** the quasi-identifiers: exact ages become ranges ("late 30s"), specific dates become relative time ("for three years"), places disappear or become regions, and rare identifying details get blurred a notch ("a rare autoimmune condition" rather than its name, when the name plus context could identify).
3. **Reread as an adversary**: could someone who knows this patient recognize her here? In a small community, with an uncommon story? If yes, blur further or do not send.

The clinical usefulness survives almost untouched: "Draft patient-education points for a woman in her late 30s with recurrent early miscarriage and a luteal phase concern" carries everything the model needs and nothing that identifies anyone. This pattern, the abstracted clinical vignette, is the single most useful construction in this module, and Course 2 uses it constantly.

One honest caution: de-identification is a skill with a failure mode (under-blurring rich narratives), which is why the adversarial reread is a mandatory step and why, when in doubt, you abstract harder. The templates in Course 2 are pre-built PHI-free for exactly this reason.

> **Term: De-identification.** Removing identifiers and generalizing identifying particulars until the person is not findable in what remains: strip, generalize, reread as an adversary. The skill that lets consumer AI serve clinical thinking safely.

### The BAA: what changes and what does not

A **BAA**, business associate agreement, is the HIPAA contract under which a vendor may handle PHI on a practice's behalf, accepting safeguard obligations, breach duties, and use restrictions. This is the arrangement behind legitimate healthcare AI: ambient scribes sold to practices, EHR-integrated AI, and the enterprise healthcare offerings of the major labs can all be operated under BAAs. A BAA is what "changes the answer" from Module 7's data-terms discussion.

What a BAA changes: PHI may lawfully flow to that vendor for the contracted service, under contractual safeguards.

What a BAA does not change, each worth saying explicitly:

- **It attaches to the specific contracted service, not the company.** A BAA covering your scribe does not cover an employee's personal ChatGPT account, even if the same lab is behind both.
- **It is not a quality certificate.** Module 5 and 7's questions, hallucination, review workflow, transcript fidelity, are untouched by the data contract.
- **It is not a substitute for minimum-necessary judgment** about what you send.
- **Its existence must be verified, not assumed.** "HIPAA-compliant" on a marketing page is a claim; the practice signing an actual BAA is the fact. Whoever signs contracts in your practice holds that thread.

> **Term: BAA (business associate agreement).** The contract under which a vendor may handle PHI for a practice, with safeguard and breach obligations. Changes where PHI may flow; changes nothing about output quality or your review duties; covers the contracted service only; verify, never assume.

### The decision in practice, and saying no

Compress the module to a pocket algorithm. **Does this involve patient data?** No: proceed (business data still deserves business-grade terms). Yes: **can it be genuinely de-identified?** Yes: de-identify properly and use the consumer tool. No, the identified data itself must be processed: **only inside a BAA-covered, practice-sanctioned product**, and if none exists for the task, the answer is no, and saying that no, to a vendor, to a workflow shortcut, to your own time pressure at 6pm with charts open, is a professional competency this course expects of you. The pressure to paste the message thread "just to draft a reply" will come; the bright line exists for exactly that moment. Every exercise in this course and the next two is built PHI-free by design, so the safe path is also the practiced path.

### Try it

Take a (real, recent, in-your-head) patient situation and write the de-identified vignette: strip, generalize, adversarial reread. Then check it against the standard: would the model lose anything it needs? Would her sister recognize her? This drill, done three times, installs the skill for good.

## Demo script (4-5 min)

1. Text on screen, spoken plainly: "Patient information never goes into a consumer AI tool. That is the rule. The next four minutes explain it; nothing will soften it."
2. Identified vignette (synthetic) on the left; live de-identification on the right: strip, generalize, reread. "Watch what the model needs survive, and what identifies vanish."
3. Send the de-identified vignette to a consumer model: "Draft counseling points." Show the excellent output. "Nothing of value was lost. This is the pattern for everything clinical in Course 2."
4. Show a consumer plan's data-controls screen briefly: "Training toggles exist and vary. But the load-bearing issue is disclosure: sending is the event. That is why the line sits where it sits."
5. Close: "De-identify for thinking work in consumer tools. BAA-covered products, verified by contract not marketing, for anything identified. And 'no AI for this task' is a complete sentence. Next module: hands on, accounts, and your first real conversations."

## Quiz (5 questions)

1. **MCQ.** The bright-line rule of this module is:
   - A. Patient data may enter consumer AI tools if training is toggled off
   - B. Patient information never goes into a consumer AI tool ✓
   - C. Patient data is fine in consumer tools on paid plans
   - D. AI may never be used near clinical work
   - *Explanation: The line sits at transmission to consumer tools, absolutely. De-identified vignettes and BAA-covered products are the two lawful paths to AI's clinical value.*

2. **MCQ.** A note contains no name, DOB, or MRN, but describes "a 41-year-old teacher in [small town] with [rare condition] seen last Tuesday." Its PHI status:
   - A. Not PHI; formal identifiers are absent
   - B. Effectively identifiable: combined quasi-identifiers can single a person out, especially in small communities ✓
   - C. PHI only if a photo is attached
   - D. Depends on the AI tool used
   - *Explanation: Identifiability includes combinations. This is precisely what the generalize-and-adversarial-reread steps of de-identification exist to catch.*

3. **True/false with why.** "Opting out of model training on a consumer plan makes it acceptable to paste identified patient information into the tool."
   - False. ✓ *Disclosure to an outside party without authorization or a BAA is the core problem and is complete at sending. Training settings modify one downstream use, not the transmission itself.*

4. **MCQ.** Your practice's ambient scribe vendor operates under a signed BAA. Which statement is correct?
   - A. Anything the practice sends any of that company's products is now covered
   - B. The scribe's notes no longer need clinician review
   - C. PHI may flow to the contracted scribe service; review duties, quality questions, and minimum-necessary judgment are unchanged, and coverage is service-specific ✓
   - D. The practice is now HIPAA-compliant in all AI use
   - *Explanation: A BAA changes where PHI may lawfully flow, for that service. It certifies nothing about quality and extends to no other product or account.*

5. **Spot the problem.** At 6pm, a colleague pastes a patient's full portal message thread, name visible, into personal ChatGPT "just to draft a kind reply faster; I will delete the chat after."
   - A. Acceptable: drafting replies is a low-stakes use
   - B. The disclosure happened at paste; deleting the chat afterward undoes nothing, and the same drafting value was available from a de-identified summary of the message ✓
   - C. The only problem is using a personal account instead of a work one
   - D. Acceptable if training was toggled off
   - *Explanation: The exact 6pm scenario the bright line exists for. The de-identified vignette ("draft a warm reply to a patient anxious about X after normal results") would have produced the same draft with zero disclosure.*

## Scenario

**Setup.** Your practice manager, excited after this course, proposes: "Let us use consumer ChatGPT for everything nonclinical, de-identified vignettes for clinical thinking, and route real patient-data tasks through the scribe since its vendor is HIPAA-compliant. I saw the compliance badge on their site."

**Task.** The proposal is 90% right. In three or four sentences, affirm the structure and fix the two weak joints.

**Model answer.** The three-lane structure is exactly right: consumer tools for nonclinical and properly de-identified work, BAA-covered products for identified data. Two fixes. First, "HIPAA-compliant" on a website is marketing; the question is whether we hold a signed BAA covering the specific scribe service, so ask who countersigned it and file it where clinicians can point to it. Second, the scribe's BAA covers the scribe: it does not authorize routing other patient-data tasks, portal messages, records summaries, through any other product from any vendor, so any new identified-data use case needs its own covered product before it starts. With those two joints tightened, adopt the proposal, and put the de-identification drill from this module into onboarding so the middle lane stays safe in practice.

## Flashcards (4)

| Front | Back |
|---|---|
| PHI (protected health information) | Health information connected to an identifiable person, including identifying combinations of details, not just formal identifiers. *Why you care: the category that never enters a consumer AI tool; rich clinical stories can identify with every identifier stripped.* |
| De-identification | Strip identifiers, generalize particulars, reread as an adversary, until the person is not findable. *Why you care: preserves nearly all of AI's clinical thinking value inside the bright line; the abstracted vignette is Course 2's workhorse.* |
| BAA (business associate agreement) | The contract letting a vendor handle PHI for a practice, with safeguard and breach obligations. *Why you care: the only arrangement under which identified data may flow to an AI product; service-specific, verify by contract, changes nothing about review duties.* |
| Training on your data | The vendor using your conversations to train future models; common on consumer plans, contractually excluded on business plans. *Why you care: worth controlling everywhere, but disclosure at the moment of sending, not training, is why the PHI line is absolute.* |
