// "Brought a dish? Tell us what's in it." table signs: two per US Letter page (cut along the dashed line),
// each 8.5" x 5.5". Printed on plain paper (the DeskJet, or any printer), not the Brother.
// Units are inches, like label-pdf.js. Works in the browser and in Node (scripts/sample-pdf.js).
import { jsPDF } from 'jspdf';

const ACCENT = [194, 84, 27]; // same orange as the app (#c2541b)
const GREY = [90, 85, 78];

const STEPS = [
  'Point your phone camera at the code.',
  'Type your dish name. Want a shortcut? Tap Suggest and we fill in the ingredients from the name or a photo.',
  'Check the ingredients and allergens, then tap Submit.',
  'Pick up your printed label and set it by your dish.',
];

function drawSign(doc, qrDataUrl, url, y0) {
  const W = 8.5;
  const H = 5.5;

  // Thin orange bar across the top: makes the sign easy to spot on a busy table.
  doc.setFillColor(...ACCENT);
  doc.rect(0.5, y0 + 0.4, W - 1, 0.08, 'F');

  // Left: the QR code, as big as fits, with the address underneath for anyone who can't scan.
  const qr = 3.5;
  const qrX = 0.55;
  const qrY = y0 + 0.75;
  doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qr, qr);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(...GREY);
  doc.text(url.replace(/^https?:\/\//, '').replace(/\/$/, ''), qrX + qr / 2, qrY + qr + 0.3, { align: 'center' });

  // Right: title and steps.
  const x = 4.4;
  const width = W - 0.5 - x;
  let y = y0 + 1.15;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(20, 20, 20);
  doc.setFontSize(30);
  doc.text('Brought a dish?', x, y);
  y += 0.5;
  doc.setTextColor(...ACCENT);
  doc.setFontSize(22);
  doc.text('Tell us what\'s in it.', x, y);
  y += 0.32;
  // The big lines invite; this small one says what to do and what they get.
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GREY);
  doc.setFontSize(12);
  doc.text(doc.splitTextToSize('Scan to add ingredients. We\'ll print a label for your dish.', width), x, y, { lineHeightFactor: 1.2 });
  y += 0.55;

  doc.setFontSize(12.5);
  STEPS.forEach((step, i) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...ACCENT);
    doc.text(String(i + 1), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(20, 20, 20);
    const lines = doc.splitTextToSize(step, width - 0.3);
    doc.text(lines, x + 0.3, y, { lineHeightFactor: 1.25 });
    y += lines.length * (12.5 / 72) * 1.25 + 0.12;
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...GREY);
  doc.text('No app or sign-up needed. Takes about a minute.', x, y0 + H - 0.55);
}

export function buildQrSignPdf(qrDataUrl, url) {
  const doc = new jsPDF({ unit: 'in', format: 'letter', orientation: 'portrait' });
  drawSign(doc, qrDataUrl, url, 0);
  drawSign(doc, qrDataUrl, url, 5.5);

  // Cut line between the two signs.
  doc.setDrawColor(170, 170, 170);
  doc.setLineWidth(0.01);
  doc.setLineDashPattern([0.08, 0.08], 0);
  doc.line(0.25, 5.5, 8.25, 5.5);
  doc.setLineDashPattern([], 0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('cut here', 8.25, 5.45, { align: 'right' });
  return doc;
}
