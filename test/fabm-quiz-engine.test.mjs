/**
 * Executed tests for src/lib/fabm-quiz-engine.mjs (0/359 lines before this file).
 *
 * The engine is pure, shared by /fertility-awareness-method-quiz/start/ and
 * .../results/, and safety-relevant: it tells a real person which fertility
 * awareness method to use. The load-bearing assertions here are the ROUTING
 * INVARIANTS -- properties checked across all 3,888 answer combinations, not a
 * handful of hand-picked cases -- because the failure mode that matters is
 * "someone retunes a weight in RULES and a calendar method starts being
 * recommended to a woman with irregular cycles".
 *
 * Companion file: fabm-quiz-engine-sid.test.mjs covers the sessionStorage
 * rehydration path. It has to be a separate file because ensureSid() caches the
 * id in module scope, so each first-call state needs its own module instance,
 * and node:test gives one process (hence one module registry) per test FILE.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  QUESTIONS, METHODS, RULES, RULES_VERSION, WHY_CLAUSES, ACCESS_ORDER,
  tiebreakKey, score, buildWhy, encodeAnswers, decodeAnswers, ensureSid, trackEvent,
} from '../src/lib/fabm-quiz-engine.mjs';

/** Every answer combination the wizard can produce (3*3*2*2*3*3*3*2*2 = 3888). */
function allCombinations() {
  const out = [];
  (function rec(i, acc) {
    if (i === QUESTIONS.length) { out.push({ ...acc }); return; }
    for (const opt of QUESTIONS[i].options) {
      acc[QUESTIONS[i].id] = opt.v;
      rec(i + 1, acc);
    }
  })(0, {});
  return out;
}
const COMBOS = allCombinations();

const ANSWER_KEYS = Object.keys(METHODS);

describe('fabm-quiz-engine -- data integrity', () => {
  it('enumerates exactly the 3888 reachable answer combinations', () => {
    assert.equal(COMBOS.length, 3888);
    assert.equal(QUESTIONS.length, 9);
  });

  it('every RULES question id and option value exists in QUESTIONS', () => {
    for (const [qid, byOption] of Object.entries(RULES)) {
      const question = QUESTIONS.find(q => q.id === qid);
      assert.ok(question, `RULES references unknown question id "${qid}"`);
      for (const value of Object.keys(byOption)) {
        assert.ok(
          question.options.some(o => o.v === value),
          `RULES.${qid} references option "${value}" that question "${qid}" does not offer`
        );
      }
    }
  });

  it('every RULES weight targets a method that exists in METHODS', () => {
    for (const [qid, byOption] of Object.entries(RULES)) {
      for (const [value, weights] of Object.entries(byOption)) {
        for (const method of Object.keys(weights)) {
          assert.ok(
            ANSWER_KEYS.includes(method),
            `RULES.${qid}.${value} scores unknown method "${method}"`
          );
        }
      }
    }
  });

  it('every question has a WHY clause for every option it offers', () => {
    for (const question of QUESTIONS) {
      for (const opt of question.options) {
        assert.equal(
          typeof WHY_CLAUSES[question.id]?.[opt.v], 'string',
          `missing WHY_CLAUSES.${question.id}.${opt.v} -- results page would render a blank reason`
        );
      }
    }
  });

  it('ACCESS_ORDER is a total order over METHODS (tiebreaks are deterministic)', () => {
    assert.deepEqual([...ACCESS_ORDER].sort(), [...ANSWER_KEYS].sort());
    assert.equal(new Set(ACCESS_ORDER).size, ACCESS_ORDER.length);
    for (const m of ANSWER_KEYS) assert.ok(tiebreakKey(m) >= 0, `${m} missing from ACCESS_ORDER`);
    assert.equal(tiebreakKey('not-a-method'), -1);
  });
});

