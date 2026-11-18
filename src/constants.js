// Shared lists and limits used by the guest page, the admin page and the label PDF.
// The keys (left side) are what we store in the database; the labels are what people see.
// Keep a key unchanged once dishes use it (e.g. 'milk' now shows as "Dairy"): renaming the
// label is safe, renaming the key would make older dishes show the raw key instead.

export const ALLERGENS = [
  { key: 'milk', label: 'Dairy' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'peanuts', label: 'Peanuts' },
  { key: 'tree_nuts', label: 'Tree nuts' },
  { key: 'wheat', label: 'Gluten' },
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
