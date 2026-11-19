import { defineConfig, loadEnv } from 'vite';
import { resolve } from 'node:path';

// Vercel runs api/*.js for us when deployed, but `npm run dev` is plain Vite and
// doesn't know about /api. This small plugin hands /api/suggest requests to the
// same file, so you can try the AI button on your Mac before deploying.
function localApi() {
  return {
    name: 'local-api',
    configureServer(server) {
      // Server-only secrets (ANTHROPIC_API_KEY, ...) from .env.local, like Vercel does.
      Object.assign(process.env, loadEnv(server.config.mode, server.config.root, ''));
      server.middlewares.use('/api/suggest', async (req, res) => {
        try {
          const { POST } = await server.ssrLoadModule('/api/suggest.js');
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const request = new Request(`http://localhost${req.originalUrl}`, {
            method: req.method,
            headers: req.headers,
            body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
          });
          const response = req.method === 'POST' ? await POST(request) : new Response('Use POST', { status: 405 });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch (error) {
          console.error(error);
          res.statusCode = 500;
          res.end(JSON.stringify({ error: 'Local API crashed: see the terminal.' }));
        }
      });
    },
  };
}

// Two pages: the guest form (index.html) and your print queue (admin.html).
export default defineConfig({
  appType: 'mpa',
  plugins: [localApi()],
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
