// =============================================================================
// RRM Academy Design System — Figma Plugin
// =============================================================================
"use strict";

function hex(h) {
  const r = parseInt(h.slice(1, 3), 16) / 255;
  const g = parseInt(h.slice(3, 5), 16) / 255;
  const b = parseInt(h.slice(5, 7), 16) / 255;
  return { r, g, b };
}

function solidFill(h) {
  return [{ type: "SOLID", color: hex(h) }];
}

const COLORS = {
  purple: [
    { name: "Purple 900", hex: "#4c3e54", note: "Hover, emphasis", a11y: "9.9:1 AAA" },
    { name: "Purple 700", hex: "#725e7e", note: "Primary brand", a11y: "5.8:1 AA" },
    { name: "Purple 500", hex: "#987da8", note: "Secondary", a11y: "3.6:1 large only" },
    { name: "Purple 300", hex: "#c9b8d3", note: "Borders, tags" },
    { name: "Purple 100", hex: "#e8ddef", note: "Tinted bg" },
    { name: "Purple 50", hex: "#f5f0f8", note: "Hover bg" },
  ],
  neutral: [
    { name: "Neutral 900", hex: "#313131", note: "Primary text" },
    { name: "Neutral 700", hex: "#636261", note: "Secondary text" },
    { name: "Neutral 500", hex: "#949392", note: "Muted, disabled" },
    { name: "Neutral 300", hex: "#c6c4c2", note: "Borders, dividers" },
    { name: "Neutral 100", hex: "#f7f5f3", note: "Off-white bg" },
    { name: "White", hex: "#ffffff", note: "Page bg" },
  ],
  warm: [
    { name: "Cream", hex: "#eee5dd", note: "Warm section bg" },
    { name: "Sand 300", hex: "#dbcbbb", note: "Warm accent" },
    { name: "Sand 500", hex: "#b8a38f", note: "Warm medium" },
    { name: "Sand 700", hex: "#947353", note: "Warm dark" },
  ],
  rose: [
    { name: "Rose 700", hex: "#b0778a", note: "Rose dark" },
    { name: "Rose 500", hex: "#eb9fb8", note: "Rose medium" },
    { name: "Rose 300", hex: "#f5cdda", note: "Rose light" },
  ],
  sage: [
    { name: "Sage 700", hex: "#7e8772", note: "Sage dark" },
    { name: "Sage 300", hex: "#bec3b8", note: "Sage light" },
  ],
};

const TYPE_STYLES = [
  { name: "Display", family: "Cormorant Garamond", style: "SemiBold", size: 40, lh: 1.15, sample: "Stop Managing Symptoms. Start Restoring Health." },
  { name: "H1", family: "Cormorant Garamond", style: "SemiBold", size: 32, lh: 1.15, sample: "Restorative Reproductive Medicine" },
  { name: "H2", family: "Cormorant Garamond", style: "SemiBold", size: 28, lh: 1.15, sample: "Let\u2019s start with an analogy." },
  { name: "H3", family: "Cormorant Garamond", style: "SemiBold", size: 24, lh: 1.15, sample: "How RRM Works in Practice" },
  { name: "H4", family: "Cormorant Garamond", style: "SemiBold", size: 20, lh: 1.15, sample: "Masterclass in Endometriosis & Surgery" },
  { name: "Body Large", family: "Inter", style: "Regular", size: 18, lh: 1.75, sample: "RRM Academy is the leading educational platform for patients and professionals seeking to understand and apply Restorative Reproductive Medicine." },
  { name: "Body", family: "Inter", style: "Regular", size: 16, lh: 1.75, sample: "When the check engine light comes on in your car, you don\u2019t just put a piece of tape over it. You look under the hood to find out why the light is on." },
  { name: "Body Small", family: "Inter", style: "Regular", size: 14, lh: 1.75, sample: "All donations to the RRM Foundation, a 501(c)(3) non-profit, are tax-deductible. EIN: 93-4594315" },
  { name: "Caption", family: "Inter", style: "Regular", size: 12, lh: 1.5, sample: "Huang Y et al. Front Endocrinol (Lausanne). 2024." },
  { name: "Button", family: "Inter", style: "Medium", size: 14, lh: 1.5, sample: "Explore Courses" },
];

const SPACING = [
  { name: "spacing.1", px: 4 },
  { name: "spacing.2", px: 8 },
  { name: "spacing.3", px: 12 },
  { name: "spacing.4", px: 16 },
  { name: "spacing.6", px: 24 },
  { name: "spacing.8", px: 32 },
  { name: "spacing.12", px: 48 },
  { name: "spacing.16", px: 64 },
  { name: "spacing.24", px: 96 },
  { name: "spacing.32", px: 128 },
];