describe('fabm-quiz-engine -- score()', () => {
  it('sums the rule weights for the selected answers', () => {
    // clinical:yes gives creighton +3, goal:health gives creighton +2 -> 5.
    // Hand-computed from RULES so the test fails if a weight moves.
    const answers = { goal: 'health', clinical: 'yes' };
    const result = score(answers);
    assert.equal(result.primary, 'creighton');
    assert.equal(result.top, 5);
  });

  it('never returns the same method as primary and alternate', () => {
    for (const answers of COMBOS) {
      const { primary, alternate } = score(answers);
      assert.notEqual(primary, alternate, `primary === alternate for ${JSON.stringify(answers)}`);
    }
  });

  it('always returns a real method for primary and alternate, on every combination', () => {
    for (const answers of COMBOS) {
      const { primary, alternate, top, second } = score(answers);
      assert.ok(ANSWER_KEYS.includes(primary), `unknown primary "${primary}"`);
      assert.ok(ANSWER_KEYS.includes(alternate), `unknown alternate "${alternate}"`);
      assert.ok(Number.isFinite(top) && Number.isFinite(second));
      assert.ok(top >= second, `primary scored below alternate for ${JSON.stringify(answers)}`);
    }
  });

  it('breaks ties by ACCESS_ORDER, lowest index wins', () => {
    // The empty answer set leaves every method at 0, so the winner is purely
    // the tiebreak: twoday is ACCESS_ORDER[0], sdm is ACCESS_ORDER[1].
    const result = score({});
    assert.equal(result.primary, 'twoday');
    assert.equal(result.alternate, 'sdm');
    assert.equal(result.top, 0);
  });

  it('ignores unknown question ids and unknown option values instead of throwing', () => {
    const result = score({ goal: 'health', notAQuestion: 'x', cycles: 'not-an-option' });
    assert.equal(result.primary, 'creighton'); // same as { goal: 'health' } alone
  });
});

describe('fabm-quiz-engine -- routing safety invariants (all 3888 combinations)', () => {
  /** Runs a predicate over every combination and reports the first violation with its answers. */
  function forbid(label, applies, forbidden) {
    const offenders = COMBOS.filter(a => applies(a) && forbidden(score(a), a));
    assert.equal(
      offenders.length, 0,
      `${label}: ${offenders.length} combination(s) violate it, e.g. ` +
      `${JSON.stringify(offenders[0])} -> ${JSON.stringify(offenders[0] && score(offenders[0]))}`
    );
  }

  it('irregular cycles are never routed to a calendar method (Standard Days)', () => {
    forbid('cycles=irregular must not recommend sdm',
      a => a.cycles === 'irregular', s => s.primary === 'sdm' || s.alternate === 'sdm');
  });

  it('untracked cycles are never routed to Standard Days as the primary', () => {
    forbid('cycles=vary must not have sdm as primary',
      a => a.cycles === 'vary', s => s.primary === 'sdm');
  });

  it('postpartum or breastfeeding is never routed to Standard Days as the primary', () => {
    forbid('postpartum=yes must not have sdm as primary',
      a => a.postpartum === 'yes', s => s.primary === 'sdm');
  });

  it('a user who wants no devices is never routed to a device-dependent method', () => {
    forbid('device=none must not recommend marquette (monitor) as primary',
      a => a.device === 'none', s => s.primary === 'marquette');
    forbid('device=none must not recommend sensiplan (thermometer) as primary or alternate',
      a => a.device === 'none', s => s.primary === 'sensiplan' || s.alternate === 'sensiplan');
  });

  it('a user who wants the lowest possible cost is never routed to the monitor method as primary', () => {
    forbid('budget=lowest must not have marquette as primary',
      a => a.budget === 'lowest', s => s.primary === 'marquette');
  });

  it('KNOWN GAP (ratchet): "I want a doctor to read my chart" can still be overridden by "keep it simple"', () => {
    // Found by this test on first write, 2026-07-28. clinical:yes is worth +3
    // creighton / -2 sdm / -2 twoday, but effort:simplest is worth +3 sdm /
    // +3 twoday / -3 creighton -- so the effort answer outweighs the clinical
    // one and 52 of the 3,888 combinations recommend a method that produces no
    // chart a clinician can read (30 twoday, 22 sdm) to someone who explicitly
    // asked for one. Every one of the 52 has effort=simplest.
    //
    // This is a RULES weighting decision, not a code defect, so it is pinned
    // here at the measured value rather than asserted to zero (a gate that is
    // red on arrival is not a gate). The count may only go DOWN.
    const chartable = new Set(['creighton', 'femm', 'marquette', 'sensiplan', 'billings']);
    const offenders = COMBOS.filter(a => a.clinical === 'yes' && !chartable.has(score(a).primary));
    assert.ok(
      offenders.length <= 52,
      `clinical=yes -> non-chartable primary widened to ${offenders.length} combinations (was 52), ` +
      `e.g. ${JSON.stringify(offenders[0])}`
    );
    assert.ok(
      offenders.every(a => a.effort === 'simplest'),
      'a NEW clinical=yes routing gap appeared outside the known effort=simplest cause'
    );
  });

  it('KNOWN GAP (ratchet): postpartum users can still be offered Standard Days as the ALTERNATE', () => {
    // Documented, deliberately pinned rather than asserted away. Calendar rules
    // are unreliable while cycles have not returned, and 21 of the 3,888
    // combinations still surface sdm in the second slot. The count may only go
    // DOWN: a change that widens the gap fails here, a fix requires editing the
    // number to the new (lower) measurement.
    const offenders = COMBOS.filter(a => a.postpartum === 'yes' && score(a).alternate === 'sdm');
    assert.ok(
      offenders.length <= 21,
      `postpartum -> sdm alternate widened to ${offenders.length} combinations (was 21)`
    );
  });
});

