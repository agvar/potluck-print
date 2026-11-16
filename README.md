# Potluck Print 🍲🖨️

Guests scan a QR code, type their dish and ingredients on their phone, and you print a
7" × 5" label (2 per sheet) from your iPhone at the party.

**First time?** Follow [SETUP.md](SETUP.md).

## How it works

```
Guest phone (mobile data)                         Your iPhone (same Wi-Fi as printer)
  index.html  ──insert──►  Supabase  ──live──►     admin.html
                              │                       │ builds label PDF (jsPDF)
                              └─► ntfy ─► 🔔          └─► Share → Print → DeskJet
```

- **No server code of our own.** The site is static files on Vercel. Supabase is the database,
  and its security rules (Row Level Security) decide who can do what.
- **Guests can only add dishes.** They can't read, change or delete anything.
- **Only admins** (users listed in the `admins` table) can see the queue and print.
- **Notifications** are sent by the database itself (a trigger calls ntfy.sh), so the secret
  channel name never reaches a browser.

## Project files

| File | What it does |
|---|---|
| `index.html` + `src/guest.js` | Guest form, live label preview, submit |
| `admin.html` + `src/admin.js` | Sign in, live queue, print pair / single / leftover half, edit, reprint, allergen list, QR code, calibration |
| `src/label-pdf.js` | Draws the labels on a Letter page, in inches. Also runs in Node |
| `src/constants.js` | Allergen + diet lists, length limits |
| `src/supabase.js` | Database connection |
| `src/styles.css` | Shared look (phone-first, light/dark) |
| `supabase/setup.sql` | Tables, security rules, live updates, notification trigger |
| `scripts/sample-pdf.js` | `npm run test:pdf` writes sample PDFs to `samples/` |

## Commands

```bash
npm run dev        # local preview at http://localhost:5173
```
```bash
npm run build      # production build into dist/ (Vercel runs this for you)
```
```bash
npm run test:pdf   # sample label PDFs in samples/
```

## Roadmap

- **v1** (this): typed entry, admin-page printing via AirPrint
- v1.1: scan barcodes on store-bought products (Open Food Facts)
- v2: speak ingredients
- v3: photo of the dish → AI suggests ingredients
- Later: Raspberry Pi prints automatically from the same queue