const RADII = [
  { name: "none", px: 0 },
  { name: "sm", px: 4 },
  { name: "md", px: 8 },
  { name: "lg", px: 16 },
  { name: "full", px: 32 },
];

const PAGE_W = 1440;
const SWATCH_W = 140;
const SWATCH_H_COLOR = 80;
const SECTION_GAP = 80;
const COL_GAP = 16;
const ROW_GAP = 12;

// =============================================================================
async function main() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });
  await figma.loadFontAsync({ family: "Inter", style: "Bold" });

  let cormorantLoaded = false;
  try {
    await figma.loadFontAsync({ family: "Cormorant Garamond", style: "SemiBold" });
    cormorantLoaded = true;
  } catch (e) {
    try {
      await figma.loadFontAsync({ family: "Cormorant Garamond SemiBold", style: "Regular" });
      cormorantLoaded = true;
    } catch (e2) {
      console.log("Cormorant Garamond not loaded \u2014 using Inter Bold as fallback. Add the font via Google Fonts in Figma to fix.");
    }
  }

  // Rename page
  const page = figma.currentPage;
  page.name = "Design System";

  let cursorY = 0;

  // --- Title ---
  const title = figma.createText();
  title.fontName = { family: "Inter", style: "Bold" };
  title.fontSize = 48;
  title.lineHeight = { value: 56, unit: "PIXELS" };
  title.characters = "RRM Academy Design System";
  title.fills = solidFill("#4c3e54");
  title.x = 0;
  title.y = cursorY;
  page.appendChild(title);
  cursorY += 64;

  const subtitle = figma.createText();
  subtitle.fontName = { family: "Inter", style: "Regular" };
  subtitle.fontSize = 18;
  subtitle.lineHeight = { value: 28, unit: "PIXELS" };
  subtitle.characters = "Colors \u00B7 Typography \u00B7 Buttons \u00B7 Spacing \u00B7 Radii \u00B7 Shadows";
  subtitle.fills = solidFill("#636261");
  subtitle.x = 0;
  subtitle.y = cursorY;
  page.appendChild(subtitle);
  cursorY += 60;

  // === COLORS ===
  cursorY = createSectionHeading(page, "Color Palette", cursorY);
  for (const [groupName, swatches] of Object.entries(COLORS)) {
    cursorY = createGroupLabel(page, groupName.charAt(0).toUpperCase() + groupName.slice(1), cursorY);
    cursorY = createSwatchRow(page, swatches, cursorY);
    cursorY += ROW_GAP;
  }
  cursorY += 8;
  cursorY = createNote(page, "Accessibility: Purple 700 (#725e7e) is the minimum for text on white \u2014 5.8:1 (AA). Purple 500 fails for body text. Purple 900 passes AAA at 9.9:1.", cursorY);

  // === TYPOGRAPHY ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Typography", cursorY);
  cursorY = createNote(page, "Fonts: Cormorant Garamond SemiBold (headings) + Inter Regular/Medium (body). Both free Google Fonts. Keep this pairing.", cursorY);
  cursorY += 16;
  for (const style of TYPE_STYLES) {
    cursorY = createTypeSpecimen(page, style, cursorY, cormorantLoaded);
    cursorY += 12;
  }

  // === BUTTONS ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Buttons", cursorY);

  cursorY = createGroupLabel(page, "Variants", cursorY);
  let btnX = 0;
  const btnY = cursorY;
  btnX = createButton(page, "Donate", "primary", btnX, btnY);
  btnX = createButton(page, "Find RRM Research", "secondary", btnX, btnY);
  btnX = createButton(page, "Learn More", "ghost", btnX, btnY);
  createButton(page, "Disabled", "disabled", btnX, btnY);
  cursorY += 56;

  cursorY = createGroupLabel(page, "Primary Hover State (fix from current site)", cursorY);
  let hoverX = 0;
  const hoverY = cursorY;
  hoverX = createButton(page, "Default  #725e7e", "primary", hoverX, hoverY);
  createButton(page, "Hover  #4c3e54", "primary-hover", hoverX, hoverY);
  cursorY += 56;

  cursorY = createGroupLabel(page, "Sizes", cursorY);
  let sizeX = 0;
  const sizeY = cursorY;
  sizeX = createButton(page, "Small", "small", sizeX, sizeY);
  sizeX = createButton(page, "Default", "primary", sizeX, sizeY);
  createButton(page, "Large", "large", sizeX, sizeY);
  cursorY += 64;

  cursorY = createNote(page, "Fix: Current site has identical default and hover colors (#725e7e). This system darkens to #4c3e54 on hover.", cursorY);

  // === SPACING ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Spacing Scale", cursorY);
  cursorY = createNote(page, "Base unit: 4px. All spacing is a multiple of 4.", cursorY);
  cursorY += 16;
  for (const sp of SPACING) {
    cursorY = createSpacingBar(page, sp.name, sp.px, cursorY);
  }

  // === BORDER RADIUS ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Border Radius", cursorY);
  cursorY += 8;
  let radiusX = 0;
  for (const r of RADII) {
    createRadiusDemo(page, r.name, r.px, radiusX, cursorY);
    radiusX += 100;
  }
  cursorY += 110;

  // === SHADOWS ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Shadows", cursorY);
  cursorY += 8;
  createShadowDemo(page, "sm", [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 1 }, radius: 3, spread: 0, visible: true, blendMode: "NORMAL" }], 0, cursorY);
  createShadowDemo(page, "md", [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 4 }, radius: 12, spread: 0, visible: true, blendMode: "NORMAL" }], 180, cursorY);
  cursorY += 130;

  // === SECTION BACKGROUNDS ===
  cursorY += SECTION_GAP;
  cursorY = createSectionHeading(page, "Section Backgrounds", cursorY);
  cursorY = createNote(page, "Standardize to these 4 options. No ad-hoc tints.", cursorY);
  cursorY += 16;
  const bgs = [
    { name: "White", hex: "#ffffff" },
    { name: "Neutral 100", hex: "#f7f5f3" },
    { name: "Purple 50", hex: "#f5f0f8" },
    { name: "Cream", hex: "#eee5dd" },
  ];
  let bgX = 0;
  for (const bg of bgs) {
    const rect = figma.createRectangle();
    rect.resize(200, 100);
    rect.x = bgX;
    rect.y = cursorY;
    rect.fills = solidFill(bg.hex);
    rect.strokes = solidFill("#c6c4c2");
    rect.strokeWeight = 1;
    rect.cornerRadius = 8;
    page.appendChild(rect);

    const label = figma.createText();
    label.fontName = { family: "Inter", style: "Regular" };
    label.fontSize = 12;
    label.characters = bg.name + "\n" + bg.hex;
    label.fills = solidFill("#313131");
    label.x = bgX + 12;
    label.y = cursorY + 40;
    page.appendChild(label);
    bgX += 220;
  }

  // Done
  figma.viewport.scrollAndZoomIntoView(page.children);
  figma.notify("\u2705 RRM Design System created!");
  // figma.closePlugin(); // Omit when running via Scripter
}

