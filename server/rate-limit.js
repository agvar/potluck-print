// Asks the database whether this phone may run another AI scan.
// Why the database? Serverless functions forget everything between requests,
// so a counter kept in memory here wouldn't work. Postgres remembers.
// The rules (per-phone limit, daily cap, on/off switch) live in supabase/setup.sql.
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

let supabase;

const MESSAGES = {
  off: 'Suggestions are switched off right now. Please type the ingredients.',
  slow_down: 'That\'s a lot of suggestions in a row. Wait a few minutes, or type the ingredients.',
  daily_limit: 'Suggestions are used up for today. Please type the ingredients.',
};

// Returns null when allowed, or a message to show the guest.
export async function checkScanAllowed(request) {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return 'Suggestions aren\'t set up yet.';
  supabase ??= createClient(url, key, { auth: { persistSession: false } });

  // Identify the phone by its IP address, hashed so we never store the address itself.
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const client = createHash('sha256').update(`potluck:${ip}`).digest('hex').slice(0, 32);

  const { data, error } = await supabase.rpc('ai_scan_allowed', { p_client: client });
  if (error) {
    console.error('rate limit check failed', error.message);
    return 'Suggestions aren\'t available right now. Please type the ingredients.';
  }
  return data === 'ok' ? null : (MESSAGES[data] ?? MESSAGES.off);
}
