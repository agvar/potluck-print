// Builds the printable label PDFs. Everything is measured in inches, so what you see in the
// code is what lands on paper. This file has no browser-only code, so it also runs in Node
// (see scripts/sample-pdf.js).
//
// Two printers are supported:
//   * Brother QL-810Wc (main):  one label per PDF page, page = the label itself
//                               (62 mm wide roll, cut to `labelLength`).
//   * HP DeskJet (backup):      a US Letter page holding up to two 7" x 5" labels.
import { jsPDF } from 'jspdf';
import { ALLERGENS, DIET_TAGS, labelFor, ingredientsAsLine } from './constants.js';

// ---------------------------------------------------------------------
// Brother QL-810Wc with a DK-2205 (62 mm continuous) roll.
// The PDF page IS the label: 62 mm wide, `labelLength` long. The printer
// cuts after every page, so a 5-page PDF comes out as 5 separate labels.
// ---------------------------------------------------------------------
export const BROTHER_DEFAULT = {
  labelWidth: 62 / 25.4,   // 62 mm = 2.44"
  labelLength: 4,          // inches; change on the admin page if you want longer/shorter labels
  nudgeX: 0,               // + moves the text right
  nudgeY: 0,               // + moves the text down
};

// ---------------------------------------------------------------------
// DeskJet backup: two 7" x 5" labels on a Letter sheet. These are ESTIMATES:
// (8.5 - 7) / 2 = 0.75" side margins, (11 - 5 - 5) / 2 = 0.5" top/bottom, no gap.
// Adjust them on the admin page after a test print.
// ---------------------------------------------------------------------
export const DEFAULT_LAYOUT = {
  labelWidth: 7,
  labelHeight: 5,
  leftMargin: 0.75,
  topMargin: 0.5,
  gap: 0,          // space between the top and bottom label
  nudgeX: 0,       // + moves everything right
  nudgeY: 0,       // + moves everything down
};

// Font sizes (points) and spacing for each label size.
// [largest, smallest, max lines]: text shrinks until it fits.
const BIG_STYLE = {
  pad: 0.3, name: [32, 16, 2], cook: 13, allergens: [15, 10, 2], diet: [13, 9, 2],
  heading: 10, ingredients: [18, 7], space: 1,
};
const SMALL_STYLE = {
  pad: 0.13, name: [22, 12, 3], cook: 10, allergens: [12, 8, 3], diet: [10, 8, 2],
  heading: 8, ingredients: [13, 6], space: 0.6,
};

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
function fitText(doc, text, width, [maxPt, minPt, maxLines]) {
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

/** Draws one label whose top-left corner is (x0, y0) and size is w x h inches. */
function drawLabel(doc, dish, x0, y0, w, h, s) {
  const left = x0 + s.pad;
  const width = w - s.pad * 2;
  const bottom = y0 + h - s.pad;
  let y = y0 + s.pad;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // Dish name: as big as possible.
  doc.setFont('helvetica', 'bold');
  const name = fitText(doc, clean(dish.dish_name), width, s.name);
  y = drawLines(doc, name.lines, left, y, name.size);

  // Cook
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s.cook);
  y = drawLines(doc, doc.splitTextToSize(`by ${clean(dish.cook_name)}`, width).slice(0, 1), left, y + 0.03, s.cook);

  // Divider
  y += 0.1 * s.space;
  doc.setLineWidth(0.015);
  doc.line(left, y, left + width, y);
  y += 0.12 * s.space;

  // Allergens in a box so they stand out.
  const allergens = dish.allergens ?? [];
  doc.setFont('helvetica', 'bold');
  const allergenText = allergens.length
    ? `CONTAINS: ${allergens.map((k) => labelFor(ALLERGENS, k).toUpperCase()).join(' · ')}`
    : 'Allergens: none declared by the cook';
  const boxPad = 0.08 * s.space;
  const a = fitText(doc, allergenText, width - boxPad * 2, s.allergens);
  const boxH = a.lines.length * a.size * PT * LINE + boxPad * 2;
  doc.setLineWidth(allergens.length ? 0.03 : 0.01);
  doc.rect(left, y, width, boxH);
  drawLines(doc, a.lines, left + boxPad, y + boxPad, a.size);
  y += boxH + 0.12 * s.space;

  // Diet tags
  const tags = (dish.diet_tags ?? []).map((k) => labelFor(DIET_TAGS, k));
  if (tags.length) {
    doc.setFont('helvetica', 'bold');
    const t = fitText(doc, tags.join(' · '), width, s.diet);
    y = drawLines(doc, t.lines, left, y, t.size) + 0.08 * s.space;
  }

  // Ingredients: shrink the font until the list fits in the space left.
  doc.setFont('helvetica', 'bold');
  y = drawLines(doc, ['INGREDIENTS'], left, y, s.heading) + 0.03;
  doc.setFont('helvetica', 'normal');
  const text = clean(ingredientsAsLine(dish.ingredients));
  const room = bottom - y;
  const [maxPt, minPt] = s.ingredients;
  let size = maxPt;
  let lines;
  for (; size >= minPt; size -= 0.5) {
    doc.setFontSize(size);
    lines = doc.splitTextToSize(text, width);
    if (lines.length * size * PT * LINE <= room) break;
  }
  if (size < minPt) {
    size = minPt;
    doc.setFontSize(size);
    const maxLines = Math.max(1, Math.floor(room / (size * PT * LINE)));
    lines = truncate(doc.splitTextToSize(text, width), maxLines);
  }
  drawLines(doc, lines, left, y, size);
}

