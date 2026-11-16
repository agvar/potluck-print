// Makes sample PDFs in ./samples so you can check the label design without the app.
// Run: npm run test:pdf
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildSheetPdf, buildAlignmentPdf, DEFAULT_LAYOUT } from '../src/label-pdf.js';

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
  allergens: ['milk', 'eggs', 'tree_nuts', 'wheat', 'sesame'],
  diet_tags: ['spicy', 'contains_alcohol'],
};

mkdirSync('samples', { recursive: true });
const save = (name, doc) => {
  writeFileSync(`samples/${name}`, Buffer.from(doc.output('arraybuffer')));
  console.log(`wrote samples/${name}`);
};
save('pair.pdf', buildSheetPdf({ top: short, bottom: long }));
save('single-bottom.pdf', buildSheetPdf({ bottom: short }));
save('alignment.pdf', buildAlignmentPdf(DEFAULT_LAYOUT));