// =============================================================================
// Builders
// =============================================================================

function createSectionHeading(page, text, y) {
  const heading = figma.createText();
  heading.fontName = { family: "Inter", style: "Bold" };
  heading.fontSize = 28;
  heading.lineHeight = { value: 36, unit: "PIXELS" };
  heading.characters = text;
  heading.fills = solidFill("#313131");
  heading.x = 0;
  heading.y = y;
  page.appendChild(heading);

  const line = figma.createRectangle();
  line.resize(PAGE_W, 2);
  line.x = 0;
  line.y = y + 42;
  line.fills = solidFill("#c9b8d3");
  page.appendChild(line);
  return y + 56;
}

function createGroupLabel(page, text, y) {
  const label = figma.createText();
  label.fontName = { family: "Inter", style: "Medium" };
  label.fontSize = 12;
  label.lineHeight = { value: 16, unit: "PIXELS" };
  label.characters = text.toUpperCase();
  label.fills = solidFill("#949392");
  label.letterSpacing = { value: 1, unit: "PIXELS" };
  label.x = 0;
  label.y = y;
  page.appendChild(label);
  return y + 28;
}

function createSwatchRow(page, swatches, y) {
  let x = 0;
  for (const sw of swatches) {
    const colorRect = figma.createRectangle();
    colorRect.resize(SWATCH_W, SWATCH_H_COLOR);
    colorRect.x = x;
    colorRect.y = y;
    colorRect.fills = solidFill(sw.hex);
    colorRect.cornerRadius = 8;
    if (sw.hex === "#ffffff" || sw.hex === "#f7f5f3" || sw.hex === "#f5f0f8") {
      colorRect.strokes = solidFill("#c6c4c2");
      colorRect.strokeWeight = 1;
    }
    page.appendChild(colorRect);

    const nameLabel = figma.createText();
    nameLabel.fontName = { family: "Inter", style: "Medium" };
    nameLabel.fontSize = 11;
    nameLabel.characters = sw.name;
    nameLabel.fills = solidFill("#313131");
    nameLabel.x = x;
    nameLabel.y = y + SWATCH_H_COLOR + 6;
    page.appendChild(nameLabel);

    const hexLabel = figma.createText();
    hexLabel.fontName = { family: "Inter", style: "Regular" };
    hexLabel.fontSize = 10;
    hexLabel.characters = sw.hex;
    hexLabel.fills = solidFill("#949392");
    hexLabel.x = x;
    hexLabel.y = y + SWATCH_H_COLOR + 20;
    page.appendChild(hexLabel);

    if (sw.note) {
      const noteLabel = figma.createText();
      noteLabel.fontName = { family: "Inter", style: "Regular" };
      noteLabel.fontSize = 9;
      noteLabel.characters = sw.note;
      noteLabel.fills = solidFill("#949392");
      noteLabel.x = x;
      noteLabel.y = y + SWATCH_H_COLOR + 33;
      page.appendChild(noteLabel);
    }

    if (sw.a11y) {
      const badge = figma.createText();
      badge.fontName = { family: "Inter", style: "Medium" };
      badge.fontSize = 8;
      badge.characters = sw.a11y;
      badge.fills = solidFill(sw.a11y.includes("AAA") ? "#155724" : sw.a11y.includes("AA") ? "#155724" : "#856404");
      badge.x = x;
      badge.y = y + SWATCH_H_COLOR + 45;
      page.appendChild(badge);
    }
    x += SWATCH_W + COL_GAP;
  }
  return y + SWATCH_H_COLOR + 60;
}

