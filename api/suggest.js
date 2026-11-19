// POST /api/suggest  { dish_name: "Chicken biryani", image?: "data:image/jpeg;base64,..." }
// -> { ingredients: [...], possible_allergens: [...], possible_diet_tags: [...], note, ... }
//
// This is the app's only server code. It exists because the AI key must stay secret:
// anything in the browser can be read by anyone, so the guest page asks this function,
// and only this function talks to the AI provider. Vercel runs every file in /api as one.
import { suggestIngredients } from '../server/ai/index.js';
import { SuggestError } from '../server/ai/shared.js';
import { checkScanAllowed } from '../server/rate-limit.js';

const MAX_BODY = 2_000_000; // ~1.5 MB photo; the page shrinks photos to ~200 KB first
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/;

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

export async function POST(request) {
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY) {
    return json(413, { error: 'That photo is too big.' });
  }
  let body;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) return json(413, { error: 'That photo is too big.' });
    body = JSON.parse(text);
  } catch {
    return json(400, { error: 'Bad request.' });
  }

  const dishName = typeof body?.dish_name === 'string' ? body.dish_name.trim().slice(0, 60) : '';
  let image = null;
  if (body?.image) {
    const match = typeof body.image === 'string' && body.image.match(IMAGE_RE);
    if (!match) return json(400, { error: 'That photo format isn\'t supported.' });
    image = { mediaType: match[1], base64: match[2] };
  }
  if (!dishName && !image) return json(400, { error: 'Type the dish name or add a photo first.' });

  const blocked = await checkScanAllowed(request);
  if (blocked) return json(429, { error: blocked });

  try {
    return json(200, await suggestIngredients({ dishName, image }));
  } catch (error) {
    if (error instanceof SuggestError) return json(error.status, { error: error.message });
    console.error('suggest failed', error);
    return json(500, { error: 'Something went wrong. Please type the ingredients instead.' });
  }
}
