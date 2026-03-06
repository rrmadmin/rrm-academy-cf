// =============================================================================
// RRM Academy Homepage Mockup — Figma Scripter Script
// Goal: Consistent design system application, NOT conversion optimization.
// Same content & vibe as current site, just with uniform typography, spacing,
// and color tokens. Trust-focused, educational tone.
// =============================================================================
"use strict";

var C = {
  purple900: "#4c3e54", purple700: "#725e7e", purple300: "#c9b8d3",
  purple50: "#f5f0f8",
  neutral900: "#313131", neutral700: "#636261", neutral500: "#949392",
  neutral300: "#c6c4c2", neutral100: "#f7f5f3", white: "#ffffff",
  cream: "#eee5dd",
};

var PAGE_W = 1440;
var CX = 120, CW = 1200;
var TW = 800, TX = 320; // narrower text column for readability
var HF = { family: "Cormorant Garamond", style: "SemiBold" };

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hex(h) {
  return { r: parseInt(h.slice(1,3),16)/255, g: parseInt(h.slice(3,5),16)/255, b: parseInt(h.slice(5,7),16)/255 };
}
function fill(h) { return [{ type: "SOLID", color: hex(h) }]; }

function txt(chars, o) {
  if (!o) o = {};
  var t = figma.createText();
  t.fontName = { family: o.family || "Inter", style: o.style || "Regular" };
  t.fontSize = o.size || 16;
  if (o.lh) t.lineHeight = { value: o.lh, unit: "PIXELS" };
  t.characters = chars;
  t.fills = fill(o.color || C.neutral900);
  if (o.align) t.textAlignHorizontal = o.align;
  if (o.tracking) t.letterSpacing = { value: o.tracking, unit: "PIXELS" };
  return t;
}

function ptxt(parent, chars, x, y, w, o) {
  var t = txt(chars, o);
  t.x = x; t.y = y;
  if (w) { t.resize(w, 20); t.textAutoResize = "HEIGHT"; }
  parent.appendChild(t);
  return t;
}

function makeFrame(name, bg) {
  var f = figma.createFrame();
  f.name = name;
  f.resize(PAGE_W, 10);
  f.fills = fill(bg);
  return f;
}

function btn(label, variant) {
  var b = figma.createFrame();
  b.layoutMode = "HORIZONTAL";
  b.primaryAxisSizingMode = "AUTO";
  b.counterAxisSizingMode = "AUTO";
  b.primaryAxisAlignItems = "CENTER";
  b.counterAxisAlignItems = "CENTER";
  b.cornerRadius = 8;
  b.paddingTop = 12; b.paddingBottom = 12;
  b.paddingLeft = 24; b.paddingRight = 24;
  var tc = C.white;
  if (variant === "secondary") {
    b.fills = fill(C.white); b.strokes = fill(C.purple700); b.strokeWeight = 2; tc = C.purple700;
  } else {
    b.fills = fill(C.purple700); b.strokes = fill(C.purple700); b.strokeWeight = 2;
  }
  b.appendChild(txt(label, { style: "Medium", size: 14, color: tc }));
  return b;
}

function placeBtns(parent, y, btns, center) {
  var row = figma.createFrame();
  row.layoutMode = "HORIZONTAL";
  row.primaryAxisSizingMode = "AUTO";
  row.counterAxisSizingMode = "AUTO";
  row.itemSpacing = 16;
  row.fills = [];
  for (var i = 0; i < btns.length; i++) row.appendChild(btns[i]);
  row.y = y;
  parent.appendChild(row);
  if (center) row.x = TX + Math.max(0, (TW - row.width) / 2);
  else row.x = TX;
  return row.height || 46;
}

// ─── Section Builders ────────────────────────────────────────────────────────

function buildNav() {
  var s = figma.createFrame();
  s.name = "Nav";
  s.layoutMode = "HORIZONTAL";
  s.primaryAxisSizingMode = "FIXED";
  s.counterAxisSizingMode = "AUTO";
  s.resize(PAGE_W, 10);
  s.paddingTop = 20; s.paddingBottom = 20;
  s.paddingLeft = CX; s.paddingRight = CX;
  s.primaryAxisAlignItems = "SPACE_BETWEEN";
  s.counterAxisAlignItems = "CENTER";
  s.fills = fill(C.white);

  s.appendChild(txt("RRM Academy", { family: HF.family, style: HF.style, size: 24, lh: 28, color: C.purple900 }));

  var links = figma.createFrame();
  links.layoutMode = "HORIZONTAL";
  links.primaryAxisSizingMode = "AUTO";
  links.counterAxisSizingMode = "AUTO";
  links.itemSpacing = 32;
  links.fills = [];
  links.counterAxisAlignItems = "CENTER";
  var items = ["Research Library", "Commentary", "Courses", "About"];
  for (var i = 0; i < items.length; i++)
    links.appendChild(txt(items[i], { style: "Medium", size: 14, color: C.neutral700 }));
  links.appendChild(txt("Log In", { style: "Medium", size: 14, color: C.purple700 }));
  links.appendChild(btn("Donate"));
  s.appendChild(links);
  return s;
}