function createTypeSpecimen(page, style, y, cormorantLoaded) {
  const isCormorant = style.family === "Cormorant Garamond";
  let fontName;
  if (isCormorant && cormorantLoaded) {
    fontName = { family: "Cormorant Garamond", style: "SemiBold" };
  } else if (isCormorant) {
    fontName = { family: "Inter", style: "Bold" };
  } else {
    fontName = { family: style.family, style: style.style };
  }

  const containerH = Math.max(style.size * style.lh + 40, 60);
  const container = figma.createRectangle();
  container.resize(PAGE_W, containerH);
  container.x = 0;
  container.y = y;
  container.fills = solidFill("#f7f5f3");
  container.cornerRadius = 8;
  page.appendChild(container);

  const sampleText = figma.createText();
  sampleText.fontName = fontName;
  sampleText.fontSize = style.size;
  sampleText.lineHeight = { value: style.size * style.lh, unit: "PIXELS" };
  sampleText.characters = style.sample;
  sampleText.fills = solidFill("#313131");
  sampleText.x = 16;
  sampleText.y = y + 12;
  sampleText.resize(PAGE_W - 32, style.size * style.lh + 4);
  sampleText.textAutoResize = "HEIGHT";
  page.appendChild(sampleText);

  const meta = figma.createText();
  meta.fontName = { family: "Inter", style: "Regular" };
  meta.fontSize = 11;
  meta.characters = style.name + "  \u2014  " + style.family + " " + style.style + " " + style.size + "px / " + style.lh;
  meta.fills = solidFill("#949392");
  meta.x = 16;
  meta.y = y + containerH - 20;
  page.appendChild(meta);

  return y + containerH;
}

