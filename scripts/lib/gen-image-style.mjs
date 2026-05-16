/**
 * gen-image-style.mjs -- RRM Academy medical-illustration prompt assembly.
 *
 * Pure module: no file IO, no network. Holds the RRM Academy illustration
 * house style and assembles gpt-image-2 prompts. Imported by
 * scripts/gen-image.mjs; unit-tested by test/gen-image-prompt.test.mjs.
 *
 * The house style is realistic artistic medical illustration, in two registers:
 *
 *   'anatomical' -- a realistic medical-atlas plate of an anatomical structure
 *                   or physiological process, naturalistic tissue tones, set on
 *                   a solid RRM Academy brand-purple background, with clean
 *                   off-white labels and thin leader lines.
 *   'scene'      -- a realistic, soft-edged painterly watercolour scene of a
 *                   person, couple, or object, the edges dissolving into a
 *                   plain off-white ground, no labels.
 *
 * Each gpt-image-2 call is stateless, so the full house-style block is sent
 * every time.
 */

// RRM Academy brand purple (--purple-700 in the site design system).
export const BRAND_PURPLE = '#725e7e';

export const DEFAULT_REGISTER = 'scene';

// --- people (scene register only) -------------------------------------------

export const PEOPLE =
  'Draw every person as a realistic adult of reproductive age. Women appear in ' +
  'their late twenties to early forties; men in their thirties to forties. ' +
  'Never depict teenagers, adolescents, or anyone who looks under twenty-five. ' +
  'Vary appearance, hair colour, and hairstyle deliberately from image to ' +
  'image; do not default to a messy top-bun. Where two people appear, draw ' +
  'them as a couple. Draw a general adult population -- do not lock to any ' +
  'single ethnicity unless a scene specifies one. Real adult faces and ' +
  'accurate proportions; hands drawn carefully and correctly with five ' +
  'fingers in natural positions.';

export const FIGURES = {
  one: 'one person only',
  couple: 'two people only, a couple together',
  two: 'two people only',
  'still-life': 'no people at all; this is an object-only still life',
};

// --- the two registers of the house style -----------------------------------

export const REGISTERS = {
  anatomical: {
    intro:
      "Create a realistic medical illustration for a women's health education " +
      'website.',
    mood:
      'calm, dignified, and clinically respectful -- the quiet authority of a ' +
      'fine medical atlas. Accurate and educational, never alarming, cold, or ' +
      'distressing.',
    style:
      'a realistic artistic medical illustration in the tradition of a ' +
      'professional medical illustrator -- the painted-plate register of a ' +
      'classic anatomical atlas. Rendered in soft watercolour and gouache with ' +
      'accurate, controlled draughtsmanship: structures are anatomically ' +
      'precise, three-dimensional, and convincingly modelled with believable ' +
      'light and depth. Realistic and substantial -- never flat, loose, ' +
      'sketchy, diagrammatic, cartoonish, or vector. The finish is that of a ' +
      'fine hand-painted medical plate.',
    color:
      'render the anatomy itself in true, naturalistic tissue tones -- do not ' +
      'tint, stylise, or recolour the structures with any brand colour. Place ' +
      'the study on a standard plain white background. Brand colour appears ' +
      'ONLY in the labels: each label sits in its own small, rounded, solid ' +
      'RRM Academy brand-purple chip (hex #725e7e) with the label text in ' +
      'clean white; leader lines are thin and a muted purple.',
    composition:
      'a single, clearly described anatomical study, centred with a generous ' +
      'even margin on a plain white background. Add a small number of clean, ' +
      'simple labels naming only the principal structures; set each label as ' +
      'white text inside a small rounded solid brand-purple chip, joined to ' +
      'its structure by a thin, straight muted-purple leader line. No other ' +
      'objects and no decorative elements.',
    avoid:
      'photographic tissue close-ups, surgical or operative imagery, blood, ' +
      'gore, wounds, and distressing pathology; glossy corporate vector ' +
      'style, flat diagram style, and cartoon style',
  },
  scene: {
    intro:
      "Create a realistic, soft painterly illustration for a women's health " +
      'education website.',
    mood:
      'patient-centered, trauma-informed, gentle, dignified, and quietly ' +
      'hopeful. The subject is calm and composed, never performing sadness or ' +
      'distress for the viewer. They appear respected, emotionally safe, and ' +
      'met where they are: not overwhelmed, not dramatized, not reduced to a ' +
      'condition. Hopeful but never falsely triumphant.',
    style:
      'a realistic artistic illustration rendered in soft watercolour and ' +
      'gouache, in the warm, painterly hand of a fine illustrator. Forms are ' +
      'realistic and accurately proportioned with believable light and depth, ' +
      'but the edges are deliberately soft and undefined: the subject and the ' +
      'ground bleed gently together at their borders, with no hard outline, ' +
      'no crisp cut-out edge, and softly feathered watercolour transitions. ' +
      'Naturalistic and substantial, never flat, vector, or cartoonish; the ' +
      'warmth of a hand-painted picture, never a photograph.',
    color:
      'a restrained, naturalistic, muted palette -- true skin, hair, fabric, ' +
      'and material tones, low in saturation, dignified and quiet. Never ' +
      'bright, glossy, neon, or oversaturated.',
    composition:
      'the subject centred on a plain, soft off-white ground into which the ' +
      "illustration's outer edges dissolve. Only the few props essential to " +
      'the meaning -- nothing more. Generous, calm, empty space around the ' +
      'subject. No text, no labels, no clutter, and no detailed background or ' +
      'room scene',
  },
};

