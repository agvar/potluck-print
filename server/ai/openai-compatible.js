// Any provider with an OpenAI-style "chat completions" API: Kimi (Moonshot), OpenAI, Groq, etc.
// Needs env: AI_BASE_URL (e.g. https://api.moonshot.ai/v1), AI_API_KEY, AI_MODEL
// (a model that accepts images if you want photos to work; check the provider's docs).
// Untested until you plug in a real key: try it with a few dishes before the party.
import { SYSTEM_PROMPT, SUGGESTION_SCHEMA, userText, SuggestError } from './shared.js';

export const defaultModel = null; // no sensible default: set AI_MODEL

export async function suggest({ model, dishName, image }) {
  const baseUrl = process.env.AI_BASE_URL?.replace(/\/+$/, '');
  const apiKey = process.env.AI_API_KEY;
  if (!baseUrl || !apiKey || !model) throw new SuggestError('AI provider is not set up.', 503);

  const content = [];
  if (image) {
    content.push({ type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.base64}` } });
  }
  content.push({ type: 'text', text: userText(dishName, Boolean(image)) });

  // Not every provider can enforce a schema, so describe it in the prompt and ask for JSON.
  const system = `${SYSTEM_PROMPT}\n\nAnswer with only a JSON object matching this JSON Schema:\n${JSON.stringify(SUGGESTION_SCHEMA)}`;

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content }],
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (error) {
    console.error('AI provider unreachable', error);
    throw new SuggestError('The AI service is not responding. Please type the ingredients instead.');
  }
  if (!res.ok) {
    console.error('AI provider error', res.status, await res.text().catch(() => ''));
    throw new SuggestError(res.status === 429 ? 'The AI is busy. Try again in a moment.' : 'The AI service had a problem. Please type the ingredients instead.', 503);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new SuggestError('The AI answer was empty. Try again.');
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    throw new SuggestError('The AI answer was garbled. Try again.');
  }
}