// =====================================================================
// Brother QL-810Wc
// =====================================================================
const brotherPage = (layout) => [layout.labelWidth, layout.labelLength];

/**
 * One label per page. Pass several dishes to print them in one go:
 * the printer cuts after each page, so each dish comes out as its own label.
 * @param {object[]} dishes
 * @param {object} layout  BROTHER_DEFAULT + your adjustments
 */
export function buildRollPdf(dishes, layout = BROTHER_DEFAULT) {
  const doc = new jsPDF({ unit: 'in', format: brotherPage(layout), orientation: 'portrait' });
  doc.setProperties({ title: 'Potluck labels' });
  dishes.forEach((dish, i) => {
    if (i > 0) doc.addPage(brotherPage(layout), 'portrait');
    drawLabel(doc, dish, layout.nudgeX, layout.nudgeY, layout.labelWidth, layout.labelLength, SMALL_STYLE);
  });
  return doc;
}

/** Test label: shows the label edge, the text area and the center, so you can see if anything is cut off. */
export function buildRollTestPdf(layout = BROTHER_DEFAULT) {
  const doc = new jsPDF({ unit: 'in', format: brotherPage(layout), orientation: 'portrait' });
  doc.setProperties({ title: 'Label test' });
  const w = layout.labelWidth;
  const h = layout.labelLength;
  const x = layout.nudgeX;
  const y = layout.nudgeY;
  const pad = SMALL_STYLE.pad;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.02);
  doc.rect(x + 0.03, y + 0.03, w - 0.06, h - 0.06);          // near the paper edge
  doc.setLineDashPattern([0.06, 0.05], 0);
  doc.rect(x + pad, y + pad, w - pad * 2, h - pad * 2);      // where text goes
  doc.setLineDashPattern([], 0);
  const cx = x + w / 2;
  const cy = y + h / 2;
  doc.line(cx - 0.2, cy, cx + 0.2, cy);
  doc.line(cx, cy - 0.2, cx, cy + 0.2);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('TEST LABEL', cx, y + 0.55, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(
    doc.splitTextToSize('Solid box = paper edge (it is fine if it is slightly cut off). '
      + 'Dashed box = where text goes; it must be fully visible.', w - pad * 2 - 0.1),
    cx, cy + 0.35, { align: 'center', baseline: 'top' },
  );
  doc.text(`62 mm x ${layout.labelLength}"  nudge ${layout.nudgeX}" / ${layout.nudgeY}"`, cx, y + h - 0.3, { align: 'center' });
  return doc;
}

// =====================================================================
// DeskJet backup (two 7" x 5" labels per Letter sheet)
// =====================================================================

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
    drawLabel(doc, slots[slot], x, y, layout.labelWidth, layout.labelHeight, BIG_STYLE);
  }
  return doc;
}

/** Alignment test page: print on PLAIN paper, hold it over a label sheet against a window. */
export function buildAlignmentPdf(layout = DEFAULT_LAYOUT) {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  doc.setProperties({ title: 'Label alignment test' });
  const pad = BIG_STYLE.pad;
  for (const slot of ['top', 'bottom']) {
    const { x, y } = slotOrigin(layout, slot);
    doc.setLineWidth(0.01);
    doc.setDrawColor(0, 0, 0);
    doc.rect(x, y, layout.labelWidth, layout.labelHeight);
    // Dashed "safe area" where text is printed.
    doc.setLineDashPattern([0.08, 0.06], 0);
    doc.rect(x + pad, y + pad, layout.labelWidth - pad * 2, layout.labelHeight - pad * 2);
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
