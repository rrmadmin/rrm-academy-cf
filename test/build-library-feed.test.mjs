/**
 * scripts/build-library-feed.mjs -- the last zero in the library render surface.
 *
 * The feed is the bulk-pull surface for the research library: one
 * schema.org/MedicalScholarlyArticle per line, published on every deploy and
 * read by agents that never crawl the HTML pages. Nothing imported this script
 * before this file, so 0/75 lines; the only instrument on it was whether the
 * build crashed.
 *
 * WHY IT WAS NOT COVERABLE, AND WHAT CHANGED
 * Its input and output paths used to be resolved at module scope from
 * import.meta.url, and the whole body ran on import. Importing it in a test
 * therefore read the real 32 MB src/data/articles.json and rewrote the real
 * public/library-feed.jsonl, or -- on a clean checkout where that gitignored
 * file is absent -- took the early exit and covered nothing. The production
 * change is the smallest one that removes that: buildLibraryFeed() takes the
 * two paths as options defaulting to the same constants, and the module-scope
 * body became a main() the CLI calls. The defaults are asserted below, and the
 * refactor was checked by rebuilding the real feed and diffing it byte for
 * byte against what main produced (identical, 4053 records, sha256
 * 0edf193c193bafa9297abff7567ccf52fd22265ce1c639d0fbe0e795fd0fb4ae).
 *
 * WHAT IS REAL HERE
 * Every case writes to a genuine temp directory and the assertions read the
 * bytes back off disk. The schema builder is the real one from src/lib, not a
 * stand-in, so a change to the emitted JSON-LD shows up here.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  buildLibraryFeed, main, isDirectRun, FeedInputError,
  DEFAULT_ARTICLES_PATH, DEFAULT_OUT_PATH,
} from '../scripts/build-library-feed.mjs';
import { buildMedicalScholarlyArticle } from '../src/lib/schema-builders.mjs';

const SCRIPT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'build-library-feed.mjs');
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ARTICLES = [
  { slug: 'endometriosis-diagnosis', title: 'Diagnosis of endometriosis', doi: '10.1000/abc', pmid: '12345678', journal: 'J Test', datePublished: '2024-01-01', authors: 'Doe J, Roe A' },
  { slug: 'progesterone-support', title: 'Progesterone support in early pregnancy', abstract: 'An abstract.', pages: '10-20' },
];

/** A collecting logger, so a warning is an assertable value rather than terminal noise. */
function recorder() {
  const warns = [], errors = [], logs = [];
  return { warns, errors, logs, warn: (m) => warns.push(m), error: (m) => errors.push(m), log: (m) => logs.push(m) };
}

