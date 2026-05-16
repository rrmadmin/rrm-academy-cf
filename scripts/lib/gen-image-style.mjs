/**
 * gen-image-style.mjs -- RRM Academy spot-illustration prompt assembly.
 *
 * Pure module: no file IO, no network. Holds the fixed RRM house-style prompt
 * blocks, the four Phase-1 style directions, and prompt/arg builders. Imported
 * by scripts/gen-image.mjs and unit-tested by test/gen-image-prompt.test.mjs.
 *
 * Each gpt-image-2 call is stateless, so the full house-style block is sent
 * every time.
 */

// --- fixed RRM house-style blocks -------------------------------------------

export const INTRO =
  "Create a minimal editorial spot illustration for a women's health education website.";

export const DEFAULT_MOOD =
  'patient-centered, trauma-informed, gentle, dignified, and quietly hopeful. ' +
  'The subject is calm and composed, never performing sadness or distress for ' +
  'the viewer. They appear respected, emotionally safe, and met where they are: ' +
  'not overwhelmed, not dramatized, not reduced to a condition. Hopeful but ' +
  'never falsely triumphant. The feeling is one of being understood, supported, ' +
  'and given real information.';

// RRM Academy serves a general (US-leaning) education audience and uses
// couple-centered language -- not a single-clinic demographic.
export const PEOPLE =
  'Draw every person as a realistic adult of reproductive age. Women appear in ' +
  'their late twenties to early forties; men in their thirties to forties. ' +
  'Never depict teenagers, adolescents, or anyone who looks under twenty-five. ' +
  'Vary appearance, hair colour, and hairstyle deliberately from image to ' +
  'image; do not default to a messy top-bun. Where two people appear, draw ' +
  'them as a couple. Draw a general adult population -- do not lock to any ' +
  'single ethnicity unless a scene specifies one.';

export const COMPOSITION_TAIL =
  'and ONLY the few props essential to the meaning -- nothing more. Keep it ' +
  'lightweight and scannable: a small spot illustration, never a full or busy ' +
  'scene. No detailed background, no room scene, no windowsills, no scattered ' +
  'plants or set dressing, no text, no clutter. Plain white background, ' +
  'generous empty white space around the subject. Must read clearly and ' +
  'instantly at small card size.';

export const DEFAULT_TOPIC_AVOID =
  'tears, dramatic suffering, grief symbolism, and curled-up-in-pain cliches.';

// Baby imagery is banned by default (surveyed infertility patients report
// newborn imagery as triggering); overridable per-image with allowInfant.
export const BABY_AVOID =
  'babies, newborns, infants, and pregnancy-announcement or birth imagery; ';

// Universal, never overridable. Includes the RRM Academy public-page rule
// against protocol and dosing visuals.
export const CORE_AVOID_BASE =
  'medical exam imagery and hospital scenes; clinical protocol diagrams, drug ' +
  'or dosing imagery, and medication or pill close-ups; gradients, glossy ' +
  'corporate vector style, and cartoon style; and busy or cluttered backgrounds.';

export const FIGURES = {
  one: 'one person only',
  couple: 'two people only, a couple seated together',
  two: 'two people only',
  'still-life': 'no people in the image at all; this is an object-only still life',
};

// --- the four Phase-1 style directions --------------------------------------
// One of these is chosen during Phase 1 bootstrapping; DEFAULT_STYLE is then
// repointed to the winner (see the implementation plan, Task 6).

