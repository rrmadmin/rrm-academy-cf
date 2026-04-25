// Combined unit tests for markdown-sanitize.ts + html-sanitize.ts.
// Run: npx tsx ./sanitize-test.mjs
// Exit non-zero on any assertion failure.

import { sanitizeMarkdown, parseMarkdown, looksLikeMarkdown } from './src/lib/markdown-sanitize.mjs';
import { sanitizeHtml, looksDirty } from './src/lib/html-sanitize.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function eq(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    failures.push({ name, actual, expected });
    console.log(`  FAIL ${name}`);
    console.log(`       expected: ${JSON.stringify(expected)}`);
    console.log(`       actual:   ${JSON.stringify(actual)}`);
  }
}

function contains(name, actual, needle) {
  const ok = typeof actual === 'string' && actual.includes(needle);
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    failures.push({ name, actual, expected: `(includes ${JSON.stringify(needle)})` });
    console.log(`  FAIL ${name}`);
    console.log(`       expected substring: ${JSON.stringify(needle)}`);
    console.log(`       actual:             ${JSON.stringify(actual)}`);
  }
}

function notContains(name, actual, needle) {
  const ok = typeof actual === 'string' && !actual.includes(needle);
  if (ok) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    failures.push({ name, actual, expected: `(does NOT include ${JSON.stringify(needle)})` });
    console.log(`  FAIL ${name}`);
    console.log(`       must not include: ${JSON.stringify(needle)}`);
    console.log(`       actual:           ${JSON.stringify(actual)}`);
  }
}

console.log('\n== markdown-sanitize ==');

eq('empty input', sanitizeMarkdown(''), '');
eq('null guard via empty string', sanitizeMarkdown(''), '');

eq(
  'ghost link removed',
  sanitizeMarkdown('hello [ ](https://example.com) world'),
  'hello  world'
);

eq(
  'bold-wrapped link unwrapped',
  sanitizeMarkdown('see **[click](https://x.com)** here'),
  'see [click](https://x.com) here'
);

eq(
  'orphan ** at line start removed',
  sanitizeMarkdown('**[click](https://x.com)***'),
  '[click](https://x.com)***'
);

eq(
  'balanced inline bold preserved',
  sanitizeMarkdown('**bold text** rest'),
  '**bold text** rest'
);

eq(
  'missing space before link',
  sanitizeMarkdown('word[click](https://x.com)'),
  'word [click](https://x.com)'
);

eq(
  'missing space after link',
  sanitizeMarkdown('[click](https://x.com)word'),
  '[click](https://x.com) word'
);

eq(
  'heading missing space',
  sanitizeMarkdown('##Hello'),
  '## Hello'
);

eq(
  'heading with redundant bold',
  sanitizeMarkdown('## **Title**'),
  '## Title'
);

const md1 = await parseMarkdown('a [link](https://example.com) here');
contains('parseMarkdown emits anchor', md1, '<a href="https://example.com">link</a>');

const md2 = await parseMarkdown('a [bad](javascript:alert(1)) here');
notContains('parseMarkdown drops javascript:', md2, 'href="javascript');

const md3 = await parseMarkdown('![alt\'s](https://example.com/img.png)');
contains('parseMarkdown escapes apostrophe in alt', md3, '&#39;');

eq('looksLikeMarkdown bold true', looksLikeMarkdown('this is **bold** text'), true);
eq('looksLikeMarkdown link true', looksLikeMarkdown('see [link](url)'), true);
eq('looksLikeMarkdown plain false', looksLikeMarkdown('just plain prose with no markup at all'), false);
eq('looksLikeMarkdown empty false', looksLikeMarkdown(''), false);

console.log('\n== html-sanitize ==');

eq('html empty', sanitizeHtml(''), '');

eq(
  'remove empty p',
  sanitizeHtml('<p>hello</p><p></p><p>world</p>'),
  '<p>hello</p><p>world</p>'
);

eq(
  'remove p with nbsp',
  sanitizeHtml('<p>hello</p><p>&nbsp;</p><p>world</p>'),
  '<p>hello</p><p>world</p>'
);

eq(
  'remove p with br',
  sanitizeHtml('<p>hello</p><p><br></p><p>world</p>'),
  '<p>hello</p><p>world</p>'
);

eq(
  'strip Word o:p',
  sanitizeHtml('<p>text<o:p></o:p></p>'),
  '<p>text</p>'
);

eq(
  'strip font tag',
  sanitizeHtml('<p><font color="red">red</font></p>'),
  '<p>red</p>'
);

eq(
  'strip MsoNormal class',
  sanitizeHtml('<p class="MsoNormal">word</p>'),
  '<p>word</p>'
);

eq(
  'decode double-encoded amp',
  sanitizeHtml('Tom &amp;amp; Jerry'),
  'Tom &amp; Jerry'
);

eq(
  'collapse repeated nbsp',
  sanitizeHtml('hello&nbsp;&nbsp;&nbsp;world'),
  'hello world'
);

const dangerHref = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
contains('javascript href neutralized', dangerHref, 'href="#"');
notContains('javascript href stripped from output', dangerHref, 'javascript:');

const dangerImg = sanitizeHtml('<img src="javascript:alert(1)">');
notContains('javascript src stripped', dangerImg, 'javascript:');

const scriptStripped = sanitizeHtml('<p>before</p><script>alert(1)</script><p>after</p>');
notContains('script tag removed', scriptStripped, '<script');
notContains('script body removed', scriptStripped, 'alert(1)');

const onclickStripped = sanitizeHtml('<a href="https://example.com" onclick="alert(1)">x</a>');
notContains('onclick handler removed', onclickStripped, 'onclick');
contains('href preserved', onclickStripped, 'href="https://example.com"');

eq('looksDirty empty p', looksDirty('<p>x</p><p></p>'), true);
eq('looksDirty word artifact', looksDirty('<p class="MsoNormal">x</p>'), true);
eq('looksDirty double-encoded', looksDirty('A &amp;amp; B'), true);
eq('looksDirty clean text', looksDirty('<p>nothing wrong here</p>'), false);
eq('looksDirty empty', looksDirty(''), false);
eq('looksDirty null', looksDirty(null), false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) {
  process.exit(1);
}
