/**
 * EXECUTED tests for scripts/bulk-send.mjs.
 *
 * Every dangerous property of this CLI is a pure function, deliberately, so it
 * can be asserted without a network, a git checkout or a 1Password session:
 * dry-run is the default, --send is the only way past it, a checkout behind
 * origin/main refuses, and the refusal codes the endpoint returns are reported
 * rather than swallowed into a zero exit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, isBehindOrigin, renderReport, main } from '../scripts/bulk-send.mjs';

describe('parseArgs', () => {
  it('is dry-run unless --send is passed', () => {
    assert.equal(parseArgs(['--campaign', 'sept-letter']).send, false);
    assert.equal(parseArgs(['--campaign', 'sept-letter', '--send']).send, true);
  });

  it('reads the campaign, the body file and the segments', () => {
    const a = parseArgs(['--campaign', 'sept-letter', '--body', 'letter.html', '--subject', 'subj.txt', '--segments', 'donor,student']);
    assert.equal(a.campaign, 'sept-letter');
    assert.equal(a.bodyFile, 'letter.html');
    assert.equal(a.subjectFile, 'subj.txt');
    assert.deepEqual(a.segments, ['donor', 'student']);
  });

  it('carries --first-send and --resume as their own flags, never implied', () => {
    const plain = parseArgs(['--campaign', 'x1', '--send']);
    assert.equal(plain.firstSend, false);
    assert.equal(plain.resume, false);
    const armed = parseArgs(['--campaign', 'x1', '--send', '--first-send', '--resume']);
    assert.equal(armed.firstSend, true);
    assert.equal(armed.resume, true);
  });

  it('defaults the endpoint to production and lets --endpoint override it', () => {
    assert.equal(parseArgs([]).endpoint, 'https://rrmacademy.org/api/newsletter/send');
    assert.equal(parseArgs(['--endpoint', 'http://localhost:8788/api/newsletter/send']).endpoint, 'http://localhost:8788/api/newsletter/send');
  });
});

describe('isBehindOrigin', () => {
  const runner = (counts) => (cmd, args) => {
    if (args[0] === 'fetch') return '';
    if (args.includes('HEAD..origin/main')) return counts;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };

  it('is clean when the checkout contains origin/main', () => {
    const v = isBehindOrigin('.', runner('0\n'));
    assert.equal(v.behind, false);
    assert.equal(v.count, 0);
  });

  it('is behind when origin/main carries commits this checkout does not', () => {
    const v = isBehindOrigin('.', runner('3\n'));
    assert.equal(v.behind, true);
    assert.equal(v.count, 3);
    assert.match(v.detail, /3 commit/);
  });

  it('treats a git failure as BEHIND, never as clean', () => {
    const v = isBehindOrigin('.', () => { throw new Error('not a git repository'); });
    assert.equal(v.behind, true, 'an unreadable checkout is not a fresh one');
    assert.match(v.detail, /not a git repository/);
  });
});

describe('main', () => {
  function deps({ answer, status = 200, behind = false, files = {} }) {
    const posted = [];
    return {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body), headers: init.headers });
        return new Response(JSON.stringify(answer), { status, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => {
        if (!(p in files)) throw new Error(`no such file ${p}`);
        return files[p];
      },
      secret: () => 'admin-secret',
      git: () => (behind ? '2\n' : '0\n'),
      log: () => {},
      error: () => {},
    };
  }

  const ARGS = ['--campaign', 'sept-letter', '--subject', 's.txt', '--body', 'b.html'];
  const FILES = { 's.txt': 'The September letter', 'b.html': '<p>hello</p>' };

  it('refuses before any request when the checkout is behind origin/main', async () => {
    const d = deps({ answer: {}, behind: true, files: FILES });
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 3);
    assert.equal(d.posted.length, 0, 'nothing is sent from a stale checkout');
  });

  it('dry-runs by default and never sets send on the request', async () => {
    const d = deps({
      files: FILES,
      answer: { ok: true, dryRun: true, audience: 812, wouldSend: 200, deferred: 612, cap: 200, ageDays: 1, remainingToday: 200, head: ['a@x.com'], feedbackId: 'sept-letter:all:rrma:rrmacademy.com' },
    });
    const code = await main(ARGS, d);
    assert.equal(code, 0);
    assert.equal(d.posted[0].body.lane, 'bulk');
    assert.equal(d.posted[0].body.campaign, 'sept-letter');
    assert.equal(d.posted[0].body.send, undefined);
    assert.equal(d.posted[0].headers.Authorization, 'Bearer admin-secret');
  });

  it('sets send only with --send', async () => {
    const d = deps({ files: FILES, answer: { ok: true, done: true, sent: 200, deferred: 0, cap: 200, ageDays: 1, remainingToday: 0 } });
    await main([...ARGS, '--send'], d);
    assert.equal(d.posted[0].body.send, true);
  });

  it('reports a pause as a non-zero exit with the reason on stderr', async () => {
    const d = deps({ status: 423, files: FILES, answer: { ok: false, error: 'bulk_paused', reason: 'complaint-rate', detail: '900 sent, 3 complaints (0.333%)' } });
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 4);
  });

  it('reports a first-send gate as its own exit code, not a generic failure', async () => {
    const d = deps({ status: 409, files: FILES, answer: { ok: false, error: 'bulk_first_send_required', reason: 'first-send-not-recorded' } });
    assert.equal(await main([...ARGS, '--send'], d), 5);
  });

  it('refuses a campaign key the endpoint would reject, before the request', async () => {
    const d = deps({ files: FILES, answer: {} });
    const code = await main(['--campaign', 'Sept Letter', '--subject', 's.txt', '--body', 'b.html'], d);
    assert.equal(code, 2);
    assert.equal(d.posted.length, 0);
  });

  it('an unreadable admin secret exits 2 with a terse message, not a raw stack (#2)', async () => {
    const d = deps({ files: FILES, answer: {} });
    d.secret = () => { throw new Error('1Password CLI: not signed in'); };
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 2);
    assert.equal(d.posted.length, 0, 'nothing is sent when the secret cannot be read');
  });

  it("the unreadable-secret message does not leak the underlying 1Password error (#2)", async () => {
    const errors = [];
    const d = deps({ files: FILES, answer: {} });
    d.secret = () => { throw new Error('1Password CLI: not signed in'); };
    d.error = (msg) => errors.push(msg);
    await main([...ARGS, '--send'], d);
    assert.ok(errors.some((m) => /could not read the admin secret/.test(m)));
    assert.ok(!errors.some((m) => /not signed in/.test(m)), 'the raw 1Password error text is never printed');
  });

  it('never holds an SES credential', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../scripts/bulk-send.mjs', import.meta.url), 'utf8');
    assert.ok(!/AWS_SECRET_ACCESS_KEY|AWS_ACCESS_KEY_ID|aws4fetch/.test(src),
      'the CLI calls the endpoint; only the Pages Function holds SES credentials');
  });

  // --- Task 6 review rulings ---------------------------------------------
  // (1) one invocation sends at most BULK_PAGE_SIZE=50, so the CLI loops
  //     calling the endpoint while work remains.
  // (2) the loop breaks on sent === 0, not on deferred alone, because
  //     deferred is only an upper bound on segment-filtered runs.

  it('loops calling the endpoint while a page keeps sending, and stops when a page sends nothing', async () => {
    const posted = [];
    const answers = [
      { ok: true, dryRun: false, done: false, sent: 50, deferred: 130, cap: 200, ageDays: 5, remainingToday: 150 },
      { ok: true, dryRun: false, done: false, sent: 50, deferred: 80, cap: 200, ageDays: 5, remainingToday: 100 },
      { ok: true, dryRun: false, done: false, sent: 0, deferred: 80, cap: 200, ageDays: 5, remainingToday: 50 },
    ];
    const d = {
      posted,
      fetch: async (url, init) => {
        const body = JSON.parse(init.body);
        posted.push({ url, body });
        return new Response(JSON.stringify(answers[posted.length - 1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: () => {},
      error: () => {},
    };
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 0);
    // stops after the third call because it returned sent: 0, not because
    // deferred reached zero (it never did -- deferred stayed at 80)
    assert.equal(posted.length, 3);
    assert.equal(posted[2].body.send, true);
  });

  it('stops the loop as soon as the endpoint reports done, without waiting for sent: 0', async () => {
    const posted = [];
    const d = {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, dryRun: false, done: true, sent: 30, deferred: 0, cap: 200, ageDays: 5, remainingToday: 170 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: () => {},
      error: () => {},
    };
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 0);
    assert.equal(posted.length, 1);
  });

  it('a mid-loop refusal (e.g. the breaker tripping on page 2) exits with that code, not 0', async () => {
    const posted = [];
    const answers = [
      { ok: true, dryRun: false, done: false, sent: 50, deferred: 200, cap: 200, ageDays: 5, remainingToday: 150 },
      { ok: false, error: 'bulk_paused', reason: 'complaint-rate', detail: 'tripped mid-run' },
    ];
    const d = {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(answers[posted.length - 1]), { status: posted.length === 1 ? 200 : 423, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: () => {},
      error: () => {},
    };
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 4);
    assert.equal(posted.length, 2, 'the loop actually made the second call and stopped there');
  });

  it('does not loop on a dry run: exactly one call, even though deferred > 0', async () => {
    const posted = [];
    const d = {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, dryRun: true, audience: 812, wouldSend: 200, deferred: 612, cap: 200, ageDays: 1, remainingToday: 200, head: ['a@x.com'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: () => {},
      error: () => {},
    };
    const code = await main(ARGS, d);
    assert.equal(code, 0);
    assert.equal(posted.length, 1);
  });

  // --- Final fix wave -----------------------------------------------------

  it('a transport error mid-loop names how much got out and exits 7', async () => {
    const printed = [];
    const errors = [];
    let calls = 0;
    const d = {
      posted: [],
      fetch: async (url, init) => {
        calls += 1;
        if (calls === 2) throw new TypeError('fetch failed');
        d.posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, dryRun: false, done: false, sent: 50, deferred: 130, cap: 200, ageDays: 5, remainingToday: 150 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: (...args) => printed.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    };
    const code = await main([...ARGS, '--send'], d);
    assert.equal(code, 7);
    assert.equal(calls, 2, 'the throw came from the SECOND page');
    assert.match(errors.join('\n'), /sent so far: 50 recipient\(s\) across 1 page\(s\)/);
    assert.match(errors.join('\n'), /fetch failed/);
  });

  it('a transport error on a DRY RUN also exits 7, not an unhandled rejection (I8)', async () => {
    const errors = [];
    const printed = [];
    const d = {
      posted: [],
      fetch: async () => { throw new TypeError('fetch failed'); },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: (...args) => printed.push(args.join(' ')),
      error: (...args) => errors.push(args.join(' ')),
    };
    const code = await main(ARGS, d);
    assert.equal(code, 7);
    assert.match(errors.join('\n'), /TRANSPORT ERROR/);
    assert.match(errors.join('\n'), /fetch failed/);
  });

  it('sends --resume on the FIRST page only, so one resume cannot disable the breaker for a whole run', async () => {
    const posted = [];
    const answers = [
      { ok: true, dryRun: false, done: false, sent: 50, deferred: 30, cap: 200, ageDays: 5, remainingToday: 150 },
      { ok: true, dryRun: false, done: true, sent: 30, deferred: 0, cap: 200, ageDays: 5, remainingToday: 120 },
    ];
    const d = {
      posted,
      fetch: async (url, init) => {
        posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify(answers[posted.length - 1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: () => {},
      error: () => {},
    };
    const code = await main([...ARGS, '--send', '--resume'], d);
    assert.equal(code, 0);
    assert.equal(posted.length, 2);
    assert.equal(posted[0].body.resume, true, 'page 1 carries the override the human asked for');
    assert.equal(posted[1].body.resume, undefined, 'page 2 re-evaluates the breaker');
    assert.equal(posted[1].body.send, true, 'and is still a real send');
  });

  it('a dry run still carries --resume, since it is the only call it makes', async () => {
    const d = deps({
      files: FILES,
      answer: { ok: true, dryRun: true, audience: 10, wouldSend: 10, deferred: 0, cap: 200, ageDays: 1, remainingToday: 200 },
    });
    await main([...ARGS, '--resume'], d);
    assert.equal(d.posted[0].body.resume, true);
  });

  it('reports bulk_run_in_progress as its own exit code, not a generic failure', async () => {
    const d = deps({ status: 409, files: FILES, answer: { ok: false, error: 'bulk_run_in_progress', retryAfterSeconds: 120, detail: 'another --send run holds this campaign; run one at a time' } });
    assert.equal(await main([...ARGS, '--send'], d), 8);
  });

  it('says one --send at a time per campaign, in the header an operator reads', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../scripts/bulk-send.mjs', import.meta.url), 'utf8');
    assert.match(src, /ONE --send AT A TIME PER CAMPAIGN/);
  });

  it('prints deferred as "up to N remaining" on a segmented run', async () => {
    const printed = [];
    const d = {
      posted: [],
      fetch: async (url, init) => {
        d.posted.push({ url, body: JSON.parse(init.body) });
        return new Response(JSON.stringify({ ok: true, dryRun: true, audience: 300, wouldSend: 50, deferred: 250, cap: 200, ageDays: 5, remainingToday: 150, head: ['a@x.com'] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
      readFile: (p) => FILES[p],
      secret: () => 'admin-secret',
      git: () => '0\n',
      log: (...args) => printed.push(args.join(' ')),
      error: () => {},
    };
    const code = await main([...ARGS, '--segments', 'donor'], d);
    assert.equal(code, 0);
    assert.match(printed.join('\n'), /up to 250 remaining/);
  });
});

describe('renderReport', () => {
  it('names the four things a dry run exists to show', () => {
    const out = renderReport({
      ok: true, dryRun: true, campaign: 'sept-letter', audience: 812, wouldSend: 200, deferred: 612,
      cap: 200, ageDays: 1, sentToday: 0, remainingToday: 200,
      head: ['a@x.com', 'b@x.com'], feedbackId: 'sept-letter:all:rrma:rrmacademy.com', breaker: '0 sent, 0 complaints',
    });
    assert.match(out, /812/);           // audience after exclusions
    assert.match(out, /200/);           // today's remaining cap
    assert.match(out, /a@x\.com/);      // the cohort head
    assert.match(out, /sept-letter/);   // the campaign key
  });

  it('labels deferred "up to N remaining" when the answer is marked segmented', () => {
    const out = renderReport({
      ok: true, dryRun: true, campaign: 'sept-letter', audience: 300, wouldSend: 50, deferred: 250,
      cap: 200, ageDays: 1, remainingToday: 150, head: ['a@x.com'], segmented: true,
    });
    assert.match(out, /up to 250 remaining/);
  });
});