export const STYLE_DIRECTIONS = {
  A: {
    label: 'editorial-linework-purple',
    style:
      'hand-drawn editorial spot illustration: thin ink linework with slightly ' +
      'irregular, organic strokes, drawn in deep aubergine and charcoal rather ' +
      'than pure black, with soft light colour applied as a faint ' +
      'coloured-pencil and watercolour wash. Illustrative, never photographic ' +
      '-- no realistic skin shading, no realistic material texture -- but the ' +
      'linework is confident and competent, the register of an assured ' +
      'editorial illustrator, never crude or blobby. People are clearly mature ' +
      'adults in their thirties and forties with believable adult faces and ' +
      'proportions; hands are drawn carefully and anatomically correctly, real ' +
      'adult hands with five fingers in natural positions. Compact centred ' +
      'composition, lots of white space.',
    color:
      'linework in deep aubergine and charcoal; tiny muted accent colour only ' +
      '-- brand purple, a pale purple tint, warm cream, and natural skin ' +
      'tones. Keep colour very sparse and desaturated, a muted e-ink paper register.',
  },
  B: {
    label: 'monoline-duotone',
    style:
      'clean monoline illustration: a single consistent line weight ' +
      'throughout, smooth and even, with no sketchy or irregular strokes. Calm ' +
      'and geometric-leaning but still warm, not cold or corporate. Flat and ' +
      'minimal -- no shading, no texture, no wash. People are mature adults in ' +
      'their thirties and forties drawn as simple confident shapes with ' +
      'believable proportions; hands are drawn carefully with five fingers in ' +
      'natural positions. Compact centred composition, lots of white space.',
    color:
      'duotone only: all linework in a single brand purple on a plain ' +
      'warm-paper background, with at most one flat fill of a pale purple ' +
      'tint. No other colour, no gradients.',
  },
  C: {
    label: 'engraving-crosshatch',
    style:
      'fine engraving-style illustration in the register of a vintage ' +
      'scientific or anatomical plate: precise parallel hatching and ' +
      'cross-hatching builds all form and shadow, with thin, controlled, even ' +
      'linework and no flat colour fills and no wash. Restrained, exact, and ' +
      'quietly authoritative. People are mature adults in their thirties and ' +
      'forties with accurate faces and proportions; hands are drawn carefully ' +
      'and anatomically correctly with five fingers in natural positions. ' +
      'Compact centred composition, lots of white space.',
    color:
      'near-monochrome: all linework and hatching in deep aubergine. At most a ' +
      'single faint flat tint of warm cream behind the subject. No other colour.',
  },
  D: {
    label: 'watercolor-wash',
    style:
      'soft watercolour illustration: gentle, loose washes of muted colour are ' +
      'the primary medium, with only minimal thin ink linework where ' +
      'definition is needed. Edges are soft and slightly bleeding, never ' +
      'hard-edged or vector-clean. Warm, quiet, and unhurried. People are ' +
      'mature adults in their thirties and forties with believable adult faces ' +
      'and proportions; hands are drawn carefully with five fingers in natural ' +
      'positions. Compact centred composition, lots of white space.',
    color:
      'muted, desaturated washes only -- soft brand purple, warm cream, gentle ' +
      'neutral greys, and natural skin tones. Low saturation throughout, a ' +
      'muted e-ink paper register. No bright, glossy, or saturated colour.',
  },
};

// Phase-1 default. After the house style is chosen, repoint this to the
// winning direction (Task 6).
export const DEFAULT_STYLE = 'A';

// --- prompt assembly --------------------------------------------------------

export function buildPrompt({
  topic,
  scene,
  style = DEFAULT_STYLE,
  mood = DEFAULT_MOOD,
  figures = 'one',
  avoid,
  allowInfant = false,
}) {
  const dir = STYLE_DIRECTIONS[style];
  if (!dir) {
    throw new Error(
      `unknown style direction: ${style} (expected one of ${Object.keys(STYLE_DIRECTIONS).join(', ')})`,
    );
  }
  const figureClause = FIGURES[figures] || FIGURES.one;
  const topicAvoid = avoid || DEFAULT_TOPIC_AVOID;
  const stillLife = figures === 'still-life';

  const lines = [INTRO, `Topic: ${topic}.`, `Scene: ${scene}`];
  if (!stillLife) lines.push(`People: ${PEOPLE}`);
  lines.push(
    `Mood: ${mood}`,
    `Style: ${dir.style}`,
    `Color: ${dir.color}`,
    `Composition: ${figureClause}, ${COMPOSITION_TAIL}`,
    `Avoid: ${topicAvoid} In every image also avoid ${(allowInfant ? '' : BABY_AVOID) + CORE_AVOID_BASE}`,
  );
  return lines.join('\n\n');
}

// --- arg parsing ------------------------------------------------------------
// Boolean flags take no value; every other --key consumes the next token.

const FLAGS = new Set(['no-style-ref', 'allow-infant', 'dry-run']);

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k || !k.startsWith('--')) throw new Error(`bad arg: ${k}`);
    const key = k.slice(2);
    if (FLAGS.has(key)) {
      a[key] = true;
    } else {
      if (++i >= argv.length) throw new Error(`--${key} requires a value`);
      a[key] = argv[i];
    }
  }
  return a;
}
