// One shared connection to the Supabase database, used by both pages.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));

export const supabase = isConfigured ? createClient(url, key) : null;

export function showConfigError() {
  document.body.innerHTML = `
    <main class="wrap">
      <div class="card error">
        <h1>Setup needed</h1>
        <p>The app isn't connected to Supabase yet. Copy <code>.env.example</code> to
        <code>.env.local</code>, fill in your Supabase URL and publishable key, then restart
        <code>npm run dev</code>. (On Vercel, add them under Settings &rarr; Environment Variables.)</p>
      </div>
    </main>`;
}