function createButton(page, label, variant, x, y) {
  const paddingH = variant === "small" ? 16 : variant === "large" ? 32 : 24;
  const paddingV = variant === "small" ? 8 : variant === "large" ? 16 : 12;
  const fontSize = variant === "small" ? 12 : variant === "large" ? 16 : 14;

  const textNode = figma.createText();
  textNode.fontName = { family: "Inter", style: "Medium" };
  textNode.fontSize = fontSize;
  textNode.characters = label;

  const textW = textNode.width;
  const textH = textNode.height;
  const btnW = textW + paddingH * 2;
  const btnH = textH + paddingV * 2;

  const rect = figma.createRectangle();
  rect.resize(btnW, btnH);
  rect.x = x;
  rect.y = y;
  rect.cornerRadius = 8;

  switch (variant) {
    case "primary":
      rect.fills = solidFill("#725e7e");
      rect.strokes = solidFill("#725e7e");
      rect.strokeWeight = 2;
      textNode.fills = solidFill("#ffffff");
      break;
    case "primary-hover":
      rect.fills = solidFill("#4c3e54");
      rect.strokes = solidFill("#4c3e54");
      rect.strokeWeight = 2;
      textNode.fills = solidFill("#ffffff");
      break;
    case "secondary":
      rect.fills = solidFill("#ffffff");
      rect.strokes = solidFill("#725e7e");
      rect.strokeWeight = 2;
      textNode.fills = solidFill("#725e7e");
      break;
    case "ghost":
      rect.fills = [{ type: "SOLID", color: hex("#ffffff"), opacity: 0 }];
      rect.strokes = [];
      textNode.fills = solidFill("#725e7e");
      break;
    case "disabled":
      rect.fills = solidFill("#949392");
      rect.strokes = solidFill("#949392");
      rect.strokeWeight = 2;
      textNode.fills = solidFill("#ffffff");
      break;
    case "small":
    case "large":
      rect.fills = solidFill("#725e7e");
      rect.strokes = solidFill("#725e7e");
      rect.strokeWeight = 2;
      textNode.fills = solidFill("#ffffff");
      break;
  }

  page.appendChild(rect);
  textNode.x = x + paddingH;
  textNode.y = y + paddingV;
  page.appendChild(textNode);

  return x + btnW + 16;
}

function createSpacingBar(page, name, px, y) {
  const label = figma.createText();
  label.fontName = { family: "Inter", style: "Regular" };
  label.fontSize = 11;
  label.characters = name;
  label.fills = solidFill("#636261");
  label.x = 0;
  label.y = y + 4;
  page.appendChild(label);

  const pxLabel = figma.createText();
  pxLabel.fontName = { family: "Inter", style: "Regular" };
  pxLabel.fontSize = 11;
  pxLabel.characters = px + "px";
  pxLabel.fills = solidFill("#949392");
  pxLabel.x = 100;
  pxLabel.y = y + 4;
  page.appendChild(pxLabel);

  const bar = figma.createRectangle();
  bar.resize(Math.max(px, 4), 20);
  bar.x = 150;
  bar.y = y + 2;
  bar.fills = solidFill("#c9b8d3");
  bar.cornerRadius = 4;
  page.appendChild(bar);

  return y + 30;
}

function createRadiusDemo(page, name, px, x, y) {
  const box = figma.createRectangle();
  box.resize(64, 64);
  box.x = x + 10;
  box.y = y;
  box.fills = solidFill("#e8ddef");
  box.strokes = solidFill("#c9b8d3");
  box.strokeWeight = 2;
  box.cornerRadius = px;
  page.appendChild(box);

  const label = figma.createText();
  label.fontName = { family: "Inter", style: "Regular" };
  label.fontSize = 10;
  label.characters = name + "\n" + px + "px";
  label.fills = solidFill("#949392");
  label.textAlignHorizontal = "CENTER";
  label.x = x + 10;
  label.y = y + 72;
  page.appendChild(label);
}

function createShadowDemo(page, name, effects, x, y) {
  const box = figma.createRectangle();
  box.resize(140, 90);
  box.x = x;
  box.y = y;
  box.fills = solidFill("#ffffff");
  box.cornerRadius = 8;
  box.effects = effects;
  page.appendChild(box);

  const label = figma.createText();
  label.fontName = { family: "Inter", style: "Regular" };
  label.fontSize = 11;
  label.characters = "shadow." + name;
  label.fills = solidFill("#949392");
  label.x = x;
  label.y = y + 100;
  page.appendChild(label);
}

function createNote(page, text, y) {
  const bg = figma.createRectangle();
  bg.resize(PAGE_W, 40);
  bg.x = 0;
  bg.y = y;
  bg.fills = solidFill("#f7f5f3");
  bg.cornerRadius = 4;
  page.appendChild(bg);

  const accent = figma.createRectangle();
  accent.resize(3, 40);
  accent.x = 0;
  accent.y = y;
  accent.fills = solidFill("#725e7e");
  page.appendChild(accent);

  const noteText = figma.createText();
  noteText.fontName = { family: "Inter", style: "Regular" };
  noteText.fontSize = 12;
  noteText.lineHeight = { value: 18, unit: "PIXELS" };
  noteText.characters = text;
  noteText.fills = solidFill("#636261");
  noteText.x = 16;
  noteText.y = y + 11;
  noteText.resize(PAGE_W - 32, 18);
  noteText.textAutoResize = "HEIGHT";
  page.appendChild(noteText);

  return y + 52;
}

main();
