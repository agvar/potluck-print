// Builds the printable PDF: a US Letter page (8.5" x 11") with two 7" x 5" labels.
// Everything is measured in inches, so what you see in the code is what lands on paper.
// This file has no browser-only code, so it also runs in Node (see scripts/sample-pdf.js).
import { jsPDF } from 'jspdf';
import { ALLERGENS, DIET_TAGS, labelFor, ingredientsAsLine } from './constants.js';

// Where the labels sit on the sheet. These are ESTIMATES for a 2-up 7"x5" sheet:
// (8.5 - 7) / 2 = 0.75" side margins, (11 - 5 - 5) / 2 = 0.5" top/bottom margins, no gap.
// Adjust them on the admin page (Settings -> Label position) after a test print.
export const DEFAULT_LAYOUT = {
  labelWidth: 7,
  labelHeight: 5,
  leftMargin: 0.75,
  topMargin: 0.5,
  gap: 0,          // space between the top and bottom label
  nudgeX: 0,       // + moves everything right
  nudgeY: 0,       // + moves everything down
};

const PAD = 0.3;          // blank space inside the label edge
const PT = 1 / 72;        // one typographic point, in inches
const LINE = 1.18;        // line height multiplier

export function slotOrigin(layout, slot) {
  const x = layout.leftMargin + layout.nudgeX;
  const y = layout.topMargin + layout.nudgeY + (slot === 'bottom' ? layout.labelHeight + layout.gap : 0);
  return { x, y };
}

// jsPDF's built-in fonts only cover Western European characters.
// Swap fancy punctuation for plain versions so nothing prints as garbage.
function clean(text) {
  return String(text ?? '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

// Largest font size (between max and min) at which `text` fits in `maxLines` lines.
function fitText(doc, text, width, maxPt, minPt, maxLines) {
  for (let size = maxPt; size >= minPt; size -= 1) {
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, width);
    if (lines.length <= maxLines) return { size, lines };
  }
  doc.setFontSize(minPt);
  const lines = doc.splitTextToSize(text, width);
  return { size: minPt, lines: truncate(lines, maxLines) };
}

function truncate(lines, maxLines) {
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, '') + '...';
  return kept;
}

function drawLines(doc, lines, x, y, size) {
  doc.setFontSize(size);
  doc.text(lines, x, y, { baseline: 'top', lineHeightFactor: LINE });
  return y + lines.length * size * PT * LINE;
}

function drawLabel(doc, dish, x0, y0, layout) {
  const left = x0 + PAD;
  const width = layout.labelWidth - PAD * 2;
  const bottom = y0 + layout.labelHeight - PAD;
  let y = y0 + PAD;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // Dish name: as big as possible, at most 2 lines.
  doc.setFont('helvetica', 'bold');
  const name = fitText(doc, clean(dish.dish_name), width, 32, 16, 2);
  y = drawLines(doc, name.lines, left, y, name.size);

  // Cook
  doc.setFont('helvetica', 'normal');
  y = drawLines(doc, doc.setFontSize(13).splitTextToSize(`by ${clean(dish.cook_name)}`, width).slice(0, 1), left, y + 0.03, 13);

  // Divider
  y += 0.1;
  doc.setLineWidth(0.015);
  doc.line(left, y, left + width, y);
  y += 0.12;

  // Allergens in a box so they stand out.
  const allergens = dish.allergens ?? [];
  doc.setFont('helvetica', 'bold');
  const allergenText = allergens.length
    ? `CONTAINS: ${allergens.map((k) => labelFor(ALLERGENS, k).toUpperCase()).join(' · ')}`
    : 'Allergens: none declared by the cook';
  const boxPad = 0.08;
  const a = fitText(doc, allergenText, width - boxPad * 2, 15, 10, 2);
  const boxH = a.lines.length * a.size * PT * LINE + boxPad * 2;
  doc.setLineWidth(allergens.length ? 0.03 : 0.01);
  doc.rect(left, y, width, boxH);
  drawLines(doc, a.lines, left + boxPad, y + boxPad, a.size);
  y += boxH + 0.12;

  // Diet tags
  const tags = (dish.diet_tags ?? []).map((k) => labelFor(DIET_TAGS, k));
  if (tags.length) {
    doc.setFont('helvetica', 'bold');
    const t = fitText(doc, tags.join(' · '), width, 13, 9, 2);
    y = drawLines(doc, t.lines, left, y, t.size) + 0.08;
  }

  // Ingredients: shrink the font until the list fits in the space left.
  doc.setFont('helvetica', 'bold');
  y = drawLines(doc, ['INGREDIENTS'], left, y, 10) + 0.03;
  doc.setFont('helvetica', 'normal');
  const text = clean(ingredientsAsLine(dish.ingredients));
  const room = bottom - y;
  let size = 18;
  let lines;
  for (; size >= 7; size -= 0.5) {
    doc.setFontSize(size);
    lines = doc.splitTextToSize(text, width);
    if (lines.length * size * PT * LINE <= room) break;
  }
  if (size < 7) {
    size = 7;
    doc.setFontSize(size);
    const maxLines = Math.max(1, Math.floor(room / (size * PT * LINE)));
    lines = truncate(doc.splitTextToSize(text, width), maxLines);
  }
  drawLines(doc, lines, left, y, size);
}

/**
 * Build a sheet PDF.
 * @param {{top?: object, bottom?: object}} slots  dish objects to place in each half
 * @param {object} layout  label positions (DEFAULT_LAYOUT + your adjustments)
 * @returns {jsPDF}
 */
export function buildSheetPdf(slots, layout = DEFAULT_LAYOUT) {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  doc.setProperties({ title: 'Potluck labels' });
  for (const slot of ['top', 'bottom']) {
    if (!slots[slot]) continue;
    const { x, y } = slotOrigin(layout, slot);
    drawLabel(doc, slots[slot], x, y, layout);
  }
  return doc;
}

/** Alignment test page: print on PLAIN paper, hold it over a label sheet against a window. */
export function buildAlignmentPdf(layout = DEFAULT_LAYOUT) {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  doc.setProperties({ title: 'Label alignment test' });
  for (const slot of ['top', 'bottom']) {
    const { x, y } = slotOrigin(layout, slot);
    doc.setLineWidth(0.01);
    doc.setDrawColor(0, 0, 0);
    doc.rect(x, y, layout.labelWidth, layout.labelHeight);
    // Dashed "safe area" where text is printed.
    doc.setLineDashPattern([0.08, 0.06], 0);
    doc.rect(x + PAD, y + PAD, layout.labelWidth - PAD * 2, layout.labelHeight - PAD * 2);
    doc.setLineDashPattern([], 0);
    // Center cross
    const cx = x + layout.labelWidth / 2;
    const cy = y + layout.labelHeight / 2;
    doc.line(cx - 0.25, cy, cx + 0.25, cy);
    doc.line(cx, cy - 0.25, cx, cy + 0.25);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(`${slot.toUpperCase()} LABEL`, cx, cy - 0.5, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('Solid box = label edge. Dashed box = where text goes.', cx, cy + 0.55, { align: 'center' });
  }
  doc.setFontSize(8);
  doc.text(
    `left ${layout.leftMargin}"  top ${layout.topMargin}"  gap ${layout.gap}"  nudge x ${layout.nudgeX}" y ${layout.nudgeY}"`,
    0.5, 10.85,
  );
  return doc;
}
