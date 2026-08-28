# Module 4: The Vocabulary, Part 2: The Conversation

Course 1: AI Foundations for the Restorative Clinician. Byline: Brian Whittaker. Status: DRAFT for Brian review.
Terms introduced: prompt, token, context, context window, system prompt, temperature/randomness, output/completion. Uses: model, inference, LLM (Modules 1-3).

## Orientation

Module 3 gave you the vocabulary of the machine. This module gives you the vocabulary of the conversation: the seven words that describe what happens every time you type to a model. Two of them, token and context window, explain the strangest behaviors you will ever see from these tools, including why a long chat slowly gets dumber and why the model "forgets" things you told it an hour ago.

## Lesson

### Prompt and output: the whole transaction

Everything you send to a model is a **prompt**. Everything it sends back is the **output**, also called the **completion** (a fossil word from Module 1's insight: the model is completing your text). One prompt in, one output back; that is the entire transaction, repeated. There is no other channel. Every skill in this course reduces to one question: what should go in the prompt?

> **Term: Prompt.** Everything you send the model in one turn. The only input channel that exists.

> **Term: Output (completion).** The model's response: predicted text, generated word by word.

### Token: the model's syllable

Models do not read words. Text is chopped into **tokens**: chunks of roughly three to four characters of English, sometimes a whole short word, sometimes a fragment. "Endometriosis" is one word to you and several tokens to the model. A typical page of text runs 500 to 700 tokens.

Why should a clinician care about this unit? Three reasons. Pricing and limits are denominated in tokens; you will see the word in every plan comparison. Long documents are big token counts, which collide with the context window in a moment. And some famous model weaknesses, like miscounting letters in a word or fumbling arithmetic, trace back to the fact that the model sees tokens, not characters or digits.

> **Term: Token.** The chunk of text a model actually processes, roughly 3 to 4 characters. A page is about 500 to 700 tokens. Limits and pricing are counted in tokens.

### Context and the context window: the working memory

Here is the mechanic that explains the most model behavior per sentence of explanation.

The model is frozen (Module 3). So how does it "remember" what you said three messages ago? It does not. **Every time you send a message, the entire conversation so far, every prompt and every reply, plus your new message, is bundled up and fed through the model again as one giant prompt.** What looks to you like memory of the chat is re-reading, on every single turn. All of that bundled text is called the **context**.

The **context window** is the hard limit on how much context fits: a fixed maximum number of tokens the model can process in one pass. Think of it as working memory, in the cognitive sense: what the model can hold in mind right now, as opposed to the long-term knowledge frozen in its weights.

Consequences you will personally run into:

- **The long-chat slow fade.** As a conversation grows, it fills the window. Middles of long contexts get less attention than beginnings and ends, so a marathon chat starts missing details and repeating itself. The fix is a habit, not a trick: start fresh conversations per task, and carry over a short summary instead of dragging the whole history.
- **True forgetting.** When context exceeds the window, older turns are dropped or compressed. The model has not "chosen" to ignore your instruction from the start of the chat; that instruction may literally no longer be in front of it. Repeat what matters.
- **Documents count.** Upload a PDF and its full token count enters the window alongside your conversation. A large document plus a long chat can crowd each other out. This is the size limit behind Course 2's document workflows.
- **Between conversations, amnesia is total.** A new chat starts with an empty window. Unless a memory feature deliberately re-inserts saved text (Course 3), nothing carries over. This is a feature for privacy and a trap for expectations.

> **Term: Context.** Everything in front of the model on this turn: the conversation so far, your uploads, and the new message. Re-fed in full on every turn; this is what looks like memory.

> **Term: Context window.** The hard cap, in tokens, on how much context fits in one pass. The model's working memory. Overflow means degradation, then true forgetting.

### System prompt: the standing orders

Your conversation is not the only text in the window. The vendor places a **system prompt** ahead of it: standing instructions you never see, telling the model its identity, tone, formatting habits, and safety rules. It is why ChatGPT and Claude behave like polished assistants out of the box, and part of why the same underlying model can feel different inside different products.

You get a version of this power too: custom instructions, the user-level standing orders that Course 3 turns into a personalization tool. For now, know that when the model does something oddly consistent, like always adding disclaimers, the behavior often lives in a system prompt, not in the model.

> **Term: System prompt.** Standing instructions the vendor (and later, you) place ahead of every conversation. Invisible context that shapes behavior before you type a word.

### Temperature: why the same question gets different answers

Ask the same model the same question twice; get two different answers. Nothing is broken. At each step the model produces a ranked list of plausible next tokens, and **temperature** controls how it picks: at low temperature it takes the safest choice nearly every time; at higher settings it samples among good options, which reads as creativity and variety. Chat products run in the middle.

Practical takeaways: variability is normal and is not evidence of unreliability by itself. For fact-shaped questions, an answer that changes substantively across regenerations is a red flag worth verifying (a Module 5 technique). For drafting, regenerate deliberately: same prompt, several different drafts, pick the best. That is temperature working for you.

> **Term: Temperature (randomness).** The setting governing how the model picks among plausible next tokens. Explains run-to-run variation; useful for drafts, a verification signal for facts.

### Try it

In one sitting: (1) Ask a model the same clinical-adjacent question in two separate chats and compare answers; that is temperature. (2) In a long-running chat, ask "summarize everything I have told you in this conversation" and check it against reality; that is your context window audit. Both take three minutes and make the two hardest concepts in this module permanently concrete.

## Demo script (3-5 min)

1. Screen: a tokenizer visualization (either vendor's). Type "endometriosis excision" and show the token breakdown. "Words for you, tokens for it. Page of text, five to seven hundred of these."
2. Long chat demo: open a prepared conversation of 30+ turns. Ask "what did I say in my second message?" Show the miss or the vagueness. "Not a bug. The window is full, and the middle is dim. Fresh chats per task."
3. New chat: "What do you remember about me from our last conversation?" Show the blank. "Total amnesia between chats, unless a memory feature deliberately reinserts text. Feature and trap."
4. Same prompt, two regenerations, side by side. "Temperature. For drafts, this is free variety. For facts, big swings mean verify."
5. Close: "Prompt in, output back, everything riding inside a finite window. Next module: what happens when the prediction machine confidently makes things up."

## Quiz (5 questions)

1. **MCQ.** How does a model "remember" what you said earlier in a conversation?
   - A. The conversation updates its weights as you chat
   - B. The entire conversation is re-sent through the model with every new message ✓
   - C. It stores your chat in its training data
   - D. It does not; apparent memory is coincidence
   - *Explanation: Memory within a chat is re-reading: the full transcript rides in the context window on every turn. The model itself stays frozen.*

2. **MCQ.** A 40-page PDF plus a long conversation start producing degraded, forgetful answers. The best explanation is:
   - A. The model got bored
   - B. The document and conversation are overflowing the context window, so middle content gets less attention and older turns drop ✓
   - C. The PDF format is unsupported
   - D. Temperature is set too high
   - *Explanation: Documents and chat share one finite window. Overflow degrades before it visibly fails, which is why long sessions quietly get worse.*

3. **True/false with why.** "If you give an instruction in message 1 of a very long chat, the model is guaranteed to still be following it at message 60."
   - False. ✓ *By message 60 the instruction may be compressed out of the window entirely, or sitting in the poorly attended middle. Repeat standing instructions, or use custom instructions (Course 3).*

4. **MCQ.** You regenerate an answer to a factual question three times and get three substantively different claims. The right read is:
   - A. The model is broken; switch vendors
   - B. Temperature variation is exposing low confidence; treat none of the three as reliable without verification ✓
   - C. The third answer is most accurate; later regenerations improve
   - D. All three are true simultaneously
   - *Explanation: Run-to-run instability on fact-shaped questions is a verification signal. Stable answers can still be wrong, but unstable ones are shouting at you.*

5. **Spot the problem.** A colleague says: "I told ChatGPT about my documentation preferences last month, so today's new chat will format notes my way automatically."
   - A. Correct; models retain user preferences across chats
   - B. New chats start with an empty context window; last month's chat is gone unless a memory feature or custom instructions deliberately reinsert it ✓
   - C. Preferences persist only on paid plans
   - D. Formatting cannot be controlled at all
   - *Explanation: Between-chat amnesia is the default. Persistence requires explicit machinery: custom instructions or memory features, both covered in Course 3.*

## Scenario

**Setup.** A staff member has been running one enormous ChatGPT conversation for two weeks: patient-education drafts, scheduling templates, an employee-handbook revision, all in a single thread "so it has all the context." Quality is degrading: the model confuses documents, ignores the tone instruction from day one, and yesterday inserted handbook language into a patient handout.

**Task.** In three or four sentences, diagnose the problem in this module's vocabulary and prescribe the working method.

**Model answer.** Everything rides in one context window, and two weeks of mixed threads has overflowed it: the day-one tone instruction has been dropped or buried, and unrelated documents now sit side by side in context, which is why they cross-contaminate. The fix is one conversation per task, opened fresh: paste in only the material that task needs, restate the standing instructions each time (or move them into custom instructions), and when a chat runs long, ask the model to summarize the thread so far and carry that summary into a new chat instead of the whole history. Bigger context is never a substitute for cleaner context.

## Flashcards (7)

| Front | Back |
|---|---|
| Prompt | Everything you send the model in one turn; the only input channel. *Why you care: all skill with AI reduces to what goes in the prompt.* |
| Output (completion) | The model's generated response, predicted token by token. *Why you care: it is generated, never retrieved, on every single turn.* |
| Token | The 3-4 character chunk the model actually reads; a page is 500-700 tokens. *Why you care: limits and pricing are in tokens, and big documents are big token counts.* |
| Context | Everything in front of the model this turn: transcript, uploads, new message, re-fed in full every time. *Why you care: "memory" in a chat is just re-reading; what leaves context leaves the model's mind.* |
| Context window | The hard token cap on context per pass; the model's working memory. *Why you care: explains long-chat degradation and forgetting; one conversation per task is the antidote.* |
| System prompt | Standing instructions placed before your conversation, by the vendor and eventually by you. *Why you care: invisible context shapes behavior; your version of this power is custom instructions.* |
| Temperature (randomness) | Controls how the model picks among plausible next tokens; the source of run-to-run variety. *Why you care: regenerate for better drafts; instability on facts means verify.* |