function buildHero() {
  var s = makeFrame("Hero", C.purple50);
  var y = 96;

  var h1 = ptxt(s, "Stop Managing Symptoms.\nStart Restoring Health.", TX, y, TW,
    { family: HF.family, style: HF.style, size: 40, lh: 46, color: C.purple900, align: "CENTER" });
  y += h1.height + 24;

  var sub = ptxt(s, "Have you ever been told your painful periods are \u201Cnormal\u201D? That birth control is your only option? Or that IVF is your only path to pregnancy? You are not alone. And you deserve better.", TX, y, TW,
    { size: 18, lh: 31.5, color: C.neutral700, align: "CENTER" });
  y += sub.height + 32;

  var bh = placeBtns(s, y, [btn("Explore Courses"), btn("Find RRM Research", "secondary")], true);
  y += bh + 96;

  s.resize(PAGE_W, y);
  return s;
}

function buildIntro() {
  var s = makeFrame("Intro", C.white);
  var y = 64;

  var p = ptxt(s, "RRM Academy is the leading educational platform for patients and professionals seeking to understand and apply Restorative Reproductive Medicine (RRM). Guided by the expertise of our founder, Dr. Naomi Whittaker, and a community of RRM-trained professionals, we provide the evidence-based tools to find the root cause of your health issues and restore your body to its natural, healthy function.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += p.height + 64;

  s.resize(PAGE_W, y);
  return s;
}

function buildAnalogy() {
  var s = makeFrame("Analogy", C.white);
  var y = 64;

  // Divider at top
  var div = figma.createRectangle();
  div.resize(TW, 1); div.x = TX; div.y = y;
  div.fills = fill(C.neutral300);
  s.appendChild(div);
  y += 64;

  var h = ptxt(s, "Let\u2019s start with an analogy.", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900 });
  y += h.height + 24;

  var p1 = ptxt(s, "When the check engine light comes on in your car, you don\u2019t just put a piece of tape over it. You look under the hood to find out why the light is on. For over 50 years, women\u2019s healthcare has been putting tape over the check engine light.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += p1.height + 24;

  var p2 = ptxt(s, "So, what\u2019s the alternative? It\u2019s an approach called Restorative Reproductive Medicine (RRM). RRM isn\u2019t a single treatment; it\u2019s a medical and surgical model of care that works cooperatively with your body. It investigates the fundamental \u201Cwhy\u201D behind your symptoms. By identifying and treating the underlying cause, we can restore your body\u2019s natural, healthy function. RRM is not about symptom suppression. It\u2019s about authentic healing.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += p2.height + 64;

  s.resize(PAGE_W, y);
  return s;
}

function buildHowItWorks() {
  var s = makeFrame("How RRM Works", C.white);
  var y = 64;

  var div = figma.createRectangle();
  div.resize(TW, 1); div.x = TX; div.y = y;
  div.fills = fill(C.neutral300);
  s.appendChild(div);
  y += 64;

  var h = ptxt(s, "How RRM Works in Practice", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900 });
  y += h.height + 24;

  var intro = ptxt(s, "It\u2019s a progressive process, and it starts with listening. Our educational philosophy is built on a simple idea: you deserve to understand your body.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += intro.height + 32;

  var steps = [
    { title: "First, we identify the cause.", body: "Your body\u2019s signals\u2014the painful periods, the irregular cycles\u2014are the clues that have likely been ignored. We teach you how to chart your cycle, turning your experiences into valuable data. For a NaPro-trained OB/GYN, that chart is like an EKG for a cardiologist." },
    { title: "Then, we treat the condition.", body: "Once we know the \u201Cwhy,\u201D we can discover targeted medical and surgical treatments that address the underlying disease. If you have endometriosis, the goal isn\u2019t just to manage pain; it\u2019s to skillfully resect the disease itself." },
    { title: "Next, we restore normal function.", body: "The ultimate goal is to restore your body\u2019s natural hormonal balance and reproductive function. A healthy system is a fertile system. This approach can lead to improved fertility and healthier pregnancies because we\u2019ve fixed the broken pipe instead of just using buckets." },
    { title: "Finally, we cooperate with the body.", body: "RRM works in harmony with your natural cycle. You will learn to understand and appreciate your body\u2019s intricate design, becoming an active, empowered partner in your own healthcare journey." },
  ];

  for (var i = 0; i < steps.length; i++) {
    var st = ptxt(s, steps[i].title, TX, y, TW,
      { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
    y += st.height + 12;
    var sb = ptxt(s, steps[i].body, TX, y, TW,
      { size: 16, lh: 28, color: C.neutral700 });
    y += sb.height + 32;
  }

  y += 32;
  s.resize(PAGE_W, y);
  return s;
}

function buildComparison() {
  var s = makeFrame("Comparison", C.neutral100);
  var y = 96;

  var h = ptxt(s, "A Different Path: Fixing the Problem, Not Just Catching the Leak", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900 });
  y += h.height + 16;

  var sub = ptxt(s, "Understanding your options is the first step toward empowerment.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += sub.height + 40;

  // Two columns
  var colGap = 48;
  var colW = Math.floor((CW - colGap) / 2);
  var c1x = CX, c2x = CX + colW + colGap;

  var h1 = ptxt(s, "The RRM Approach", c1x, y, colW,
    { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
  var h2 = ptxt(s, "The Conventional Approach", c2x, y, colW,
    { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
  y += Math.max(h1.height, h2.height) + 16;

  var b1 = ptxt(s, "\u2022  Primary Goal: Identify and treat the root cause of the problem.\n\n\u2022  Focus: Restoring the body to its normal, healthy function.\n\n\u2022  Your Role: You are an active, educated partner in your healthcare journey.", c1x, y, colW,
    { size: 14, lh: 24.5, color: C.neutral700 });
  var b2 = ptxt(s, "\u2022  Primary Goal: Suppress symptoms or bypass the problem (e.g., IVF).\n\n\u2022  Focus: Managing the condition or achieving a specific outcome.\n\n\u2022  Your Role: You are often a passive recipient of a standardized protocol.", c2x, y, colW,
    { size: 14, lh: 24.5, color: C.neutral700 });
  y += Math.max(b1.height, b2.height) + 96;

  s.resize(PAGE_W, y);
  return s;
}

function buildAudience() {
  var s = makeFrame("Audience", C.white);
  var y = 96;

  var h = ptxt(s, "You Are in the Right Place", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900, align: "CENTER" });
  y += h.height + 16;

  var sub = ptxt(s, "Our educational resources are designed to meet you exactly where you are on your health journey.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700, align: "CENTER" });
  y += sub.height + 40;

  var colGap = 48;
  var colW = Math.floor((CW - colGap) / 2);
  var c1x = CX, c2x = CX + colW + colGap;

  var h1 = ptxt(s, "For Patients & Individuals", c1x, y, colW,
    { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
  var h2 = ptxt(s, "For Medical Professionals", c2x, y, colW,
    { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
  y += Math.max(h1.height, h2.height) + 16;

  var b1 = ptxt(s, "You are in the right place if you are experiencing:\n\n\u2022  Infertility or subfertility\n\u2022  Recurrent miscarriage\n\u2022  Painful or irregular cycles\n\u2022  Conditions like PCOS & endometriosis\n\u2022  A desire to avoid ART for personal, ethical, or medical reasons", c1x, y, colW,
    { size: 14, lh: 24.5, color: C.neutral700 });
  var b2 = ptxt(s, "You are in the right place if you are a:\n\n\u2022  Physician (OB/GYN, Family Med) seeking restorative alternatives\n\u2022  Midwife or nurse practitioner deepening fertility expertise\n\u2022  Fertility support professional integrating restorative diagnostics", c2x, y, colW,
    { size: 14, lh: 24.5, color: C.neutral700 });
  y += Math.max(b1.height, b2.height) + 96;

  s.resize(PAGE_W, y);
  return s;
}

function buildFounder() {
  var s = makeFrame("Founder", C.white);
  var y = 64;

  var div = figma.createRectangle();
  div.resize(TW, 1); div.x = TX; div.y = y;
  div.fills = fill(C.neutral300);
  s.appendChild(div);
  y += 64;

  // Purple left border (blockquote style)
  var quoteText = "\u201CI\u2019ll never forget a patient I saw during my residency. She had a history of miscarriages and was pregnant again, terrified. I ordered a progesterone level, which came back low. My attending physician told me to do nothing. He said, \u2018If she\u2019s going to miscarry, she\u2019s going to miscarry.\u2019 That moment broke my heart. I knew there had to be a better way than just watching and waiting for the worst to happen.\u201D";

  var border = figma.createRectangle();
  border.x = TX; border.y = y;
  border.fills = fill(C.purple700);
  s.appendChild(border);

  var q = ptxt(s, quoteText, TX + 24, y, TW - 24,
    { size: 18, lh: 31.5, color: C.neutral700 });
  border.resize(4, q.height);
  y += q.height + 16;

  var attr = ptxt(s, "\u2014 Dr. Naomi Whittaker, Founder of RRM Academy", TX + 24, y, TW - 24,
    { style: "Medium", size: 14, lh: 21, color: C.purple700 });
  y += attr.height + 24;

  var about = ptxt(s, "That experience is the driving force behind RRM Academy. Dr. Whittaker, a board-certified OB/GYN specializing in restorative surgery, founded this platform to fill a critical gap: patients were not being heard, and clinicians lacked training in the cooperative approaches that could truly heal.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700 });
  y += about.height + 16;

  var link = ptxt(s, "Meet Our Founder, Dr. Naomi Whittaker MD \u2192", TX, y, TW,
    { style: "Medium", size: 14, color: C.purple700 });
  y += link.height + 64;

  s.resize(PAGE_W, y);
  return s;
}

function buildFAQ() {
  var s = makeFrame("FAQ", C.white);
  var y = 64;

  var div = figma.createRectangle();
  div.resize(TW, 1); div.x = TX; div.y = y;
  div.fills = fill(C.neutral300);
  s.appendChild(div);
  y += 64;

  var h = ptxt(s, "Your Questions, Answered", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900 });
  y += h.height + 32;

  var faqs = [
    { q: "Is RRM evidence-based?", a: "RRM is grounded in established medical science and supported by peer-reviewed research. Studies have shown that for certain tubal issues, restorative surgery has higher success rates than IVF. We are committed to transparency, which is why we provide full access to our Research Library so you can review the evidence yourself." },
    { q: "Can RRM help me if I have PCOS?", a: "Absolutely. We usually see two main types: insulin-resistant PCOS and adrenal PCOS. RRM professionals investigate which type you have and use a measured approach\u2014starting with lifestyle, then supplements, then medical support\u2014to restore your body\u2019s natural ovulatory function." },
    { q: "Do I need to stop working with my current doctor?", a: "Not necessarily. Our first goal is to empower you with knowledge. For many, this means having more informed conversations with their current provider. Others may choose to seek an RRM-trained practitioner. The choice is always yours." },
  ];

  for (var i = 0; i < faqs.length; i++) {
    var qt = ptxt(s, faqs[i].q, TX, y, TW,
      { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.neutral900 });
    y += qt.height + 12;
    var at = ptxt(s, faqs[i].a, TX, y, TW,
      { size: 16, lh: 28, color: C.neutral700 });
    y += at.height + 32;
  }

  y += 32;
  s.resize(PAGE_W, y);
  return s;
}

function buildResources() {
  var s = makeFrame("Resources", C.white);
  var y = 64;

  var div = figma.createRectangle();
  div.resize(TW, 1); div.x = TX; div.y = y;
  div.fills = fill(C.neutral300);
  s.appendChild(div);
  y += 64;

  var h = ptxt(s, "Latest Insights", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900 });
  y += h.height + 24;

  var items = [
    { title: "Research Library", desc: "The largest collection of RRM-related research available\u2014over 2,200 articles with the newest studies in women\u2019s health and fertility." },
    { title: "Physician Spotlights", desc: "First-person interviews with leading RRM professionals sharing their clinical experiences." },
    { title: "Expert Commentary", desc: "In-depth articles on policy, patient advocacy, and integrative care trends." },
  ];

  for (var i = 0; i < items.length; i++) {
    var t = ptxt(s, items[i].title + " \u2192", TX, y, TW,
      { style: "Medium", size: 16, lh: 28, color: C.purple700 });
    y += t.height + 4;
    var d = ptxt(s, items[i].desc, TX, y, TW,
      { size: 14, lh: 24.5, color: C.neutral700 });
    y += d.height + 24;
  }

  y += 40;
  s.resize(PAGE_W, y);
  return s;
}

function buildCTA() {
  var s = makeFrame("CTA", C.purple50);
  var y = 96;

  var h = ptxt(s, "Begin Your Journey to Answers", TX, y, TW,
    { family: HF.family, style: HF.style, size: 28, lh: 32, color: C.neutral900, align: "CENTER" });
  y += h.height + 16;

  var sub = ptxt(s, "Whether you are a patient seeking answers or a professional seeking excellence, RRM Academy is here to support you.", TX, y, TW,
    { size: 16, lh: 28, color: C.neutral700, align: "CENTER" });
  y += sub.height + 32;

  var bh = placeBtns(s, y, [btn("Explore Courses"), btn("Access Free Resources", "secondary")], true);
  y += bh + 96;

  s.resize(PAGE_W, y);
  return s;
}

function buildFooter() {
  var s = makeFrame("Footer", C.neutral900);
  var y = 48;

  var colGap = 48;
  var colW = Math.floor((CW - 2 * colGap) / 3);
  var c1x = CX, c2x = CX + colW + colGap, c3x = CX + 2 * (colW + colGap);

  var brand = ptxt(s, "RRM Academy", c1x, y, colW,
    { family: HF.family, style: HF.style, size: 20, lh: 23, color: C.white });
  var tag = ptxt(s, "Restorative Reproductive Medicine\nFoundation Inc. \u2022 501(c)(3)", c1x, y + brand.height + 12, colW,
    { size: 12, lh: 18, color: C.neutral500 });

  ptxt(s, "EDUCATION", c2x, y, colW,
    { style: "Medium", size: 12, lh: 18, color: C.neutral500, tracking: 1 });
  var ey = y + 26;
  var eduLinks = ["Courses", "Commentary", "Research Library", "Endo Self-Survey"];
  for (var i = 0; i < eduLinks.length; i++) {
    var el = ptxt(s, eduLinks[i], c2x, ey, colW, { size: 14, lh: 24.5, color: C.neutral300 });
    ey += el.height + 4;
  }

  ptxt(s, "HELP", c3x, y, colW,
    { style: "Medium", size: 12, lh: 18, color: C.neutral500, tracking: 1 });
  var hy = y + 26;
  var helpLinks = ["Log In", "About", "Donate", "Join Us", "Contact"];
  for (var i = 0; i < helpLinks.length; i++) {
    var hl = ptxt(s, helpLinks[i], c3x, hy, colW, { size: 14, lh: 24.5, color: C.neutral300 });
    hy += hl.height + 4;
  }

  y = Math.max(y + brand.height + 12 + tag.height, ey, hy) + 32;

  var divider = figma.createRectangle();
  divider.resize(CW, 1); divider.x = CX; divider.y = y;
  divider.fills = fill(C.neutral700);
  s.appendChild(divider);
  y += 25;

  var cp = ptxt(s, "\u00A9 2025 Restorative Reproductive Medicine Foundation Inc. All Rights Reserved.  \u00B7  Terms of Use  \u00B7  Privacy Policy  \u00B7  Medical Disclaimer", CX, y, CW,
    { size: 12, lh: 18, color: C.neutral500, align: "CENTER" });
  y += cp.height + 48;

  s.resize(PAGE_W, y);
  return s;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  await figma.loadFontAsync({ family: "Inter", style: "Medium" });

  try {
    await figma.loadFontAsync({ family: "Cormorant Garamond", style: "SemiBold" });
  } catch (e) {
    try {
      await figma.loadFontAsync({ family: "Cormorant Garamond SemiBold", style: "Regular" });
      HF = { family: "Cormorant Garamond SemiBold", style: "Regular" };
    } catch (e2) {
      await figma.loadFontAsync({ family: "Inter", style: "Bold" });
      HF = { family: "Inter", style: "Bold" };
      console.log("Cormorant Garamond not loaded — using Inter Bold fallback.");
    }
  }

  var root = figma.createFrame();
  root.name = "Homepage \u2013 1440px";
  root.fills = fill(C.white);

  var sections = [
    buildNav(), buildHero(), buildIntro(), buildAnalogy(),
    buildHowItWorks(), buildComparison(), buildAudience(),
    buildFounder(), buildFAQ(), buildResources(), buildCTA(), buildFooter(),
  ];

  var totalH = 0;
  for (var i = 0; i < sections.length; i++) {
    sections[i].x = 0;
    sections[i].y = totalH;
    root.appendChild(sections[i]);
    totalH += sections[i].height;
  }
  root.resize(PAGE_W, totalH);

  var page = figma.createPage();
  page.name = "Homepage";
  page.appendChild(root);
  figma.currentPage = page;

  figma.viewport.scrollAndZoomIntoView([root]);
  figma.notify("\u2705 Homepage mockup created!");
}

main();
