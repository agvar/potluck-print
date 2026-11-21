// Makes sample PDFs in ./samples so you can check the label design without the app.
// Run: npm run test:pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import { ALLERGENS, DIET_TAGS } from '../src/constants.js';
import {
  buildSheetPdf, buildAlignmentPdf, DEFAULT_LAYOUT,
  buildRollPdf, buildRollTestPdf, BROTHER_DEFAULT,
} from '../src/label-pdf.js';

const short = {
  dish_name: 'Mango Salsa',
  cook_name: 'Priya',
  ingredients: 'mango, red onion, cilantro, lime juice, jalapeño, salt',
  allergens: [],
  diet_tags: ['vegan', 'gluten_free', 'spicy'],
};

const long = {
  dish_name: "Grandma's Famous Seven-Layer Chicken Biryani with Caramelized Onions",
  cook_name: 'Alexandria Montgomery-Smith',
  ingredients: [
    'basmati rice', 'chicken thighs', 'yogurt', 'ghee', 'onions', 'garlic', 'ginger',
    'green chilies', 'mint', 'cilantro', 'saffron', 'warm milk', 'cardamom', 'cloves',
    'cinnamon', 'bay leaves', 'star anise', 'mace', 'nutmeg', 'cumin', 'coriander powder',
    'turmeric', 'Kashmiri chili powder', 'garam masala', 'lemon juice', 'salt', 'cashews',
    'golden raisins', 'rose water', 'kewra water', 'boiled eggs', 'fried potatoes',
    'vegetable oil', 'black pepper', 'fennel seeds', 'dried fenugreek leaves',
  ].join(', ').repeat(2),
  // Worst case: every allergen and every diet tag ticked.
  allergens: ALLERGENS.map((a) => a.key),
  diet_tags: DIET_TAGS.map((t) => t.key),
};

mkdirSync('samples', { recursive: true });
const save = (name, doc) => {
  writeFileSync(`samples/${name}`, Buffer.from(doc.output('arraybuffer')));
  console.log(`wrote samples/${name}`);
};
// Brother QL-810Wc (main printer): one label per page
save('brother-labels.pdf', buildRollPdf([short, long]));
save('brother-test.pdf', buildRollTestPdf(BROTHER_DEFAULT));

// DeskJet backup: two 7" x 5" labels per Letter sheet
save('pair.pdf', buildSheetPdf({ top: short, bottom: long }));
save('single-bottom.pdf', buildSheetPdf({ bottom: short }));
save('alignment.pdf', buildAlignmentPdf(DEFAULT_LAYOUT));

// Table sign with the guest QR code (2 per Letter page)
const { default: QRCode } = await import('qrcode');
const { buildQrSignPdf } = await import('../src/sign-pdf.js');
const signUrl = 'https://potluck-print.vercel.app/';
save('qr-sign.pdf', buildQrSignPdf(await QRCode.toDataURL(signUrl, { width: 1024, margin: 1, errorCorrectionLevel: 'M' }), signUrl));