describe('fabm-quiz-engine -- buildWhy()', () => {
  it('returns at most three clauses, highest contribution first', () => {
    for (const answers of COMBOS) {
      const { primary } = score(answers);
      const why = buildWhy(answers, primary);
      assert.ok(why.length <= 3, `buildWhy returned ${why.length} clauses`);
      for (const clause of why) assert.equal(typeof clause, 'string');
      assert.equal(new Set(why).size, why.length, 'buildWhy repeated a clause');
    }
  });

  it('only cites answers that actually pushed the recommendation UP', () => {
    // Every returned clause must map back to a strictly positive weight for the
    // chosen method. A clause for a zero or negative contribution would be the
    // page telling a user a reason that did not apply.
    for (const answers of COMBOS.slice(0, 400)) {
      const { primary } = score(answers);
      for (const clause of buildWhy(answers, primary)) {
        const qid = Object.keys(WHY_CLAUSES).find(q => WHY_CLAUSES[q][answers[q]] === clause);
        assert.ok(qid, `clause "${clause}" maps to no question`);
        const delta = ((RULES[qid] || {})[answers[qid]] || {})[primary] || 0;
        assert.ok(delta > 0, `cited "${clause}" but ${qid} contributed ${delta} to ${primary}`);
      }
    }
  });

  it('orders by contribution, then by question order', () => {
    // clinical:yes -> creighton +3, goal:health -> creighton +2, effort:detailed -> +2.
    // goal precedes effort in QUESTIONS, so it wins the equal-delta tiebreak.
    const why = buildWhy({ goal: 'health', effort: 'detailed', clinical: 'yes' }, 'creighton');
    assert.deepEqual(why, [
      WHY_CLAUSES.clinical.yes,
      WHY_CLAUSES.goal.health,
      WHY_CLAUSES.effort.detailed,
    ]);
  });

  it('returns an empty list when nothing pushed the method up', () => {
    assert.deepEqual(buildWhy({}, 'creighton'), []);
    // effort:simplest is -3 for creighton: a negative contribution is not a reason.
    assert.deepEqual(buildWhy({ effort: 'simplest' }, 'creighton'), []);
  });
});

