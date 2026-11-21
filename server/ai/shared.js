// What every AI provider is asked, and how every answer is cleaned up.
// Provider files (anthropic.js, openai-compatible.js) only handle "how to call the API".
// Keeping the prompt, the answer format and the clean-up here means switching
// providers can't change what the guest page receives.
import { ALLERGENS, DIET_TAGS, LIMITS } from '../../src/constants.js';

const ALLERGEN_KEYS = ALLERGENS.map((a) => a.key);
// Only warning tags (spicy, contains pork/beef). The AI never suggests "vegan" or "gluten-free".
const DIET_KEYS = DIET_TAGS.filter((d) => d.warning).map((d) => d.key);

export const SYSTEM_PROMPT = `You help guests at a potluck party label the dish they brought.
You get the dish name and sometimes a photo. Suggest the ingredients the dish most likely contains,
so the cook can correct the list instead of typing it from scratch.

- dish_guess: the dish's common name in 1 to 4 words, like a menu title ("Chicken Biryani",
  "Chocolate Chip Cookies"). No descriptions, adjectives or "with ..." details.
- List the ingredients a typical home recipe uses, most important first, at most 20.
  Use short, plain names a guest would recognise ("butter", "garlic", "basmati rice").
- Include hidden ingredients that matter for allergies, such as butter or ghee in sauces,
  ground nuts in curry bases, fish sauce, eggs in baked goods, flour used as a thickener,
  and soy sauce in marinades.
- possible_allergens: every allergen a typical version of this dish usually or often contains.
  These are pre-ticked for the cook to untick, so when in doubt include it: a missed allergen is
  worse than an extra one. Don't add allergens only a rare variation would have.
  The keys mean: milk = any dairy, eggs, peanuts, tree_nuts, wheat = gluten (wheat, barley, rye),
  fish, shellfish.
- possible_diet_tags: "spicy" when the dish is usually noticeably hot. "contains_pork" or
  "contains_beef" only when the name or photo clearly shows that meat (pork chops, ham, bacon,
  beef stew); never guess them for dishes made with other meats, like chicken biryani.
- If the name and photo don't look like food, return an empty dish_guess and empty lists.`;

// The exact shape of the answer. Providers that support it (Claude) enforce it;
// others are told about it and checked by cleanSuggestion() below.
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    dish_guess: { type: 'string', description: 'Common name of the dish, 1 to 4 words' },
    ingredients: { type: 'array', items: { type: 'string' } },
    possible_allergens: { type: 'array', items: { type: 'string', enum: ALLERGEN_KEYS } },
    possible_diet_tags: { type: 'array', items: { type: 'string', enum: DIET_KEYS } },
  },
  required: ['dish_guess', 'ingredients', 'possible_allergens', 'possible_diet_tags'],
  additionalProperties: false,
};

export function userText(dishName, hasPhoto) {
  const name = dishName ? `Dish name: ${dishName}` : 'The cook did not type a dish name.';
  return hasPhoto ? `${name}\nA photo of the dish is attached.` : name;
}

// Never trust model output blindly: keep only known keys, trim lengths, drop junk.
export function cleanSuggestion(raw) {
  const obj = raw && typeof raw === 'object' ? raw : {};
  const strings = (list) => (Array.isArray(list) ? list : [])
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);

  const ingredients = [];
  let length = 0;
  for (const item of strings(obj.ingredients).slice(0, 25)) {
    const short = item.slice(0, 60);
    if (length + short.length + 2 > LIMITS.ingredients) break;
    if (!ingredients.some((x) => x.toLowerCase() === short.toLowerCase())) {
      ingredients.push(short);
      length += short.length + 2;
    }
  }
  const unique = (list, allowed) => [...new Set(strings(list).filter((k) => allowed.includes(k)))];

  return {
    dish_guess: shortDishName(obj.dish_guess),
    ingredients,
    possible_allergens: unique(obj.possible_allergens, ALLERGEN_KEYS),
    possible_diet_tags: unique(obj.possible_diet_tags, DIET_KEYS),
  };
}

// Safety net in case the model ignores "1 to 4 words" (every provider, every model):
// "Creamy Chicken Tikka Masala with Basmati Rice" -> "Creamy Chicken Tikka Masala".
// Cuts at the first " with / served / in a ..." detail, keeps at most 4 words,
// and drops a dangling "and"/"of" left at the end.
const MAX_NAME_WORDS = 4;
export function shortDishName(text) {
  if (typeof text !== 'string') return '';
  const main = text
    .replace(/\s*\([^)]*\)?/g, ' ') // "(beef and ricotta)"
    .replace(/[\s,;:(–—-]+(with|served|topped|in a|on a|and served)\b.*$/i, '')
    .replace(/[.!]+$/, '')
    .trim();
  const words = main.split(/\s+/).filter(Boolean).slice(0, MAX_NAME_WORDS);
  while (words.length > 1 && /^(and|&|of|with|in|on|the|a)$/i.test(words.at(-1))) words.pop();
  return words.join(' ').slice(0, 40);
}

// Thrown by providers for problems the guest should hear about in plain words.
export class SuggestError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