// Baby imagery is banned by default in the scene register (surveyed
// infertility patients report newborn imagery as triggering); overridable
// per-image with allowInfant.
export const BABY_AVOID =
  'babies, newborns, infants, and pregnancy-announcement or birth imagery';

// Scene-register avoid list (the anatomical register carries its own in
// REGISTERS.anatomical.avoid).
export const SCENE_AVOID =
  'tears, dramatic suffering, grief symbolism, and curled-up-in-pain cliches; ' +
  'medical exam imagery and hospital scenes; clinical protocol diagrams, drug ' +
  'or dosing imagery, and medication or pill close-ups; glossy corporate ' +
  'vector style and cartoon style; hard outlines and crisp cut-out edges';

// --- prompt assembly --------------------------------------------------------

export function buildPrompt({
  topic,
  scene,
  register = DEFAULT_REGISTER,
  mood,
  figures = 'one',
  avoid,
  allowInfant = false,
}) {
  const reg = REGISTERS[register];
  if (!reg) {
    throw new Error(
      `unknown register: ${register} (expected one of ${Object.keys(REGISTERS).join(', ')})`,
    );
  }

  const lines = [reg.intro, `Topic: ${topic}.`, `Scene: ${scene}`];

  if (register === 'anatomical') {
    lines.push(
      `Mood: ${mood || reg.mood}`,
      `Style: ${reg.style}`,
      `Color: ${reg.color}`,
      `Composition: ${reg.composition}`,
      `Avoid: ${[avoid, reg.avoid].filter(Boolean).join('; ')}.`,
    );
    return lines.join('\n\n');
  }

  // scene register
  if (figures !== 'still-life') lines.push(`People: ${PEOPLE}`);
  const figureClause = FIGURES[figures] || FIGURES.one;
  const avoidParts = [avoid, allowInfant ? null : BABY_AVOID, SCENE_AVOID].filter(Boolean);
  lines.push(
    `Mood: ${mood || reg.mood}`,
    `Style: ${reg.style}`,
    `Color: ${reg.color}`,
    `Composition: ${figureClause}, then ${reg.composition}.`,
    `Avoid: ${avoidParts.join('; ')}.`,
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