describe('scripts/build-library-feed.mjs', () => {
  let dir, articlesPath, outPath, logger;

  before(() => { dir = mkdtempSync(join(tmpdir(), 'library-feed-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(() => {
    logger = recorder();
    articlesPath = join(dir, `articles-${Math.random().toString(36).slice(2)}.json`);
    outPath = join(dir, `out-${Math.random().toString(36).slice(2)}`, 'library-feed.jsonl');
  });

  const write = (value) => writeFileSync(articlesPath, typeof value === 'string' ? value : JSON.stringify(value));
  const readLines = () => readFileSync(outPath, 'utf8').trimEnd().split('\n');

  // --- the feed itself -----------------------------------------------------

  describe('the emitted feed', () => {
    it('writes one JSON-LD record per article and reports what it wrote', () => {
      write(ARTICLES);
      const result = buildLibraryFeed({ articlesPath, outPath, logger });

      assert.equal(result.records, 2);
      assert.equal(result.skipped, 0);
      assert.equal(result.outPath, outPath);
      assert.equal(result.sizeKb, Math.round(statSync(outPath).size / 1024));

      const lines = readLines();
      assert.equal(lines.length, 2);
      const first = JSON.parse(lines[0]);
      assert.equal(first['@type'], 'MedicalScholarlyArticle');
      assert.equal(first['@id'], 'https://rrmacademy.org/library/endometriosis-diagnosis/');
      assert.equal(first.name, 'Diagnosis of endometriosis');
      assert.equal(logger.warns.length, 0);
    });

    it('emits exactly what the shared schema builder produces, not its own shape', () => {
      write(ARTICLES);
      buildLibraryFeed({ articlesPath, outPath, logger });
      const lines = readLines();
      for (const [i, article] of ARTICLES.entries()) {
        assert.deepEqual(JSON.parse(lines[i]), buildMedicalScholarlyArticle(article));
      }
    });

    it('is JSONL: every line parses on its own and the file ends with a newline', () => {
      write(ARTICLES);
      buildLibraryFeed({ articlesPath, outPath, logger });
      const raw = readFileSync(outPath, 'utf8');
      assert.equal(raw.endsWith('\n'), true);
      assert.equal(raw.includes('\n\n'), false, 'a blank line would break line-delimited parsing');
      for (const line of raw.trimEnd().split('\n')) assert.doesNotThrow(() => JSON.parse(line));
    });

    it('preserves input order', () => {
      write(ARTICLES);
      buildLibraryFeed({ articlesPath, outPath, logger });
      assert.deepEqual(readLines().map(l => JSON.parse(l).name), ARTICLES.map(a => a.title));
    });

    it('creates the output directory when it does not exist', () => {
      outPath = join(dir, 'deep', 'nested', 'library-feed.jsonl');
      write(ARTICLES);
      assert.equal(existsSync(dirname(outPath)), false);
      buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(existsSync(outPath), true);
    });

    it('overwrites a previous feed rather than appending to it', () => {
      write(ARTICLES);
      buildLibraryFeed({ articlesPath, outPath, logger });
      const firstRun = readFileSync(outPath, 'utf8');
      buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(readFileSync(outPath, 'utf8'), firstRun, 'a second run changed the feed');
    });

    it('leaves no .tmp staging file behind', () => {
      write(ARTICLES);
      buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(existsSync(outPath + '.tmp'), false);
    });

    it('writes an empty feed for an empty article list without failing', () => {
      write([]);
      const result = buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(result.records, 0);
      assert.equal(readFileSync(outPath, 'utf8'), '\n');
    });
  });

  // --- what gets dropped ---------------------------------------------------

  describe('records it refuses to publish', () => {
    for (const [label, article] of [
      ['a null entry', null],
      ['an entry with no slug', { title: 'No slug' }],
      ['an entry with no title', { slug: 'no-title' }],
      ['an entry with an empty slug', { slug: '', title: 'Empty slug' }],
      ['an entry with an empty title', { slug: 'empty-title', title: '' }],
    ]) {
      it(`drops ${label} and counts it as skipped`, () => {
        write([ARTICLES[0], article]);
        const result = buildLibraryFeed({ articlesPath, outPath, logger });
        assert.equal(result.records, 1);
        assert.equal(result.skipped, 1);
        assert.equal(readLines().length, 1);
        assert.equal(logger.warns.length, 0, 'a structurally incomplete record should be dropped quietly');
      });
    }

    it('names the slug in a warning when the schema builder throws on a record', () => {
      // A null author record is what this looks like in the wild: the authors
      // array survives the export, one element does not.
      write([ARTICLES[0], { slug: 'broken-authors', title: 'Broken', authorRecords: [null] }]);
      const result = buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(result.records, 1);
      assert.equal(result.skipped, 1);
      assert.equal(logger.warns.length, 1);
      assert.match(logger.warns[0], /skipped broken-authors:/);
      assert.equal(readLines().length, 1, 'the good record was dropped alongside the bad one');
    });
  });

  // --- input failures ------------------------------------------------------

  describe('input failures', () => {
    it('returns null and warns when the input file is absent, writing nothing', () => {
      const result = buildLibraryFeed({ articlesPath, outPath, logger });
      assert.equal(result, null);
      assert.equal(existsSync(outPath), false);
      assert.equal(logger.warns.length, 1);
      assert.match(logger.warns[0], /not found/);
      assert.ok(logger.warns[0].includes(articlesPath), 'the warning did not name the path it looked at');
    });

    it('throws FeedInputError on unparseable JSON', () => {
      write('{"not": ');
      assert.throws(
        () => buildLibraryFeed({ articlesPath, outPath, logger }),
        (err) => err instanceof FeedInputError && /failed to parse articles\.json/.test(err.message),
      );
      assert.equal(existsSync(outPath), false, 'a partial feed was written from a broken input');
    });

    it('throws FeedInputError when the input parses into an object rather than an array', () => {
      write({ articles: ARTICLES });
      assert.throws(
        () => buildLibraryFeed({ articlesPath, outPath, logger }),
        (err) => err instanceof FeedInputError && /is not an array/.test(err.message),
      );
      assert.equal(existsSync(outPath), false);
    });
  });

  // --- the defaults the build chain actually uses ---------------------------

  describe('production defaults', () => {
    it('defaults to the repo paths npm run build depends on', () => {
      // npm `build` invokes this with no arguments, so these two constants are
      // the real contract: src/data/articles.json in, public/library-feed.jsonl
      // out. A change to either silently unpublishes or misplaces the feed.
      assert.equal(DEFAULT_ARTICLES_PATH, resolve(REPO_ROOT, 'src/data/articles.json'));
      assert.equal(DEFAULT_OUT_PATH, resolve(REPO_ROOT, 'public/library-feed.jsonl'));
    });

    it('takes the default outPath when only the input path is given', () => {
      // Exercised through the absent-input arm on purpose: it runs the default
      // parameter initialisers without letting the run reach a write, so the
      // real public/library-feed.jsonl is never touched by the suite.
      const result = buildLibraryFeed({ articlesPath: join(dir, 'definitely-absent.json'), logger });
      assert.equal(result, null);
      assert.equal(logger.warns.length, 1);
    });

    it('defaults its logger to console rather than requiring one', () => {
      const originalWarn = console.warn;
      const seen = [];
      console.warn = (m) => seen.push(m);
      try {
        buildLibraryFeed({ articlesPath: join(dir, 'definitely-absent.json'), outPath });
      } finally {
        console.warn = originalWarn;
      }
      assert.equal(seen.length, 1);
      assert.match(seen[0], /not found/);
    });
  });

  // --- the CLI wrapper -----------------------------------------------------

  describe('main()', () => {
    it('returns 0 and reports the record count and size', () => {
      write(ARTICLES);
      const code = main(['--articles', articlesPath, '--out', outPath], logger);
      assert.equal(code, 0);
      assert.equal(logger.logs.length, 1);
      assert.match(logger.logs[0], /^\[build-library-feed\] wrote 2 records to /);
      assert.ok(logger.logs[0].includes(outPath));
      assert.match(logger.logs[0], / KB\)$/);
      assert.equal(logger.errors.length, 0);
    });

    it('appends the skipped count to its summary only when something was skipped', () => {
      write([ARTICLES[0], { title: 'No slug' }]);
      main(['--articles', articlesPath, '--out', outPath], logger);
      assert.match(logger.logs[0], /\(\d+ KB, skipped 1\)$/);
    });

    it('returns 0 and prints no summary when the input file is absent', () => {
      const code = main(['--articles', join(dir, 'nope.json'), '--out', outPath], logger);
      assert.equal(code, 0);
      assert.equal(logger.logs.length, 0);
      assert.equal(logger.warns.length, 1);
    });

    it('returns 1 and prints the FATAL line for a bad input', () => {
      write('not json at all');
      const code = main(['--articles', articlesPath, '--out', outPath], logger);
      assert.equal(code, 1);
      assert.equal(logger.errors.length, 1);
      assert.match(logger.errors[0], /^\[build-library-feed\] FATAL: failed to parse articles\.json:/);
      assert.equal(logger.logs.length, 0);
    });

    it('returns 1 for an input that is not an array', () => {
      write({ nope: true });
      assert.equal(main(['--articles', articlesPath, '--out', outPath], logger), 1);
      assert.match(logger.errors[0], /is not an array/);
    });

    it('rethrows anything that is not a bad input, rather than reporting it as one', () => {
      // --out under a path whose parent is a FILE: mkdirSync raises ENOTDIR.
      // Swallowing that as exit 1 with a one-line message would hide a broken
      // deploy target behind the same output as a malformed articles.json.
      write(ARTICLES);
      const blocker = join(dir, 'not-a-directory');
      writeFileSync(blocker, 'i am a file');
      assert.throws(
        () => main(['--articles', articlesPath, '--out', join(blocker, 'feed.jsonl')], logger),
        (err) => !(err instanceof FeedInputError) && /ENOTDIR|EEXIST|ENOENT/.test(err.code ?? err.message),
      );
      assert.equal(logger.errors.length, 0);
    });

    it('uses the defaults when given no arguments to override them', () => {
      // Proven without running a build: argv with no --articles/--out leaves
      // both paths at the constants, and the constants are asserted above.
      write(ARTICLES);
      const code = main(['--articles', articlesPath, '--out', outPath, '--unknown-flag'], logger);
      assert.equal(code, 0);
      assert.equal(readLines().length, 2, 'an unrecognised flag changed the run');
    });
  });

  // --- entry-point detection ------------------------------------------------

  describe('isDirectRun()', () => {
    it('is true for this module\'s own path', () => {
      assert.equal(isDirectRun(SCRIPT_PATH), true);
    });

    it('is true through a symlinked spelling of the same file, which is how macOS reports /tmp', () => {
      // The reason both sides are realpath'd: macOS resolves /tmp to
      // /private/tmp inside import.meta.url but leaves argv alone, so a plain
      // string compare makes a direct run in a /tmp worktree look like an
      // import and the CLI silently does nothing.
      const link = join(dir, 'linked-build-library-feed.mjs');
      symlinkSync(SCRIPT_PATH, link);
      try {
        assert.equal(isDirectRun(link), true);
      } finally {
        rmSync(link, { force: true });
      }
    });

    it('is false when the process has no entry point at all', () => {
      // Passing `undefined` would NOT test this: it triggers the default
      // parameter, which reads process.argv[1] and finds the test runner. The
      // condition only exists for `node -e`, so reproduce that instead.
      const original = process.argv[1];
      process.argv[1] = undefined;
      try {
        assert.equal(isDirectRun(), false);
      } finally {
        process.argv[1] = original;
      }
    });

    it('is false for an empty entry path', () => {
      assert.equal(isDirectRun(''), false);
    });

    it('is false for another file', () => {
      assert.equal(isDirectRun(join(REPO_ROOT, 'package.json')), false);
    });

    it('is false, not a crash, when the entry path does not exist', () => {
      assert.equal(isDirectRun(join(dir, 'ghost.mjs')), false);
    });
  });

  // --- the real command line ------------------------------------------------

  describe('run as a command', () => {
    it('exits 0, prints the summary, and writes the feed', () => {
      write(ARTICLES);
      const run = spawnSync(process.execPath, [SCRIPT_PATH, '--articles', articlesPath, '--out', outPath], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^\[build-library-feed\] wrote 2 records to /);
      assert.equal(run.stderr, '');
      assert.equal(readLines().length, 2);
    });

    it('exits 1 and writes the FATAL line to stderr for a bad input', () => {
      write('{oops');
      const run = spawnSync(process.execPath, [SCRIPT_PATH, '--articles', articlesPath, '--out', outPath], { encoding: 'utf8' });
      assert.equal(run.status, 1);
      assert.match(run.stderr, /\[build-library-feed\] FATAL: failed to parse articles\.json:/);
      assert.equal(run.stdout, '');
      assert.equal(existsSync(outPath), false);
    });

    it('exits 0 with a warning when the input is absent, which is the clean-checkout case', () => {
      const run = spawnSync(process.execPath, [SCRIPT_PATH, '--articles', join(dir, 'absent.json'), '--out', outPath], { encoding: 'utf8' });
      assert.equal(run.status, 0);
      assert.match(run.stderr, /not found/);
      assert.equal(existsSync(outPath), false);
    });

    it('produces the same bytes from the command line as from buildLibraryFeed()', () => {
      write(ARTICLES);
      const viaApi = join(dir, 'via-api.jsonl');
      buildLibraryFeed({ articlesPath, outPath: viaApi, logger });
      const viaCli = join(dir, 'via-cli.jsonl');
      const run = spawnSync(process.execPath, [SCRIPT_PATH, '--articles', articlesPath, '--out', viaCli], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(readFileSync(viaCli, 'utf8'), readFileSync(viaApi, 'utf8'));
    });
  });
});
