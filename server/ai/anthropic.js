// Claude (Anthropic) provider. Uses the official SDK.
// Needs env: ANTHROPIC_API_KEY. Model from AI_MODEL (default claude-haiku-5-5).
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, SUGGESTION_SCHEMA, userText, SuggestError } from './shared.js';

let client;

export const defaultModel = 'claude-haiku-5-5';

export async function suggest({ model, dishName, image }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new SuggestError('AI key is not set up.', 503);
  client ??= new Anthropic({ maxRetries: 1, timeout: 25_000 });

  const content = [];
  if (image) {
    content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } });
  }
  content.push({ type: 'text', text: userText(dishName, Boolean(image)) });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: 4000, // room for the model's thinking plus the short JSON answer
      system: SYSTEM_PROMPT,
      // effort "low" = less thinking = faster answer; enough for "what's in lasagna?"
      // json_schema = Claude must answer in exactly this shape (no parsing surprises).
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SUGGESTION_SCHEMA } },
      messages: [{ role: 'user', content }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) throw new SuggestError('The AI is busy. Try again in a moment.', 503);
    if (error instanceof Anthropic.APIError) {
      console.error('Anthropic error', error.status, error.message);
      throw new SuggestError('The AI service had a problem. Please type the ingredients instead.');
    }
    throw error;
  }

  if (response.stop_reason === 'refusal') throw new SuggestError('The AI could not help with this one. Please type the ingredients.', 422);
  const text = response.content.find((block) => block.type === 'text')?.text;
  if (!text || response.stop_reason === 'max_tokens') throw new SuggestError('The AI answer was incomplete. Try again.');

  console.log('suggest usage', model, response.usage.input_tokens, 'in /', response.usage.output_tokens, 'out');
  return JSON.parse(text);
}
