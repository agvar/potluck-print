// Picks the AI provider from environment variables, so switching is a config change, not a code change:
//   AI_PROVIDER = anthropic (default) | openai-compatible
//   AI_MODEL    = e.g. claude-haiku-5-5, claude-opus-5-5, or the Kimi model name
// Adding a new kind of API = one new file with a suggest() function + one line below.
import * as anthropic from './anthropic.js';
import * as openaiCompatible from './openai-compatible.js';
import { cleanSuggestion, SuggestError } from './shared.js';

const PROVIDERS = {
  anthropic,
  'openai-compatible': openaiCompatible,
};

export function currentProvider() {
  const name = (process.env.AI_PROVIDER || 'anthropic').trim();
  const provider = PROVIDERS[name];
  if (!provider) throw new SuggestError(`Unknown AI_PROVIDER "${name}".`, 503);
  const model = (process.env.AI_MODEL || '').trim() || provider.defaultModel;
  return { name, provider, model }; 
}

export async function suggestIngredients({ dishName, image }) {
  const { name, provider, model } = currentProvider();
  const raw = await provider.suggest({ model, dishName, image });
  return { ...cleanSuggestion(raw), provider: name, model };
}
