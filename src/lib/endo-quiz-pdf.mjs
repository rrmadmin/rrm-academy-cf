// PDF summary builder for the ads-flow endometriosis quiz results page.
// Scoped to /endo-quiz/ only. De-branded, ads-compliant output: org voice
// only, no clinician byline, no social CTA. Reuses copy from
// endo-quiz-symptoms.mjs (band label, interpretation, symptom labels); the
// only new strings here are structural (title, date line, tier headings,
// disclaimer, footer). jsPDF is lazy-imported so the results page bundle
// stays lean, matching the technique used by the organic /endo-survey/ flow.
/* eslint-disable */

import { MAX_SCORE, getBand, getBandLabel, getInterpretationText } from './endo-quiz-symptoms.mjs';

const BRAND_PURPLE = [114, 94, 126]; // --purple-700 / #725e7e
const TEXT_PRIMARY = [49, 49, 49]; // --text-primary / #313131
const TEXT_SECONDARY = [99, 98, 97]; // --text-secondary / #636261
const TEXT_MUTED = [148, 145, 142];
const TIER_COLORS = {
  tier1: [155, 77, 110], // --tier1-accent / #9b4d6e
  tier2: [199, 125, 60], // --tier2-accent / #c77d3c
  tier3: [90, 138, 106], // --tier3-accent / #5a8a6a
};

function inCanonicalOrder(canonicalList, selected) {
  const set = new Set(Array.isArray(selected) ? selected : []);
  return (Array.isArray(canonicalList) ? canonicalList : []).filter((label) => set.has(label));
}

export async function generateEndoQuizSummaryPdf(handoff, tiers) {
  const { TIER1, TIER2, TIER3 } = tiers || {};
  const symptoms = handoff && handoff.symptoms ? handoff.symptoms : {};
  const rawT1 = Array.isArray(symptoms.tier1) ? symptoms.tier1 : [];
  const rawT2 = Array.isArray(symptoms.tier2) ? symptoms.tier2 : [];
  const rawT3 = Array.isArray(symptoms.tier3) ? symptoms.tier3 : [];

  const t1 = inCanonicalOrder(TIER1, rawT1);
  const t2 = inCanonicalOrder(TIER2, rawT2);
  const t3 = inCanonicalOrder(TIER3, rawT3);

  const score = handoff.score;
  const counts = { tier1: rawT1.length, tier2: rawT2.length, tier3: rawT3.length };
  const band = getBand(score, counts);

  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'letter' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const maxW = pageW - margin * 2;
  const bottomLimit = pageH - 30;
  let y = 20;

  function ensureRoom(needed) {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = 20;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(TEXT_PRIMARY[0], TEXT_PRIMARY[1], TEXT_PRIMARY[2]);
  doc.text('Endometriosis Symptom Quiz Summary', margin, y);
  y += 8;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(TEXT_SECONDARY[0], TEXT_SECONDARY[1], TEXT_SECONDARY[2]);
  doc.text(`Completed: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, margin, y);
  y += 10;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(BRAND_PURPLE[0], BRAND_PURPLE[1], BRAND_PURPLE[2]);
  doc.text(getBandLabel(band).toUpperCase(), margin, y);
  y += 7;

  doc.setFontSize(16);
  doc.setTextColor(TEXT_PRIMARY[0], TEXT_PRIMARY[1], TEXT_PRIMARY[2]);
  doc.text(`Score: ${score.total} / ${MAX_SCORE.total}`, margin, y);
  y += 10;

  const tierSections = [
    { key: 'tier1', label: `Tier 1: ${score.tier1} / ${MAX_SCORE.tier1}`, items: t1 },
    { key: 'tier2', label: `Tier 2: ${score.tier2} / ${MAX_SCORE.tier2}`, items: t2 },
    { key: 'tier3', label: `Tier 3: ${score.tier3} / ${MAX_SCORE.tier3}`, items: t3 },
  ];

  for (const tier of tierSections) {
    ensureRoom(12);
    const color = TIER_COLORS[tier.key];
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(color[0], color[1], color[2]);
    doc.text(tier.label, margin, y);
    y += 6;

    if (tier.items.length > 0) {
      for (const item of tier.items) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(TEXT_SECONDARY[0], TEXT_SECONDARY[1], TEXT_SECONDARY[2]);
        const lines = doc.splitTextToSize(`• ${item}`, maxW - 4);
        ensureRoom(lines.length * 4.5);
        doc.text(lines, margin + 2, y);
        y += lines.length * 4.5;
      }
    } else {
      ensureRoom(5);
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
      doc.text('No symptoms selected', margin + 2, y);
      y += 5;
    }
    y += 5;
  }

  const interpretation = getInterpretationText(band, score);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(TEXT_PRIMARY[0], TEXT_PRIMARY[1], TEXT_PRIMARY[2]);
  const interpLines = doc.splitTextToSize(interpretation, maxW);
  ensureRoom(interpLines.length * 5.5);
  doc.text(interpLines, margin, y);
  y += interpLines.length * 5.5 + 8;

  ensureRoom(20);
  doc.setDrawColor(200, 200, 200);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
  const disclaimer = 'This is educational information, not a diagnosis. Only surgery can confirm endometriosis.';
  const discLines = doc.splitTextToSize(disclaimer, maxW);
  ensureRoom(discLines.length * 3.8);
  doc.text(discLines, margin, y);
  y += discLines.length * 3.8 + 8;

  ensureRoom(6);
  doc.setFontSize(7.5);
  doc.setTextColor(TEXT_MUTED[0], TEXT_MUTED[1], TEXT_MUTED[2]);
  doc.text('rrmacademy.org/endo-quiz/', margin, y);
  doc.text('RRM Academy, a 501(c)(3) education nonprofit', pageW - margin, y, { align: 'right' });

  doc.save('endo-quiz-summary.pdf');
}