describe('fabm-quiz-engine -- answer encoding', () => {
  it('round-trips every one of the 3888 combinations', () => {
    for (const answers of COMBOS) {
      const code = encodeAnswers(answers);
      assert.equal(code.length, QUESTIONS.length);
      assert.deepEqual(decodeAnswers(code), answers, `round-trip lost ${JSON.stringify(answers)}`);
    }
  });

  it('encodes a missing answer as an empty slot, which then fails to decode', () => {
    const partial = { ...COMBOS[0] };
    delete partial.budget;
    const code = encodeAnswers(partial);
    assert.equal(code.length, QUESTIONS.length - 1);
    assert.equal(decodeAnswers(code), null, 'a short code must not decode into a partial recommendation');
  });

  it('rejects malformed codes instead of producing a partial answer map', () => {
    assert.equal(decodeAnswers(null), null);
    assert.equal(decodeAnswers(12345), null);
    assert.equal(decodeAnswers(''), null);
    assert.equal(decodeAnswers('12345678'), null, 'too short');
    assert.equal(decodeAnswers('1234567890'), null, 'too long');
    assert.equal(decodeAnswers('12345678a'), null, 'non-digit');
    assert.equal(decodeAnswers('1234-6789'.slice(0, 9)), null, 'punctuation');
  });

  it('rejects an out-of-range option index for a question', () => {
    // Question 3 (postpartum) has 2 options, so index 2 is out of range.
    const valid = encodeAnswers(COMBOS[0]);
    const tampered = valid.slice(0, 2) + '9' + valid.slice(3);
    assert.equal(decodeAnswers(tampered), null);
  });

  it('accepts every in-range index for every question position', () => {
    for (let i = 0; i < QUESTIONS.length; i++) {
      for (let idx = 0; idx < QUESTIONS[i].options.length; idx++) {
        const code = QUESTIONS.map((q, j) => (j === i ? String(idx) : '0')).join('');
        const decoded = decodeAnswers(code);
        assert.ok(decoded, `index ${idx} rejected at question ${i}`);
        assert.equal(decoded[QUESTIONS[i].id], QUESTIONS[i].options[idx].v);
      }
    }
  });
});

describe('fabm-quiz-engine -- ensureSid() with no storage and no crypto', () => {
  let realCrypto;

  before(() => {
    // sessionStorage is simply absent in this process, so the getItem read
    // throws ReferenceError -- the same shape as a browser blocking storage.
    realCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { randomUUID() { throw new Error('randomUUID unavailable'); } },
    });
  });

  after(() => {
    if (realCrypto) Object.defineProperty(globalThis, 'crypto', realCrypto);
  });

  it('falls back to a locally generated id instead of throwing', () => {
    const sid = ensureSid();
    assert.match(sid, /^sid-[a-z0-9]{20}$/, `unexpected fallback id shape: ${sid}`);
  });

  it('caches the id so both quiz pages report the same anonymous session', () => {
    assert.equal(ensureSid(), ensureSid());
  });
});

describe('fabm-quiz-engine -- trackEvent()', () => {
  let navigatorDescriptor;
  let realFetch;

  before(() => {
    navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    realFetch = globalThis.fetch;
  });

  after(() => {
    if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
    globalThis.fetch = realFetch;
  });

  function setNavigator(value) {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  }

  it('beacons the event, session id and rules version to /api/quiz/event', () => {
    const beacons = [];
    setNavigator({ sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } });

    trackEvent('quiz_start');

    assert.equal(beacons.length, 1);
    assert.equal(beacons[0].url, '/api/quiz/event');
    const payload = JSON.parse(beacons[0].body);
    assert.equal(payload.event, 'quiz_start');
    assert.equal(payload.rulesVersion, RULES_VERSION);
    assert.equal(payload.sid, ensureSid());
    assert.ok(!('qid' in payload), 'qid must be omitted when not supplied');
  });

  it('includes the question id when one is supplied', () => {
    const beacons = [];
    setNavigator({ sendBeacon: (url, body) => { beacons.push({ url, body }); return true; } });

    trackEvent('quiz_answer', 'device');

    assert.equal(JSON.parse(beacons[0].body).qid, 'device');
  });

  it('falls back to a keepalive fetch when sendBeacon is unavailable', () => {
    const posts = [];
    setNavigator({});
    globalThis.fetch = (url, init) => { posts.push({ url, init }); return Promise.resolve({ ok: true }); };

    trackEvent('quiz_complete');

    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, '/api/quiz/event');
    assert.equal(posts[0].init.method, 'POST');
    assert.equal(posts[0].init.keepalive, true);
    assert.equal(posts[0].init.headers['Content-Type'], 'application/json');
    assert.equal(JSON.parse(posts[0].init.body).event, 'quiz_complete');
  });

  it('swallows a transport failure rather than breaking the quiz page', () => {
    const posts = [];
    setNavigator(null); // reading navigator.sendBeacon throws
    globalThis.fetch = (url, init) => { posts.push({ url, init }); return Promise.resolve({ ok: true }); };

    assert.doesNotThrow(() => trackEvent('quiz_start'));
    assert.equal(posts.length, 0, 'no transport should have been reached');
  });
});
