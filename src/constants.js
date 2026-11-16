// Shared lists and limits used by the guest page, the admin page and the label PDF.
// The keys (left side) are what we store in the database; the labels are what people see.

export const ALLERGENS = [
  { key: 'milk', label: 'Milk / Dairy' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'tree_nuts', label: 'Tree nuts' },
  { key: 'wheat', label: 'Wheat / Gluten' },
  { key: 'soy', label: 'Soy' },
  { key: 'sesame', label: 'Sesame' },
  { key: 'fish', label: 'Fish' },
  { key: 'shellfish', label: 'Shellfish' },
];

export const DIET_TAGS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten_free', label: 'Gluten-free' },
  { key: 'dairy_free', label: 'Dairy-free' },
  { key: 'spicy', label: 'Spicy' },
  { key: 'contains_pork', label: 'Contains pork' },
  { key: 'contains_beef', label: 'Contains beef' },
  { key: 'contains_alcohol', label: 'Contains alcohol' },
];

// Must match the CHECK constraints in supabase/setup.sql.
export const LIMITS = {
  dishName: 60,
  cookName: 40,
  ingredients: 1000,
};

export const labelFor = (list, key) => list.find((x) => x.key === key)?.label ?? key;

// "mango, onion\ncilantro" -> "mango, onion, cilantro"
export function ingredientsAsLine(text) {
  return String(text ?? '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');
}
