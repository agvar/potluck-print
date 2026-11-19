// What every AI provider is asked, and how every answer is cleaned up.
// Provider files (anthropic.js, openai-compatible.js) only handle "how to call the API".
// Keeping the prompt, the answer format and the clean-up here means switching
// providers can't change what the guest page receives.
import { ALLERGENS, DIET_TAGS, LIMITS } from '../../src/constants.js';

const ALLERGEN_KEYS = ALLERGENS.map((a) => a.key);
const DIET_KEYS = DIET_TAGS.map((d) => d.key);

export const SYSTEM_PROMPT = `You help guests at a potluck party label the dish they brought.
You get the dish name and sometimes a photo. Suggest the ingredients the dish most likely contains,
so the cook can correct the list instead of typing it from scratch.

- List the ingredients a typical home recipe uses, most important first, at most 20.
  Use short, plain names a guest would recognise ("butter", "garlic", "basmati rice").
- Include hidden ingredients that matter for allergies, such as butter or ghee in sauces,
  ground nuts in curry bases, fish sauce, eggs in baked goods, flour used as a thickener,
  and soy sauce in marinades.
- possible_allergens: every allergen a typical version of this dish could contain, even if unsure.
  Missing an allergen is worse than listing one that turns out not to be there.
  The keys mean: milk = any dairy, eggs, peanuts, tree_nuts, wheat = gluten (wheat, barley, rye),
  fish, shellfish.
- possible_diet_tags: only tags that fit a typical version of the dish (for example "vegetarian"
  only when it usually has no meat or fish; "contains_pork" when it usually has pork).
- note: one short, friendly sentence for the cook, such as what you assumed or what to double-check.
  If the name and photo don't look like food, return empty lists and say so in the note.`;

// The exact shape of the answer. Providers that support it (Claude) enforce it;
// others are told about it and checked by cleanSuggestion() below.
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    dish_guess: { type: 'string', description: 'What the dish appears to be' },
    ingredients: { type: 'array', items: { type: 'string' } },
    possible_allergens: { type: 'array', items: { type: 'string', enum: ALLERGEN_KEYS } },
    possible_diet_tags: { type: 'array', items: { type: 'string', enum: DIET_KEYS } },
    note: { type: 'string' },
  },
  required: ['dish_guess', 'ingredients', 'possible_allergens', 'possible_diet_tags', 'note'],
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
    dish_guess: typeof obj.dish_guess === 'string' ? obj.dish_guess.trim().slice(0, 80) : '',
    ingredients,
    possible_allergens: unique(obj.possible_allergens, ALLERGEN_KEYS),
    possible_diet_tags: unique(obj.possible_diet_tags, DIET_KEYS),
    note: typeof obj.note === 'string' ? obj.note.trim().slice(0, 200) : '',
  };
}

// Thrown by providers for problems the guest should hear about in plain words.
export class SuggestError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.status = status;
  }
}
